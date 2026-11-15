import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

export function deploymentConfig(serviceName, image, url, env = process.env) {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(serviceName)) {
    throw new Error('SERVICE_NAME must be 1-63 lowercase letters, numbers or hyphens.');
  }
  const publicUrl = new URL(url);
  if (publicUrl.protocol !== 'https:') throw new Error('Lightsail must supply an HTTPS URL.');
  const environment = {
    PUBLIC_URL: publicUrl.origin,
    ALLOWED_HOSTS: publicUrl.hostname,
    ALLOW_ANONYMOUS: 'false',
    VALIO_DATA_MODE: 'mock',
  };
  for (const name of [
    'GEMINI_API_KEY',
    'GEMINI_MODEL',
    'VALIO_API_KEY',
    'VALIO_CUSTOMER_ID',
    'SIGNING_KEY',
  ]) {
    if (env[name]) environment[name] = env[name];
  }
  return {
    serviceName,
    containers: { gateway: { image, environment, ports: { 8787: 'HTTP' } } },
    publicEndpoint: {
      containerName: 'gateway',
      containerPort: 8787,
      healthCheck: {
        path: '/health',
        successCodes: '200',
        intervalSeconds: 10,
        timeoutSeconds: 5,
        healthyThreshold: 2,
        unhealthyThreshold: 5,
      },
    },
  };
}

export function deploymentState(service, version) {
  for (const deployment of [service.nextDeployment, service.currentDeployment]) {
    if (deployment?.version !== version) continue;
    if (deployment.state === 'FAILED')
      throw new Error(`AWS deployment ${version} failed. Check Lightsail logs.`);
    if (deployment.state === 'ACTIVE' && service.currentDeployment?.version === version) return 'active';
  }
  return 'pending';
}

async function main() {
  const name = process.env.SERVICE_NAME;
  const localImage = process.env.LOCAL_IMAGE;
  const region = process.env.AWS_REGION || 'eu-central-1';
  if (!name || !localImage) throw new Error('Set SERVICE_NAME and LOCAL_IMAGE.');
  // Validate before creating resources, even on the first deployment.
  deploymentConfig(name, localImage, 'https://validation.example', {});
  const aws = (...args) =>
    execFileSync('aws', ['lightsail', ...args, '--region', region, '--output', 'json', '--no-cli-pager'], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  const describe = () =>
    JSON.parse(aws('get-container-services', '--service-name', name)).containerServices?.[0];
  let service;
  try {
    service = describe();
  } catch (error) {
    if (!/NotFoundException/.test(String(error.stderr)))
      throw new Error(
        'Could not read the Lightsail service. Check AWS credentials, region and IAM permissions.',
      );
  }
  if (!service) {
    console.log(`Creating ${name} in ${region} (small, one node).`);
    aws('create-container-service', '--service-name', name, '--power', 'small', '--scale', '1');
  }
  for (let attempt = 0; attempt < 80; attempt++) {
    service = describe();
    if (service?.url && ['READY', 'RUNNING'].includes(service.state)) break;
    if (service?.isDisabled) throw new Error('The Lightsail service is disabled. Enable it in AWS first.');
    if (attempt === 79) throw new Error('Timed out waiting for the Lightsail service to become ready.');
    console.log(`Waiting for service: ${service?.state ?? 'creating'}`);
    await sleep(15000);
  }
  console.log('Uploading the container image.');
  // Upload plugin progress may precede its JSON response. Use a unique label to retrieve the exact image.
  const label = `gateway-${Date.now()}`;
  aws('push-container-image', '--service-name', name, '--label', label, '--image', localImage);
  const images = JSON.parse(aws('get-container-images', '--service-name', name)).containerImages;
  const uploaded = images?.find((entry) => entry.image.startsWith(`:${name}.${label}.`));
  if (!uploaded) throw new Error('Could not identify the uploaded image; deployment was not changed.');
  const config = deploymentConfig(name, uploaded.image, service.url);
  const temporary = mkdtempSync(join(tmpdir(), 'valio-deploy-'));
  let version;
  try {
    const file = join(temporary, 'deployment.json');
    // Runtime secrets go in a private temporary file, never shell arguments or workflow logs.
    writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
    const result = JSON.parse(
      aws('create-container-service-deployment', '--cli-input-json', `file://${file}`),
    );
    const next = result.containerService?.nextDeployment;
    const current = result.containerService?.currentDeployment;
    version =
      next?.version ?? (current?.containers?.gateway?.image === uploaded.image ? current.version : undefined);
    if (!Number.isInteger(version)) throw new Error('AWS did not return a deployment version.');
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
  for (let attempt = 0; attempt < 80; attempt++) {
    service = describe();
    if (deploymentState(service, version) === 'active') {
      const response = await fetch(`${config.containers.gateway.environment.PUBLIC_URL}/health`, {
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok || (await response.json()).ok !== true)
        throw new Error('The public health check failed.');
      const url = config.containers.gateway.environment.PUBLIC_URL;
      const summary = `Deployed ${name}, version ${version}\n\n- Website: ${url}/assistant/\n- Console: ${url}/app/\n- MCP: ${url}/mcp (create a token in the console)\n`;
      console.log(summary);
      if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
      return;
    }
    console.log(`Waiting for deployment ${version}: ${service.state}`);
    await sleep(15000);
  }
  throw new Error('Timed out waiting for deployment. Check the Lightsail deployment and container logs.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    // AWS errors can contain request payloads with secrets. Do not print raw errors.
    console.error(
      error.stderr !== undefined
        ? 'AWS command failed. Check AWS permissions, region, service state and Lightsail container logs.'
        : error.message,
    );
    process.exitCode = 1;
  });
}

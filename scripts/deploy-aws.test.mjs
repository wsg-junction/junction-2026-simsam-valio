import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deploymentConfig, deploymentState } from './deploy-aws.mjs';

test('container deploys all routes at one HTTPS origin with credentials kept server-side', () => {
  const config = deploymentConfig(
    'valio-production',
    ':valio.gateway.1',
    'https://example.cs.amazonlightsail.com/',
    {
      GEMINI_API_KEY: 'test-secret',
      AWS_SECRET_ACCESS_KEY: 'never-forward',
    },
  );
  assert.equal(config.containers.gateway.environment.PUBLIC_URL, 'https://example.cs.amazonlightsail.com');
  assert.equal(config.containers.gateway.environment.ALLOWED_HOSTS, 'example.cs.amazonlightsail.com');
  assert.equal(config.containers.gateway.environment.ALLOW_ANONYMOUS, 'false');
  assert.equal(config.containers.gateway.environment.VALIO_DATA_MODE, 'mock');
  assert.equal(config.containers.gateway.environment.GEMINI_API_KEY, 'test-secret');
  assert.equal(config.containers.gateway.environment.AWS_SECRET_ACCESS_KEY, undefined);
  assert.deepEqual(config.containers.gateway.ports, { 8787: 'HTTP' });
  assert.equal(config.publicEndpoint.healthCheck.path, '/health');
  assert.throws(() => deploymentConfig('bad/name', 'image', 'https://example.com'));
  assert.throws(() => deploymentConfig('valio', 'image', 'http://example.com'));
});

test('an older running deployment cannot be reported as a successful new deployment', () => {
  assert.equal(
    deploymentState(
      {
        currentDeployment: { version: 1, state: 'ACTIVE' },
        nextDeployment: { version: 2, state: 'ACTIVATING' },
      },
      2,
    ),
    'pending',
  );
  assert.equal(deploymentState({ currentDeployment: { version: 2, state: 'ACTIVE' } }, 2), 'active');
  assert.throws(
    () =>
      deploymentState(
        {
          currentDeployment: { version: 1, state: 'ACTIVE' },
          nextDeployment: { version: 2, state: 'FAILED' },
        },
        2,
      ),
    /failed/,
  );
});

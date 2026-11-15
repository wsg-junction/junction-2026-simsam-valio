import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const base = 'http://localhost:8787';
let ready = false;
for (let attempt = 0; attempt < 30; attempt++) {
  try {
    const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) });
    ready = response.ok && (await response.json()).ok === true;
    if (ready) break;
  } catch {
    /* Container may still be starting. */
  }
  await sleep(1000);
}
assert.ok(ready, 'Container must become healthy');
for (const path of ['/assistant/', '/app/']) {
  const response = await fetch(base + path);
  assert.equal(response.status, 200, path);
  assert.match(await response.text(), /<html/i);
}
const products = JSON.parse(readFileSync(new URL('../apps/mcp/src/catalog-data.json', import.meta.url)));
const image = products.find((product) => product.image)?.image;
assert.ok(image, 'A product must have a photo');
const response = await fetch(`${base}/assistant${image}`);
assert.equal(response.status, 200);
assert.match(response.headers.get('content-type'), /^image\//);
assert.equal((await fetch(`${base}/mcp`)).status, 401, 'MCP must require a token');
console.log(
  'Container serves the website, console, product photos and health endpoint; MCP requires authentication.',
);

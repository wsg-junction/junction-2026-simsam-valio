import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)); // apps/mcp/src (dev) or apps/mcp/dist (built)

// Secrets such as GEMINI_API_KEY come from the environment or a gitignored .env (apps/mcp/.env or the repo root).
for (const file of [resolve(here, '../.env'), resolve(here, '../../../.env')]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

export const PORT = Number(process.env.PORT ?? 8787);
/** Bind address. Use 0.0.0.0 in containers. */
export const HOST = process.env.HOST ?? '127.0.0.1';
/** Public base URL (e.g. https://aimo-mcp.example.com), used for approval and verification links. */
export const PUBLIC_URL = (process.env.PUBLIC_URL ?? `http://localhost:${PORT}`).replace(/\/$/, '');
/**
 * Hostnames allowed in the Host header (DNS-rebinding protection). Comma-separated; "*" disables the check.
 * Defaults to the PUBLIC_URL host, or localhost when PUBLIC_URL is unset.
 */
export const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS ?? new URL(PUBLIC_URL).hostname)
  .split(',')
  .map((h) => h.trim())
  .filter(Boolean);

/** Allow MCP access without a token (full scopes). Off by default. */
export const ALLOW_ANONYMOUS = process.env.ALLOW_ANONYMOUS === 'true';

/** Where tokens are persisted (hashes only). */
export const DATA_DIR = resolve(process.env.DATA_DIR ?? resolve(here, '../data'));
export const TOKENS_FILE = resolve(DATA_DIR, 'tokens.json');
/** The buyer's sourcing promise to guests. */
export const PROMISE_FILE = resolve(DATA_DIR, 'promise.json');

/** Built Agent Console (apps/console/dist), served at /app. */
export const CONSOLE_DIR = resolve(process.env.CONSOLE_DIR ?? resolve(here, '../../console/dist'));

export const APP_BASE = '/app';

/** Built Aimo Assistant (apps/web/dist), the buyer's chat app, served at /assistant. */
export const WEB_DIR = resolve(process.env.WEB_DIR ?? resolve(here, '../../web/dist'));
export const ASSISTANT_BASE = '/assistant';

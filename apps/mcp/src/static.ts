import { existsSync, readFileSync, statSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { APP_BASE, ASSISTANT_BASE, CONSOLE_DIR, WEB_DIR } from './config';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

/** Serves the built Agent Console (/app) and Aimo Assistant (/assistant), with SPA fallback. True if handled. */
export function serveConsole(res: ServerResponse, path: string): boolean {
  return (
    serveSpa(res, path, APP_BASE, CONSOLE_DIR, 'Agent Console is not built. Run: npm run build -w @valio/console') ||
    serveSpa(res, path, ASSISTANT_BASE, WEB_DIR, 'Aimo Assistant is not built. Run: npm run build -w @valio/web')
  );
}

function serveSpa(res: ServerResponse, path: string, base: string, dir: string, missing: string): boolean {
  if (path !== base && !path.startsWith(`${base}/`)) return false;

  const index = join(dir, 'index.html');
  if (!existsSync(index)) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(missing);
    return true;
  }

  const rel = decodeURIComponent(path.slice(base.length)) || '/';
  const file = resolve(dir, normalize(`.${rel}`));
  const isAsset = file.startsWith(dir) && existsSync(file) && statSync(file).isFile();
  const target = isAsset ? file : index;

  res.writeHead(200, {
    'Content-Type': TYPES[extname(target)] ?? 'application/octet-stream',
    // Vite assets are content-hashed; index.html must always be fresh.
    'Cache-Control': isAsset && rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-store',
  });
  res.end(readFileSync(target));
  return true;
}

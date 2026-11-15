import { createMcpHandler } from '@modelcontextprotocol/server';
import { hostHeaderValidation, toNodeHandler } from '@modelcontextprotocol/node';
import { createServer, type ServerResponse } from 'node:http';
import { handleApi } from './api';
import { runAutomations } from './automations';
import { ALLOW_ANONYMOUS, ALLOWED_HOSTS, APP_BASE, ASSISTANT_BASE, HOST, PORT, PUBLIC_URL } from './config';
import * as gateway from './gateway';
import { createServer as createMcpServer } from './mcp';
import { promisePage, promiseSummary } from './promise-page';
import { jwks } from './signing';
import { serveConsole } from './static';
import { authenticate, identity } from './tokens';

// Stateless MCP endpoint: a fresh McpServer per request (tools filtered by the token's scopes); shared state
// lives in module scope (gateway.ts).
const mcp = toNodeHandler(createMcpHandler(() => createMcpServer()));

const localhost = ALLOWED_HOSTS.every((h) => h === 'localhost' || h === '127.0.0.1');
const validateHost = ALLOWED_HOSTS.includes('*')
  ? () => true
  : hostHeaderValidation(localhost ? ['localhost', '127.0.0.1'] : ALLOWED_HOSTS);

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body, null, 2));
};

const redirect = (res: ServerResponse, location: string) => {
  res.writeHead(302, { Location: location });
  res.end();
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://local');
  const path = url.pathname.replace(/\/$/, '') || '/';

  try {
    // --- MCP: /mcp/<token>, or /mcp with "Authorization: Bearer <token>" ---------------------------
    const mcpMatch = path.match(/^\/mcp(?:\/([\w-]+))?$/);
    if (mcpMatch) {
      // Browser-based MCP clients (e.g. MCP Inspector) need CORS; Claude connects server-to-server.
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', '*');
      res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id, Mcp-Protocol-Version');
      if (req.method === 'OPTIONS') return void res.writeHead(204).end();
      if (!validateHost(req, res)) return;

      const bearer = req.headers.authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
      const presented = mcpMatch[1] ?? bearer;
      const token = authenticate(presented);
      if (!token && (presented || !ALLOW_ANONYMOUS)) {
        return json(res, 401, {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32001,
            message: presented
              ? 'Invalid or revoked token. Create a new one in the Valio Aimo Agent Console.'
              : `A token is required. Create one at ${PUBLIC_URL}${APP_BASE}/agents and use ${PUBLIC_URL}/mcp/<token>.`,
          },
        });
      }
      return void (await identity.run({ token }, () => mcp(req, res)));
    }

    if (await handleApi(req, res, path)) return;
    if (serveConsole(res, path)) return;

    if (req.method === 'GET') {
      if (path === '/') return redirect(res, `${ASSISTANT_BASE}/`);
      if (path === '/health') return json(res, 200, { ok: true });
      if (path === '/.well-known/jwks.json') return json(res, 200, jwks);
      if (path === '/promise.json') return json(res, 200, promiseSummary());
      if (path === '/promise') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return void res.end(promisePage());
      }

      const quoteMatch = path.match(/^\/quotes\/([\w-]+)$/);
      if (quoteMatch) {
        const quote = gateway.getQuote(quoteMatch[1]);
        return quote
          ? json(res, 200, { quote, jwks: `${PUBLIC_URL}/.well-known/jwks.json` })
          : json(res, 404, { error: 'not found' });
      }

      // Links from earlier versions now live in the console.
      const approvalMatch = path.match(/^\/approvals\/([\w-]+)$/);
      if (approvalMatch) return redirect(res, `${APP_BASE}/orders/${approvalMatch[1]}`);
      const legacy: Record<string, string> = { '/approvals': '/approvals', '/mandate': '/rules', '/audit': '/activity' };
      if (legacy[path]) return redirect(res, `${APP_BASE}${legacy[path]}`);
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  } catch (err) {
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: 'Internal server error' });
  }
});

// Automations that act on their own (stock autopilot, event auto-order) check every 30 seconds.
setInterval(() => {
  try {
    runAutomations();
  } catch (err) {
    console.error('Automation run failed:', err);
  }
}, 30_000).unref();

server.listen(PORT, HOST, () => {
  console.log(`Valio Aimo Agent Gateway (mock) listening on http://${HOST}:${PORT}`);
  console.log(`Aimo Assistant: ${PUBLIC_URL}${ASSISTANT_BASE}/`);
  console.log(`Agent Console:  ${PUBLIC_URL}${APP_BASE}/`);
  console.log(`MCP endpoint:   ${PUBLIC_URL}/mcp/<token>  (create a token in the console)`);
  if (ALLOW_ANONYMOUS) console.log('Anonymous MCP access is ON (ALLOW_ANONYMOUS=true)');
});

# Valio

npm workspaces monorepo:

| Path              | What                                                                      |
| ----------------- | ------------------------------------------------------------------------- |
| `apps/web`        | **Aimo Assistant**: mock ChatGPT-style chat for the buyer (shadcn), with automations, limits and requirements; served by the gateway at `/assistant`. The old shop pages under `src/pages` are no longer routed |
| `apps/api`        | Fastify backend (orders, warnings, notifications)                         |
| `apps/mcp`        | **Agent Gateway mock**: MCP server + MCP Apps widgets for external purchasing agents (see its README) |
| `apps/console`    | **Agent Console**: buyer-facing app (shadcn) for MCP tokens, approvals, orders, mandate and audit log; served by the gateway at `/app` |
| `packages/shared` | `@valio/shared`: shared model (Zod schemas/types) and the product catalog |

Requires Node.js >= 22.13 (uses the built-in `node:sqlite`).

## Setup

```bash
npm install
cp apps/api/.env.example apps/api/.env   # optional, defaults work for local dev
npm run dev                             # api on :3001, web on :5173 (proxies /api to the API)
```

## API

All routes are prefixed with `/api`.

| Method  | Route                       | Purpose                                                     |
| ------- | --------------------------- | ----------------------------------------------------------- |
| `GET`   | `/events`                   | Server-Sent Events: `{ collection, id? }` on every change   |
| `GET`   | `/orders?ids=a,b`           | Orders by id, newest first                                  |
| `GET`   | `/orders/:id`               | Single order                                                |
| `POST`  | `/orders`                   | Create order (+ checkout warnings); API assigns id/createdAt |
| `PUT`   | `/orders/:id`               | Replace order (picking dashboard)                           |
| `GET`   | `/warnings`                 | All warnings                                                |
| `GET`   | `/notifications?orderIds=…` | Notifications for orders                                    |
| `POST`  | `/notifications`            | Create notification                                         |
| `PATCH` | `/notifications/:id`        | Mark as read                                                |

Data is stored in SQLite (`DATABASE_PATH`, default `apps/api/data/valio.db`).

## Migration notes (from Firebase)

- Firestore → SQLite in the API; `onSnapshot` live updates → `/api/events` SSE + refetch (`apps/web/src/lib/api.ts`).
- Dropped: Vapi voice calls, web push notifications (FCM) and the Gemini integration.
- Production web builds need `VITE_API_URL` set to the deployed API URL (unless served behind the same origin at `/api`).

import type { ChangeEvent } from '@valio/shared';
import type { FastifyPluginAsync } from 'fastify';
import * as db from '../db';
import { onChange } from '../events';

export const miscRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => ({ ok: true }));

  app.get('/warnings', async () => db.warnings.list());

  /**
   * Server-Sent Events stream of collection changes. Replaces Firestore's onSnapshot: clients refetch the
   * affected resources when they receive an event.
   */
  app.get('/events', (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      ...(reply.getHeaders() as Record<string, string>),
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    reply.raw.write(`retry: 3000\n\n`);

    const send = (event: ChangeEvent) => reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    const unsubscribe = onChange(send);
    // Keep proxies from closing idle connections.
    const heartbeat = setInterval(() => reply.raw.write(`: ping\n\n`), 25_000);

    req.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
};

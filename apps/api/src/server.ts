import cors from '@fastify/cors';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { env } from './env';
import { HttpError } from './errors';
import { miscRoutes } from './routes/misc';
import { notificationRoutes } from './routes/notifications';
import { orderRoutes } from './routes/orders';

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',').map((o) => o.trim()),
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
});

app.setErrorHandler((err, req, reply) => {
  if (err instanceof ZodError) {
    return reply.code(400).send({ error: 'Invalid request', issues: err.issues });
  }
  if (err instanceof HttpError) {
    return reply.code(err.statusCode).send({ error: err.message });
  }
  req.log.error(err);
  const statusCode = (err as { statusCode?: number }).statusCode ?? 500;
  return reply
    .code(statusCode)
    .send({ error: statusCode >= 500 ? 'Internal server error' : (err as Error).message });
});

await app.register(
  async (api) => {
    await api.register(miscRoutes);
    await api.register(orderRoutes);
    await api.register(notificationRoutes);
  },
  { prefix: '/api' },
);

await app.listen({ port: env.PORT, host: env.HOST });

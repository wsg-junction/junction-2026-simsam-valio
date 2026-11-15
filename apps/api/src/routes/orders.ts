import { createOrderSchema, updateOrderSchema, type Order } from '@valio/shared';
import type { FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import * as db from '../db';
import { notFound } from '../errors';

const idParams = z.object({ id: z.string() });

function getOrderOrThrow(id: string): Order {
  const order = db.orders.get(id);
  if (!order) throw notFound(`Order ${id}`);
  return order;
}

export const orderRoutes: FastifyPluginAsync = async (app) => {
  /** GET /orders?ids=a,b,c — orders by id, newest first. */
  app.get('/orders', async (req) => {
    const { ids } = z.object({ ids: z.string().default('') }).parse(req.query);
    return db.orders.listByIds(ids.split(',').filter(Boolean));
  });

  app.get('/orders/:id', async (req) => {
    const { id } = idParams.parse(req.params);
    return getOrderOrThrow(id);
  });

  /** Creates an order together with the warnings computed at checkout. */
  app.post('/orders', async (req, reply) => {
    const { warnings, ...input } = createOrderSchema.parse(req.body);
    const order: Order = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };

    db.orders.create(
      order,
      warnings.map((w) => ({ ...w, id: randomUUID(), orderId: order.id })),
    );
    return reply.code(201).send(order);
  });

  /** Replaces the mutable fields of an order (used by the picking dashboard). */
  app.put('/orders/:id', async (req) => {
    const { id } = idParams.parse(req.params);
    const existing = getOrderOrThrow(id);
    const input = updateOrderSchema.parse(req.body);
    return db.orders.save({ ...input, id, createdAt: existing.createdAt });
  });
};

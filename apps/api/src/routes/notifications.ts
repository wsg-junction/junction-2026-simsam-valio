import { createNotificationSchema, updateNotificationSchema } from '@valio/shared';
import type { FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import * as db from '../db';
import { notFound } from '../errors';

export const notificationRoutes: FastifyPluginAsync = async (app) => {
  /** GET /notifications?orderIds=a,b,c */
  app.get('/notifications', async (req) => {
    const { orderIds } = z.object({ orderIds: z.string().default('') }).parse(req.query);
    return db.notifications.listByOrderIds(orderIds.split(',').filter(Boolean));
  });

  app.post('/notifications', async (req, reply) => {
    const input = createNotificationSchema.parse(req.body);
    if (!db.orders.get(input.orderId)) throw notFound(`Order ${input.orderId}`);

    const notification = db.notifications.create({
      ...input,
      id: randomUUID(),
      read: false,
      createdAt: Date.now(),
    });
    return reply.code(201).send(notification);
  });

  app.patch('/notifications/:id', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const patch = updateNotificationSchema.parse(req.body);

    const notification = db.notifications.get(id);
    if (!notification) throw notFound(`Notification ${id}`);
    return db.notifications.save({ ...notification, ...patch });
  });
};

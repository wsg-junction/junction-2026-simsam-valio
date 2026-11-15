import { z } from 'zod';

export interface Notification {
  id: string;
  title: string;
  message: string;
  read: boolean;
  orderId?: string;
  /** epoch millis */
  createdAt: number;
}

export const createNotificationSchema = z.object({
  title: z.string(),
  message: z.string(),
  orderId: z.string(),
});
export type CreateNotificationInput = z.infer<typeof createNotificationSchema>;

export const updateNotificationSchema = z.object({
  read: z.boolean(),
});

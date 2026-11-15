import { z } from 'zod';

export const translatedNameSchema = z.object({
  value: z.string(),
  language: z.string(),
});

export const pickEventSchema = z.object({
  quantity: z.number(),
  /** ISO 8601 timestamp */
  datetime: z.string(),
});
export type PickEvent = z.infer<typeof pickEventSchema>;

// Loose: items added by the voice assistant carry the full product payload.
export const itemSchema = z.looseObject({
  id: z.string(),
  names: z.array(translatedNameSchema),
  orderedQuantity: z.number(),
  ean: z.string(),
  pickEvent: pickEventSchema.nullable(),
});
export type Item = z.infer<typeof itemSchema>;

export const addressSchema = z.object({
  formatted: z.string(),
  lat: z.number(),
  lng: z.number(),
});
export type Address = z.infer<typeof addressSchema>;

export const orderSchema = z.object({
  id: z.string(),
  /** ISO 8601 timestamp, set by the API */
  createdAt: z.string(),
  products: z.array(itemSchema),
  fallbacks: z.record(z.string(), z.string()),
  totalPrice: z.number(),
  telephone: z.string().nullable(),
  address: addressSchema,
  lang: z.string(),
});
export type Order = z.infer<typeof orderSchema>;

export const warningInputSchema = z.object({
  itemId: z.string().optional(),
  title: z.string(),
  description: z.string(),
});
export type WarningInput = z.infer<typeof warningInputSchema>;

/** Payload of POST /orders: the API assigns id and createdAt. */
export const createOrderSchema = orderSchema.omit({ id: true, createdAt: true }).extend({
  warnings: z.array(warningInputSchema).default([]),
});
export type CreateOrderInput = z.input<typeof createOrderSchema>;

/** Payload of PUT /orders/:id */
export const updateOrderSchema = orderSchema.omit({ id: true, createdAt: true });
export type UpdateOrderInput = z.infer<typeof updateOrderSchema>;

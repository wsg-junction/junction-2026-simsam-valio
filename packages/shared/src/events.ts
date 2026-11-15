export const COLLECTIONS = ['orders', 'warnings', 'notifications'] as const;
export type Collection = (typeof COLLECTIONS)[number];

/** Message sent over the /events SSE stream whenever a collection changes. */
export interface ChangeEvent {
  collection: Collection;
  id?: string;
}

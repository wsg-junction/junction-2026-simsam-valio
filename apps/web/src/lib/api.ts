import { useLocalStorage } from '@/hooks/use-local-storage';
import type {
  ChangeEvent,
  Collection,
  CreateNotificationInput,
  CreateOrderInput,
  Notification as AppNotification,
  Order,
  UpdateOrderInput,
  Warning,
} from '@valio/shared';
import { useCallback, useEffect, useState } from 'react';

export const API_URL: string = import.meta.env.VITE_API_URL ?? '/api';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new ApiError(res.status, error.error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

// --- endpoints --------------------------------------------------------------

export const api = {
  getOrder: (id: string) => request<Order>('GET', `/orders/${encodeURIComponent(id)}`),
  getOrders: (ids: string[]) => request<Order[]>('GET', `/orders?ids=${ids.map(encodeURIComponent).join(',')}`),
  createOrder: (order: CreateOrderInput) => request<Order>('POST', '/orders', order),
  updateOrder: ({ id, createdAt: _createdAt, ...order }: Order) =>
    request<Order>('PUT', `/orders/${encodeURIComponent(id)}`, order satisfies UpdateOrderInput),

  getWarnings: () => request<Warning[]>('GET', '/warnings'),

  getNotifications: (orderIds: string[]) =>
    request<AppNotification[]>('GET', `/notifications?orderIds=${orderIds.map(encodeURIComponent).join(',')}`),
  createNotification: (notification: CreateNotificationInput) =>
    request<AppNotification>('POST', '/notifications', notification),
  updateNotification: (id: string, patch: { read: boolean }) =>
    request<AppNotification>('PATCH', `/notifications/${encodeURIComponent(id)}`, patch),
};

// --- live updates -----------------------------------------------------------

type Listener = (event: ChangeEvent) => void;
const listeners = new Set<Listener>();
let eventSource: EventSource | null = null;

/** Subscribes to the API's change stream. A single EventSource is shared by all subscribers. */
function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  if (!eventSource) {
    eventSource = new EventSource(`${API_URL}/events`);
    eventSource.onmessage = (msg) => {
      const event = JSON.parse(msg.data) as ChangeEvent;
      listeners.forEach((l) => l(event));
    };
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      eventSource?.close();
      eventSource = null;
    }
  };
}

/**
 * Loads a resource and reloads it whenever one of the given collections changes on the server.
 * Pass `null` as key to skip loading. `key` must change whenever `load` would fetch something different.
 */
export function useLiveResource<T>(
  key: string | null,
  collections: Collection[],
  load: () => Promise<T>,
): T | undefined {
  const [state, setState] = useState<{ key: string | null; value: T | undefined }>({
    key: null,
    value: undefined,
  });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableLoad = useCallback(load, [key]);
  const collectionKey = collections.join(',');

  useEffect(() => {
    if (key === null) return;
    let cancelled = false;

    const reload = () =>
      stableLoad()
        .then((value) => !cancelled && setState({ key, value }))
        .catch((err) => {
          if (err instanceof ApiError && err.status === 404) {
            if (!cancelled) setState({ key, value: undefined });
          } else {
            console.error(err);
          }
        });

    reload();
    const unsubscribe = subscribe((event) => {
      if (collectionKey.split(',').includes(event.collection)) reload();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [key, collectionKey, stableLoad]);

  return state.key === key ? state.value : undefined;
}

// --- hooks (replace the former Firestore hooks) -----------------------------

export function useOrder(id: string | undefined): Order | undefined {
  return useLiveResource(id ? `order:${id}` : null, ['orders'], () => api.getOrder(id!));
}

const EMPTY: never[] = [];

export function useMyOrders(): Order[] {
  const [myOrderIds] = useLocalStorage<string[]>('myOrderIds', []);
  const key = myOrderIds.join(',');
  return (
    useLiveResource(key ? `orders:${key}` : null, ['orders'], () => api.getOrders(myOrderIds)) ?? EMPTY
  );
}

export function useWarnings(): Warning[] {
  return useLiveResource('warnings', ['warnings'], api.getWarnings) ?? EMPTY;
}

export function useNotifications(orderIds: string[]): AppNotification[] {
  const key = orderIds.join(',');
  return (
    useLiveResource(key ? `notifications:${key}` : null, ['notifications'], () =>
      api.getNotifications(orderIds),
    ) ?? EMPTY
  );
}


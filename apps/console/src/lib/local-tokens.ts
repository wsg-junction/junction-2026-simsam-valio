import { useSyncExternalStore } from 'react';

// The full token is shown once by the server and only kept here, in this browser's localStorage, so the user
// can copy the connector URL again later. The server stores only a hash.

const KEY = 'valio-aimo.tokens';

interface Saved {
  token: string;
  connectorUrl: string;
}

type Store = Record<string, Saved>;

const listeners = new Set<() => void>();

function read(): Store {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Store;
  } catch {
    return {};
  }
}

let cache: Store = read();

function write(next: Store) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable (private mode): keep in memory for this session.
  }
  listeners.forEach((l) => l());
}

export const localTokens = {
  save(id: string, saved: Saved) {
    write({ ...cache, [id]: saved });
  },
  forget(id: string) {
    const { [id]: _removed, ...rest } = cache;
    write(rest);
  },
  get(id: string): Saved | undefined {
    return cache[id];
  },
};

export function useLocalTokens(): Store {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => cache,
  );
}

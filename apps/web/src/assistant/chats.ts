import { useSyncExternalStore } from 'react';
import type { AssistantCard } from './api';

// Conversations live in this browser only (localStorage). The gateway keeps orders, rules and the audit trail.

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  cards?: AssistantCard[];
  suggestions?: string[];
  at: string;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: string;
}

const KEY = 'aimo-assistant.chats';
const listeners = new Set<() => void>();

function load(): Conversation[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Conversation[]) : [];
  } catch {
    return [];
  }
}

let chats: Conversation[] = load();

function save(next: Conversation[]) {
  chats = next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 30);
  try {
    localStorage.setItem(KEY, JSON.stringify(chats));
  } catch {
    // Storage full or blocked: keep the in-memory copy.
  }
  listeners.forEach((l) => l());
}

export const newId = () => Math.random().toString(36).slice(2, 10);

export const chatStore = {
  get: (id: string) => chats.find((c) => c.id === id),
  create(firstMessage: string): Conversation {
    const c: Conversation = {
      id: newId(),
      title: firstMessage.length > 48 ? `${firstMessage.slice(0, 46)}…` : firstMessage,
      messages: [],
      updatedAt: new Date().toISOString(),
    };
    save([c, ...chats]);
    return c;
  },
  append(id: string, message: Omit<ChatMessage, 'id' | 'at'>) {
    const at = new Date().toISOString();
    save(chats.map((c) => (c.id === id ? { ...c, messages: [...c.messages, { ...message, id: newId(), at }], updatedAt: at } : c)));
  },
  remove(id: string) {
    save(chats.filter((c) => c.id !== id));
  },
  clear() {
    save([]);
  },
};

export function useChats(): Conversation[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => chats,
  );
}

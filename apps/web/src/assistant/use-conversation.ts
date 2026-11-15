import { useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { api, type AssistantAction, type AssistantReply } from './api';
import { chatStore } from './chats';

// Which conversations are waiting for the assistant's answer (shows the typing indicator).
const thinking = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;
const setThinking = (id: string, on: boolean) => {
  if (on) thinking.add(id);
  else thinking.delete(id);
  version++;
  listeners.forEach((l) => l());
};

export function useThinking(id?: string): boolean {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
  return !!id && thinking.has(id);
}

/** A short pause so the mock assistant feels like it is thinking. */
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function respond(conversationId: string, work: () => Promise<AssistantReply>) {
  setThinking(conversationId, true);
  try {
    const [reply] = await Promise.all([work(), pause(450)]);
    chatStore.append(conversationId, { role: 'assistant', text: reply.text, cards: reply.cards, suggestions: reply.suggestions });
    return reply.cards.length ? reply : undefined;
  } catch (err) {
    chatStore.append(conversationId, {
      role: 'assistant',
      text: `Sorry, something went wrong: ${err instanceof Error ? err.message : String(err)}`,
    });
  } finally {
    setThinking(conversationId, false);
  }
}

export function useAssistant() {
  const navigate = useNavigate();

  /** Sends a message; starts a new conversation when none is given. */
  const send = (text: string, conversationId?: string) => {
    const message = text.trim();
    if (!message) return;
    if (conversationId && thinking.has(conversationId)) return;
    const id = conversationId ?? chatStore.create(message).id;
    const history = (chatStore.get(id)?.messages ?? []).map((m) => ({ role: m.role, text: m.text }));
    chatStore.append(id, { role: 'user', text: message });
    if (!conversationId) navigate(`/c/${id}`);
    void respond(id, () => api.chat(message, id, history));
  };

  /** A one-click action from a card or the attention feed. Inside a chat, the result is added to it. */
  const act = async (action: AssistantAction, label: string, conversationId?: string) => {
    if (conversationId) {
      if (thinking.has(conversationId)) return;
      chatStore.append(conversationId, { role: 'user', text: label });
      return await respond(conversationId, () => api.action(action));
    }
    try {
      const reply = await api.action(action);
      toast.success(label, { description: reply.text });
      return reply;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'That did not work');
    }
  };

  return { send, act };
}

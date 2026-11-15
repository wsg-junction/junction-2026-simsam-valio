import type {
  AssistantAction,
  AssistantCard,
  AssistantReply,
  AttentionItem,
  AutomationRun,
  AutomationSettings,
  EventView,
  Meal,
  ReplenishmentResult,
} from '@gateway/types';
import { useCallback, useEffect, useRef, useState } from 'react';

export type { AssistantAction, AssistantCard, AssistantReply, AttentionItem, AutomationRun, AutomationSettings, EventView, Meal };

export interface Mandate {
  buyer: string;
  approver: string;
  autoApproveLimit: number;
  weeklyBudget: number;
  spentThisWeek: number;
  allowedCategories: string[];
  requireOnTimeDelivery: boolean;
  requireRequirementsMatch: boolean;
  requireSubstituteApproval: boolean;
}

export type PromiseKind =
  | 'finnish-origin'
  | 'eu-origin'
  | 'organic'
  | 'free-range'
  | 'fairtrade'
  | 'no-allergen'
  | 'vegan'
  | 'lactose-free'
  | 'gluten-free';

export interface PromiseRule {
  id: string;
  kind: PromiseKind;
  categories: string[];
  allergen?: string;
}

export interface ExcludedProduct {
  id: string;
  name: string;
  brand: string;
  packLabel: string;
  origin: string;
  reason: string;
}

export interface PromiseState {
  promise: { rules: PromiseRule[]; statement: string; published: boolean; version: number };
  excluded: ExcludedProduct[];
  productCount: number;
  publicUrl: string;
}

export interface AutomationsState {
  settings: AutomationSettings;
  runs: AutomationRun[];
  items: { key: string; name: string }[];
  stock: ReplenishmentResult;
}

export interface Info {
  categories: string[];
  assistant: { engine: 'gemini' | 'rules'; model?: string; supplier?: 'valio-api' | 'demo' };
  buyer: string;
  approver: string;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
  return data as T;
}

export const api = {
  info: () => request<Info>('GET', '/info'),
  chat: (message: string, conversationId: string, history: { role: 'user' | 'assistant'; text: string }[]) =>
    request<AssistantReply>('POST', '/assistant/chat', { message, conversationId, history }),
  action: (action: AssistantAction) => request<AssistantReply>('POST', '/assistant/action', { action }),
  attention: () => request<AttentionItem[]>('GET', '/assistant/attention'),
  automations: () => request<AutomationsState>('GET', '/automations'),
  updateAutomations: (patch: {
    stock?: Partial<AutomationSettings['stock']>;
    events?: Partial<AutomationSettings['events']>;
  }) => request<AutomationsState>('PUT', '/automations', patch),
  runAutomations: () => request<AutomationsState>('POST', '/automations/run'),
  simulateDay: () => request<ReplenishmentResult>('POST', '/stock/simulate-day'),
  events: () => request<EventView[]>('GET', '/events'),
  addEvent: (e: { name: string; date: string; meal: Meal; guests: number; vegan: number; budget?: number }) =>
    request<EventView>('POST', '/events', e),
  removeEvent: (id: string) => request<{ ok: true }>('DELETE', `/events/${id}`),
  mandate: () => request<Mandate>('GET', '/mandate'),
  updateMandate: (patch: Partial<Mandate>) => request<{ mandate: Mandate; changes: string[] }>('PUT', '/mandate', patch),
  promise: () => request<PromiseState>('GET', '/promise'),
  previewPromise: (rules: PromiseRule[]) => request<{ excluded: ExcludedProduct[] }>('POST', '/promise/preview', { rules }),
  updatePromise: (patch: { rules?: PromiseRule[]; statement?: string; published?: boolean }) =>
    request<PromiseState & { changes: string[] }>('PUT', '/promise', patch),
};

/** Loads data and keeps it fresh by polling (paused while the tab is hidden). */
export function useLive<T>(load: () => Promise<T>, intervalMs = 5000) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const loadRef = useRef(load);
  loadRef.current = load;

  const refresh = useCallback(async () => {
    try {
      setData(await loadRef.current());
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(() => document.visibilityState === 'visible' && refresh(), intervalMs);
    return () => clearInterval(t);
  }, [refresh, intervalMs]);

  return { data, error, refresh, setData };
}

// --- formatting -----------------------------------------------------------------------

export const eur = (n: number) =>
  `€${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.replace(/\.00$/, '');

export const qty = (n: number, unit: string) => `${n.toLocaleString('en-GB', { maximumFractionDigits: 2 })} ${unit}`;

export const day = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

export function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

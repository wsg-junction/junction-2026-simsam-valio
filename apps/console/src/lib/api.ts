import type { AssortmentResult, AuditEvent, Order, Quote, ReplenishmentResult, StockItem } from '@gateway/types';
import { useCallback, useEffect, useRef, useState } from 'react';

export type { AssortmentResult, AuditEvent, Order, Quote, ReplenishmentResult, StockItem };

export type Scope = 'catalog:read' | 'quotes:write' | 'orders:write';

export interface TokenInfo {
  id: string;
  name: string;
  prefix: string;
  scopes: Scope[];
  createdAt: string;
  lastUsedAt?: string;
  useCount: number;
  revokedAt?: string;
}

export interface Mandate {
  buyer: string;
  agent: string;
  approver: string;
  currency: string;
  autoApproveLimit: number;
  weeklyBudget: number;
  spentThisWeek: number;
  allowedCategories: string[];
  requireOnTimeDelivery: boolean;
  requireRequirementsMatch: boolean;
  requireSubstituteApproval: boolean;
}

export type PromiseKind = 'finnish-origin' | 'eu-origin' | 'organic' | 'free-range' | 'fairtrade' | 'no-allergen';

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
  promise: { rules: PromiseRule[]; statement: string; published: boolean; version: number; updatedAt: string; updatedBy: string };
  kinds: Record<PromiseKind, { label: string; short: string }>;
  excluded: ExcludedProduct[];
  productCount: number;
  summary: { ordersChecked: number; ordersKeptPromise: number; fingerprint: string };
  publicUrl: string;
}

export interface Info {
  publicUrl: string;
  mcpUrl: string;
  jwksUrl: string;
  signingKeyId: string;
  signingKey: Record<string, string>;
  anonymousAllowed: boolean;
  scopes: Record<Scope, string>;
  presets: Record<string, Scope[]>;
  categories: string[];
  buyer: string;
  approver: string;
}

export interface Overview {
  mandate: Mandate;
  pending: Order[];
  orderCounts: { total: number; confirmed: number; pending: number; rejected: number };
  confirmedValue: number;
  tokens: { active: number; lastUsedAt?: string };
  recent: AuditEvent[];
  chainValid: boolean;
  stockAlerts: { key: string; message: string; status: 'reorder' | 'urgent' }[];
  disruptions: { orderId: string; summary: string }[];
  changesRequested: Order[];
  awaitingDelivery: number;
  shortDeliveries: Order[];
}

export interface OrderDetail {
  order: Order;
  quote?: Quote;
  events: AuditEvent[];
  chainValid: boolean;
  related: Order[];
}

export interface Changes {
  lines?: { productId: string; quantity: number }[];
  maxTotal?: number;
}

export interface CreatedToken {
  token: string;
  info: TokenInfo;
  connectorUrl: string;
}

export class ApiError extends Error {}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? res.statusText);
  return data as T;
}

export const api = {
  info: () => request<Info>('GET', '/info'),
  overview: () => request<Overview>('GET', '/overview'),
  tokens: () => request<TokenInfo[]>('GET', '/tokens'),
  createToken: (input: { name?: string; preset?: string }) => request<CreatedToken>('POST', '/tokens', input),
  renameToken: (id: string, name: string) => request<TokenInfo>('PATCH', `/tokens/${id}`, { name }),
  revokeToken: (id: string) => request<TokenInfo>('DELETE', `/tokens/${id}`),
  orders: () => request<Order[]>('GET', '/orders'),
  order: (id: string) => request<OrderDetail>('GET', `/orders/${id}`),
  decide: (id: string, approve: boolean, comment?: string) =>
    request<OrderDetail>('POST', `/orders/${id}/decision`, { approve, comment }),
  requestChanges: (id: string, changes: Changes, comment?: string) =>
    request<OrderDetail>('POST', `/orders/${id}/decision`, { changes, comment }),
  simulateDisruption: (id: string) => request<OrderDetail>('POST', `/orders/${id}/disruption`, {}),
  resolveDisruption: (id: string, optionId: string) =>
    request<OrderDetail>('POST', `/orders/${id}/disruption/resolve`, { optionId }),
  dismissDisruption: (id: string) => request<OrderDetail>('POST', `/orders/${id}/disruption/dismiss`, {}),
  recordDelivery: (id: string, input: { received?: { productId: string; quantity: number }[]; sample?: boolean }) =>
    request<OrderDetail>('POST', `/orders/${id}/delivery`, input),
  sendFollowUp: (id: string) => request<OrderDetail>('POST', `/orders/${id}/follow-up`, {}),
  stock: () => request<ReplenishmentResult>('GET', '/stock'),
  simulateDay: () => request<ReplenishmentResult>('POST', '/stock/simulate-day'),
  promise: () => request<PromiseState>('GET', '/promise'),
  previewPromise: (rules: PromiseRule[]) => request<{ excluded: ExcludedProduct[] }>('POST', '/promise/preview', { rules }),
  updatePromise: (patch: { rules?: PromiseRule[]; statement?: string; published?: boolean }) =>
    request<PromiseState & { changes: string[] }>('PUT', '/promise', patch),
  mandate: () => request<Mandate>('GET', '/mandate'),
  updateMandate: (patch: Partial<Mandate>) =>
    request<{ mandate: Mandate; changes: string[] }>('PUT', '/mandate', patch),
  audit: () => request<{ events: AuditEvent[]; chainValid: boolean }>('GET', '/audit'),
  assortment: () => request<AssortmentResult>('GET', '/assortment'),
  reset: () => request<{ ok: true }>('POST', '/reset'),
};

/**
 * Loads data and keeps it fresh by polling, so decisions made elsewhere (e.g. an order the agent places in
 * Claude) appear without a reload. Polling pauses while the tab is hidden.
 */
export function useLive<T>(load: () => Promise<T>, deps: unknown[] = [], intervalMs = 3000) {
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
    setData(undefined);
    refresh();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, intervalMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, refresh, loading: data === undefined && !error };
}

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { record } from './audit';
import { TOKENS_FILE } from './config';
import { mandate } from './mandate';
import { sha256, shortId } from './util';

// MCP access tokens. Each token is one agent identity under the buyer's mandate, with scopes limiting which
// tools it gets. Only a SHA-256 hash is stored; the plaintext is shown once (the console keeps it in the
// user's browser).

export const SCOPES = {
  'catalog:read': 'Browse the assortment, search offers, read the mandate and order status',
  'quotes:write': 'Request signed quotes',
  'orders:write': 'Place orders (still subject to the mandate and approvals)',
} as const;
export type Scope = keyof typeof SCOPES;
export const ALL_SCOPES = Object.keys(SCOPES) as Scope[];

export const PRESETS: Record<string, Scope[]> = {
  purchasing: ['catalog:read', 'quotes:write', 'orders:write'],
  quotes: ['catalog:read', 'quotes:write'],
  readonly: ['catalog:read'],
};

export interface TokenRecord {
  id: string;
  name: string;
  /** First characters of the token, safe to display */
  prefix: string;
  hash: string;
  scopes: Scope[];
  createdAt: string;
  lastUsedAt?: string;
  useCount: number;
  revokedAt?: string;
}

export type TokenInfo = Omit<TokenRecord, 'hash'>;

const tokens = new Map<string, TokenRecord>();

function load() {
  if (!existsSync(TOKENS_FILE)) return;
  try {
    for (const t of JSON.parse(readFileSync(TOKENS_FILE, 'utf8')) as TokenRecord[]) tokens.set(t.id, t);
  } catch (err) {
    console.error(`Could not read ${TOKENS_FILE}:`, err);
  }
}
load();

let saveTimer: NodeJS.Timeout | undefined;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    mkdirSync(dirname(TOKENS_FILE), { recursive: true });
    writeFileSync(TOKENS_FILE, JSON.stringify([...tokens.values()], null, 2));
  }, 300);
}

const info = ({ hash: _hash, ...rest }: TokenRecord): TokenInfo => rest;

export function listTokens(): TokenInfo[] {
  return [...tokens.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(info);
}

export function createToken(input: { name?: string; scopes?: Scope[] }): { token: string; info: TokenInfo } {
  const token = `aimo_${randomBytes(24).toString('base64url')}`;
  const now = new Date();
  const rec: TokenRecord = {
    id: shortId('T'),
    name:
      input.name?.trim() ||
      `Claude · ${now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${now.toISOString().slice(11, 16)}`,
    prefix: token.slice(0, 12),
    hash: sha256(token),
    scopes: input.scopes?.length ? input.scopes.filter((s) => s in SCOPES) : PRESETS.purchasing,
    createdAt: now.toISOString(),
    useCount: 0,
  };
  tokens.set(rec.id, rec);
  save();
  record(`human: ${mandate.approver}`, 'token_created', `Created MCP token "${rec.name}"`, {}, `Scopes: ${rec.scopes.join(', ')}`);
  return { token, info: info(rec) };
}

export function renameToken(id: string, name: string): TokenInfo | undefined {
  const rec = tokens.get(id);
  if (!rec || !name.trim()) return undefined;
  rec.name = name.trim();
  save();
  return info(rec);
}

export function revokeToken(id: string): TokenInfo | undefined {
  const rec = tokens.get(id);
  if (!rec) return undefined;
  if (!rec.revokedAt) {
    rec.revokedAt = new Date().toISOString();
    save();
    record(`human: ${mandate.approver}`, 'token_revoked', `Revoked MCP token "${rec.name}"`, {});
  }
  return info(rec);
}

/** Finds the active token matching a presented secret, and marks it used. */
export function authenticate(presented: string | undefined): TokenRecord | undefined {
  if (!presented?.startsWith('aimo_')) return undefined;
  const hash = Buffer.from(sha256(presented));
  for (const rec of tokens.values()) {
    if (rec.revokedAt) continue;
    const candidate = Buffer.from(rec.hash);
    if (candidate.length === hash.length && timingSafeEqual(candidate, hash)) {
      rec.lastUsedAt = new Date().toISOString();
      rec.useCount += 1;
      save();
      return rec;
    }
  }
  return undefined;
}

// --- per-request identity -------------------------------------------------------

export interface RequestIdentity {
  /** undefined = anonymous access (only when ALLOW_ANONYMOUS is on) */
  token?: TokenRecord;
}

export const identity = new AsyncLocalStorage<RequestIdentity>();

export function currentScopes(): Scope[] {
  const id = identity.getStore();
  return id?.token ? id.token.scopes : ALL_SCOPES;
}

export function hasScope(scope: Scope): boolean {
  return currentScopes().includes(scope);
}

/** Audit actor for the agent behind the current request. */
export function currentAgent(): string {
  const token = identity.getStore()?.token;
  return `agent: ${token ? token.name : mandate.agent}`;
}


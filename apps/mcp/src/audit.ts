import type { AuditEvent } from './types';
import { canonicalJson, sha256 } from './util';

// Append-only, hash-chained log: each event's hash covers the previous hash, so any edit breaks the chain.
const events: AuditEvent[] = [];
const GENESIS = '0'.repeat(64);

function hashOf(event: Omit<AuditEvent, 'hash'>): string {
  return sha256(event.prevHash + canonicalJson(event));
}

export function record(
  actor: string,
  action: string,
  summary: string,
  refs: AuditEvent['refs'],
  reason?: string,
): AuditEvent {
  const prevHash = events.at(-1)?.hash ?? GENESIS;
  const base = { seq: events.length + 1, at: new Date().toISOString(), actor, action, summary, reason, refs, prevHash };
  const event = { ...base, hash: hashOf(base) };
  events.push(event);
  return event;
}

export function verifyChain(): boolean {
  let prev = GENESIS;
  for (const { hash, ...rest } of events) {
    if (rest.prevHash !== prev || hashOf(rest) !== hash) return false;
    prev = hash;
  }
  return true;
}

/**
 * Events belonging to one order: its search (shared by all quotes from that search), its own quote and the
 * order itself — but not sibling quotes/orders that came from the same search.
 */
export function eventsFor(refs: { searchId?: string; quoteId?: string; orderId?: string }): AuditEvent[] {
  return events.filter(
    (e) =>
      (refs.orderId && e.refs.orderId === refs.orderId) ||
      (refs.quoteId && e.refs.quoteId === refs.quoteId && !e.refs.orderId) ||
      (refs.searchId && e.refs.searchId === refs.searchId && !e.refs.quoteId),
  );
}

/** Demo only: start over with an empty log. */
export function resetAudit() {
  events.length = 0;
}

export function allEvents(): AuditEvent[] {
  return [...events];
}

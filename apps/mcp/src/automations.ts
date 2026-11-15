import { record } from './audit';
import { getProduct } from './catalog';
import * as events from './events';
import * as fulfilment from './fulfilment';
import * as gateway from './gateway';
import { kitchenItems } from './kitchen';
import type { AutomationRun, AutomationSettings } from './types';
import { addDays, eur, formatDate, today } from './util';

// Automations the buyer switches on in the assistant: a stock autopilot that reorders what runs low, and event
// reminders (optionally ordering event baskets on their own). Everything they order goes through the same
// rules as the agent: limits, budget, promise, approvals.

export const AUTOPILOT = 'agent: Stock autopilot';
export const EVENT_PLANNER = 'agent: Event planner';

export type { AutomationRun, AutomationSettings };

const defaults = (): AutomationSettings => ({
  stock: { enabled: true, mode: 'ask', items: Object.fromEntries(kitchenItems().map((i) => [i.key, true])) },
  events: { enabled: true, remindDaysBefore: 7, autoOrder: false },
});

export let settings: AutomationSettings = defaults();
const runs: AutomationRun[] = [];

gateway.onReset(() => {
  settings = defaults();
  runs.length = 0;
});

export const automationRuns = () => [...runs].reverse().slice(0, 30);

function log(run: Omit<AutomationRun, 'at'>) {
  runs.push({ ...run, at: new Date().toISOString() });
}

export function updateSettings(patch: { stock?: Partial<AutomationSettings['stock']>; events?: Partial<AutomationSettings['events']> }) {
  const before = JSON.stringify(settings);
  if (patch.stock) {
    const s = patch.stock;
    if (typeof s.enabled === 'boolean') settings.stock.enabled = s.enabled;
    if (s.mode === 'ask' || s.mode === 'auto') settings.stock.mode = s.mode;
    if (s.items && typeof s.items === 'object') {
      for (const [k, v] of Object.entries(s.items)) if (k in settings.stock.items && typeof v === 'boolean') settings.stock.items[k] = v;
    }
  }
  if (patch.events) {
    const e = patch.events;
    if (typeof e.enabled === 'boolean') settings.events.enabled = e.enabled;
    if (typeof e.autoOrder === 'boolean') settings.events.autoOrder = e.autoOrder;
    if (typeof e.remindDaysBefore === 'number' && e.remindDaysBefore >= 1 && e.remindDaysBefore <= 30) {
      settings.events.remindDaysBefore = Math.round(e.remindDaysBefore);
    }
  }
  if (JSON.stringify(settings) !== before) {
    record(
      gateway.ACTORS.approver(),
      'automations_changed',
      'Changed the automations',
      {},
      `Stock autopilot ${settings.stock.enabled ? settings.stock.mode : 'off'}; event reminders ${settings.events.enabled ? `${settings.events.remindDaysBefore} days before${settings.events.autoOrder ? ', auto-order' : ''}` : 'off'}`,
    );
    runAutomations();
  }
  return settings;
}

/** Items the autopilot already ordered and that still wait for approval: don't order them twice. */
function waitingGroups(): Set<string> {
  return new Set(
    gateway
      .listOrders()
      .filter((o) => o.placedBy === AUTOPILOT && o.status === 'pending_approval')
      .flatMap((o) => o.lines.map((l) => getProduct(l.productId)?.equivalenceGroup ?? '')),
  );
}

/** Stock items due for a reorder that the autopilot looks after. */
export function dueStock(keys?: string[]) {
  const waiting = waitingGroups();
  const kitchen = new Map(kitchenItems().map((i) => [i.key, i]));
  return fulfilment
    .replenishment()
    .items.filter(
      (i) =>
        i.suggestion &&
        (!keys || keys.includes(i.key)) &&
        !kitchen.get(i.key)?.groups.some((g) => waiting.has(g)),
    );
}

/** Orders the suggested reorder for the given items (all due items when none given). */
export function orderStock(actor: string, keys?: string[], rationale?: string) {
  const due = dueStock(keys);
  if (!due.length) throw new gateway.GatewayError('Nothing needs reordering right now');
  const neededBy = due.map((i) => i.suggestion!.neededBy).sort()[0];
  const quote = gateway.requestQuote(
    {
      lines: due.map((i) => ({ productId: i.suggestion!.line.productId, quantity: i.suggestion!.line.quantity })),
      neededBy,
      explanation: `Restock: ${due.map((i) => `${i.message.toLowerCase()} (${i.suggestion!.line.packs} × ${i.suggestion!.line.packLabel})`).join('; ')}. Each reorder covers up to a week, never more than the product keeps.`,
      rationale,
    },
    actor,
  ).quote;
  return gateway.placeOrder({ quoteId: quote.quoteId, rationale }, actor);
}

/** Runs the automations that act on their own. Safe to call often. */
export function runAutomations() {
  if (settings.stock.enabled && settings.stock.mode === 'auto') {
    const keys = Object.entries(settings.stock.items).filter(([, on]) => on).map(([k]) => k);
    const due = dueStock(keys);
    if (due.length) {
      try {
        const r = orderStock(AUTOPILOT, due.map((i) => i.key), 'Stock autopilot: running low');
        log({
          automation: 'stock',
          summary: `Reordered ${due.map((i) => i.name.toLowerCase()).join(', ')} (${eur(r.order.total)})`,
          orderId: r.order.orderId,
          status: r.order.status,
        });
      } catch (err) {
        log({ automation: 'stock', summary: `Couldn't reorder: ${err instanceof Error ? err.message : String(err)}` });
      }
    }
  }
  if (settings.events.enabled && settings.events.autoOrder) {
    const limit = addDays(today(), settings.events.remindDaysBefore);
    for (const e of events.listEvents()) {
      if (e.status !== 'planned' || e.date > limit) continue;
      try {
        const { order } = events.orderEvent(e.id, EVENT_PLANNER);
        log({
          automation: 'events',
          summary: `Ordered for ${e.name} (${formatDate(e.date)}): ${eur(order.order.total)}`,
          orderId: order.order.orderId,
          status: order.order.status,
        });
      } catch (err) {
        log({ automation: 'events', summary: `Couldn't order for ${e.name}: ${err instanceof Error ? err.message : String(err)}` });
      }
    }
  }
}

export function recordManualRun(automation: AutomationRun['automation'], summary: string, orderId?: string, status?: string) {
  log({ automation, summary, orderId, status });
}

export const autopilotActive = () => settings.stock.enabled && settings.stock.mode === 'auto';

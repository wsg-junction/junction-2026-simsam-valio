import { record } from './audit';
import * as gateway from './gateway';
import { mandate } from './mandate';
import * as planner from './planner';
import type { BasketResult, EventView, KitchenEvent, OrderResult } from './types';
import { addDays, formatDate, shortId, today } from './util';

// Big events the kitchen caters for (conferences, weddings…). Each one becomes a basket that can be ordered in
// one click, and reminders appear in good time. Synthetic seed data; in memory, reset with the demo.

export type { EventView, KitchenEvent };

const events = new Map<string, KitchenEvent>();

function seed() {
  events.clear();
  const now = new Date().toISOString();
  const add = (e: Omit<KitchenEvent, 'id' | 'status' | 'createdAt'>) => {
    const id = shortId('E');
    events.set(id, { ...e, id, status: 'planned', createdAt: now });
  };
  add({ name: 'Board meeting coffee break', date: addDays(today(), 2), meal: 'coffee-break', guests: 40, vegan: 4 });
  add({ name: 'Nordic Tech Summit breakfast', date: addDays(today(), 4), meal: 'breakfast', guests: 180, vegan: 20, budget: 450 });
  add({ name: 'Virtanen–Korhonen wedding brunch', date: addDays(today(), 11), meal: 'brunch', guests: 120, vegan: 12, budget: 600 });
}
seed();
gateway.onReset(seed);

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

function basketFor(e: KitchenEvent, keep: boolean, actor?: string): BasketResult {
  return planner.planBasket(
    { meal: e.meal, guests: e.guests, vegan: e.vegan, budget: e.budget, neededBy: addDays(e.date, -1) },
    actor,
    keep,
  );
}

export function view(e: KitchenEvent): EventView {
  const b = basketFor(e, false);
  const order = e.orderId ? gateway.listOrders().find((o) => o.orderId === e.orderId) : undefined;
  return {
    ...e,
    orderBy: addDays(e.date, -3) < today() ? today() : addDays(e.date, -3),
    daysUntil: daysBetween(today(), e.date),
    estimate: {
      total: b.total,
      items: b.lines.length,
      withinBudget: b.withinBudget,
      needsApproval: b.lines.some((l) => l.outsideRules) || b.total > mandate.autoApproveLimit,
    },
    orderStatus: order?.status,
  };
}

export function listEvents(): EventView[] {
  return [...events.values()].filter((e) => e.date >= today()).sort((a, b) => a.date.localeCompare(b.date)).map(view);
}

export function addEvent(input: Omit<KitchenEvent, 'id' | 'status' | 'createdAt' | 'orderId'>): EventView {
  if (!input.name.trim()) throw new gateway.GatewayError('Give the event a name');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || input.date < today()) throw new gateway.GatewayError('Pick a date from today on');
  if (!(input.guests > 0)) throw new gateway.GatewayError('Give the number of guests');
  const e: KitchenEvent = {
    ...input,
    name: input.name.trim(),
    guests: Math.round(input.guests),
    vegan: Math.min(Math.round(input.guests), Math.max(0, Math.round(input.vegan || 0))),
    id: shortId('E'),
    status: 'planned',
    createdAt: new Date().toISOString(),
  };
  events.set(e.id, e);
  record(gateway.ACTORS.approver(), 'event_added', `Added event "${e.name}" on ${formatDate(e.date)} for ${e.guests} guests`, {});
  return view(e);
}

export function removeEvent(id: string) {
  const e = events.get(id);
  if (!e) throw new gateway.GatewayError('Event not found');
  events.delete(id);
  record(gateway.ACTORS.approver(), 'event_removed', `Removed event "${e.name}"`, {});
}

/** One click: plan the basket for the event and order it (through the rules as usual). */
export function orderEvent(id: string, actor: string): { order: OrderResult; basket: BasketResult } {
  const e = events.get(id);
  if (!e) throw new gateway.GatewayError('Event not found');
  if (e.status === 'ordered' && e.orderId) return { order: gateway.getOrder(e.orderId), basket: basketFor(e, false) };
  const basket = basketFor(e, true, actor);
  if (!basket.lines.length) throw new gateway.GatewayError('Nothing to order for this event');
  const quote = gateway.requestQuote(
    {
      lines: basket.lines.map((l) => ({ productId: l.line.productId, quantity: l.line.quantity })),
      neededBy: basket.neededBy,
      basketId: basket.basketId,
      explanation: `For ${e.name} on ${formatDate(e.date)}: ${basket.explanation}`,
      rationale: `Ordered for the event "${e.name}"`,
    },
    actor,
  ).quote;
  const order = gateway.placeOrder({ quoteId: quote.quoteId, rationale: `Event: ${e.name}` }, actor);
  e.status = 'ordered';
  e.orderId = order.order.orderId;
  return { order, basket };
}

export function getEvent(id: string) {
  return events.get(id);
}

import * as automations from './automations';
import * as events from './events';
import * as fulfilment from './fulfilment';
import * as gateway from './gateway';
import { GEMINI_MODEL, geminiChat, geminiEnabled } from './llm';
import { mandate } from './mandate';
import * as planner from './planner';
import { promiseLabels, sourcing } from './sourcing';
import type {
  AssistantAction,
  AssistantCard,
  AssistantReply,
  AttentionItem,
  Meal,
  OrderResult,
} from './types';
import { addDays, formatDate, qty, today } from './util';
import { supplier, supplierEnabled, supplierMockEnabled } from './supplier';

// "Aimo Assistant": a mock consumer chatbot (no LLM). A small rule-based intent router turns a message into
// calls to the real gateway, so every answer, card and order is backed by the same rules, promise and audit
// trail as an external agent. Actions clicked in the chat are logged as the buyer.

export const ASSISTANT = 'agent: Aimo Assistant';
export const BUYER = `buyer: ${mandate.buyer} user (in Aimo Assistant)`;

export type Card = AssistantCard;
export type Reply = AssistantReply;

// --- parsing ------------------------------------------------------------------------

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Finds a date in the message ("by Monday", "tomorrow", "in 3 days", "20 Nov", "2026-11-20"). */
export function parseDate(text: string): { date?: string; match?: string } {
  const t = text.toLowerCase();
  let m: RegExpMatchArray | null;
  if ((m = t.match(/\b(\d{4}-\d{2}-\d{2})\b/))) return { date: m[1], match: m[0] };
  if ((m = t.match(/\b(?:by |on |for )?(today|tomorrow)\b/))) return { date: addDays(today(), m[1] === 'today' ? 0 : 1), match: m[0] };
  if ((m = t.match(/\bin (\d+) days?\b/))) return { date: addDays(today(), Number(m[1])), match: m[0] };
  if ((m = t.match(/\b(?:by |on |for |next )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/))) {
    const now = new Date(`${today()}T00:00:00Z`).getUTCDay();
    const diff = (WEEKDAYS.indexOf(m[1]) - now + 7) % 7 || 7;
    return { date: addDays(today(), diff), match: m[0] };
  }
  if ((m = t.match(/\b(?:by |on )?(\d{1,2})\.? ?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/))) {
    const year = Number(today().slice(0, 4));
    let d = `${year}-${String(MONTHS.indexOf(m[2]) + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    if (d < today()) d = `${year + 1}${d.slice(4)}`;
    return { date: d, match: m[0] };
  }
  return {};
}

function parseQuantity(text: string): { quantity?: number; match?: string } {
  const m = text
    .toLowerCase()
    .match(/(\d[\d,. ]*)\s*(l|litres?|liters?|kg|kilos?|kilograms?|pcs|pieces|eggs|trays?)\b/);
  if (!m) return {};
  const n = Number(m[1].replace(/[ ,]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return {};
  return { quantity: /tray/.test(m[2]) ? n * 180 : n, match: m[0] };
}

const FILLER =
  /\b(i|we|need|needs|want|would|like|to|please|can|could|you|get|us|me|buy|order|ordering|purchase|find|search|for|by|the|a|an|some|of|our|hotel|aurora|show|looking|it|and|best|cheapest|option|options|do|have|any|is|there|what|which|how|much|price|prices|deliver|delivered|delivery)\b/g;

const cleanQuery = (text: string, ...remove: (string | undefined)[]) => {
  let q = text.toLowerCase();
  for (const r of remove) if (r) q = q.replace(r, ' ');
  return q.replace(/[?!.,€]/g, ' ').replace(FILLER, ' ').replace(/\s+/g, ' ').trim();
};

const wantsToOrder = (t: string) => /\b(order|buy|purchase|get me|book)\b/.test(t) && !/\b(status|my orders|orders\b)/.test(t);

// --- replies ---------------------------------------------------------------------------

function help(): Reply {
  return {
    text: `Hi ${mandate.approver.split(' ')[0]}! I buy for ${mandate.buyer} from Valio Aimo, within your limits and requirements. I can find products and order them, plan baskets for events, watch your stock and sort out supplier problems.`,
    cards: [],
    suggestions: [
      'I need 1,000 L of lactose-free milk by Monday',
      'Breakfast for 180 guests, 20 vegan, budget €450',
      'What is running low?',
      'Show upcoming events',
    ],
  };
}

function orderReply(r: OrderResult, intro: string): Reply {
  const o = r.order;
  const status =
    o.status === 'confirmed'
      ? `It's confirmed (${gateway.money(o.total)}).`
      : o.status === 'pending_approval'
        ? `It's waiting for your approval (${gateway.money(o.total)}) because: ${o.checks
            .filter((c) => !c.passed)
            .map((c) => c.detail)
            .join(', ')}.`
        : `Status: ${o.status.replace('_', ' ')}.`;
  return { text: `${intro} ${status}`, cards: [{ type: 'order', data: r }] };
}

function basketReply(text: string, t: string): Reply {
  const meal: Meal = /brunch/.test(t) ? 'brunch' : /coffee/.test(t) ? 'coffee-break' : 'breakfast';
  const guests = Number(t.match(/(\d[\d,]*)\s*(?:guests|people|persons|pax|visitors|attendees)/)?.[1]?.replace(/,/g, '') ?? 0);
  const vegan = Number(t.match(/(\d+)\s*(?:of them\s*)?(?:are\s*)?vegans?\b/)?.[1] ?? 0);
  const budget = Number(t.match(/(?:budget|max|under|up to)\D{0,6}(\d[\d,]*)/)?.[1]?.replace(/,/g, '') ?? t.match(/€\s?(\d[\d,]*)/)?.[1]?.replace(/,/g, '') ?? 0);
  const { date } = parseDate(text);
  if (!guests) {
    return { text: `How many guests is the ${meal.replace('-', ' ')} for? For example: "${meal.replace('-', ' ')} for 120 guests, 10 vegan, budget €400".`, cards: [] };
  }
  const neededBy = date ? addDays(date, date === today() ? 0 : -1) : undefined;
  const b = planner.planBasket(
    { meal, guests, vegan, budget: budget || undefined, neededBy: neededBy && neededBy >= today() ? neededBy : undefined },
    ASSISTANT,
  );
  return {
    text: [
      `Here's a basket: ${b.lines.length} items for ${gateway.money(b.total)}`,
      b.budget !== undefined ? (b.withinBudget ? `, ${gateway.money(b.budget - b.total)} under budget` : `, ${gateway.money(b.total - b.budget)} over budget`) : '',
      '. ',
      b.lines.some((l) => l.outsideRules) ? `${b.lines.filter((l) => l.outsideRules).map((l) => l.role).join(' and ')} ${b.lines.filter((l) => l.outsideRules).length === 1 ? 'is' : 'are'} outside your categories, so ordering it needs your approval. ` : '',
      'Nothing is ordered yet.',
    ].join(''),
    cards: [{ type: 'basket', data: b }],
    suggestions: ['Order this basket', 'Show upcoming events'],
  };
}

function stockReply(t: string): Reply {
  const r = fulfilment.replenishment();
  const due = r.items.filter((i) => i.suggestion);
  if (/\b(reorder|restock|top up|order|buy)\b/.test(t) && due.length) {
    const result = automations.orderStock(ASSISTANT, undefined, 'Asked in the assistant to restock');
    automations.recordManualRun('stock', `Reordered from the chat (${gateway.money(result.order.total)})`, result.order.orderId, result.order.status);
    return orderReply(result, `I reordered ${due.map((i) => i.name.toLowerCase()).join(' and ')}, each sized to the shelf life.`);
  }
  const low = r.items.filter((i) => i.status !== 'ok');
  return {
    text: low.length
      ? `${low.map((i) => i.message).join('. ')}. I suggest a reorder of ${gateway.money(r.suggestedTotal)}${automations.autopilotActive() ? '; the stock autopilot will order it on its own' : ''}.`
      : 'Nothing runs out this week.',
    cards: [{ type: 'stock', data: r }],
    suggestions: due.length ? ['Reorder what is running low'] : [],
  };
}

function disruptionsReply(): Reply {
  const r = fulfilment.openDisruptions();
  return {
    text: r.orders.length
      ? `${r.orders.length === 1 ? 'One supplier problem' : `${r.orders.length} supplier problems`}. ${r.orders[0].summary}. Pick a replacement below; the same product is listed first.`
      : 'No supplier problems: every confirmed order is on track.',
    cards: r.orders.length ? [{ type: 'disruptions', data: r }] : [],
  };
}

function deliveryReply(text: string): Reply {
  const id = text.match(/\bO-[0-9A-F]{8}\b/i)?.[0]?.toUpperCase();
  const orders = gateway.listOrders();
  if (id) {
    const o = orders.find((x) => x.orderId === id);
    if (!o) return { text: `I can't find order ${id}.`, cards: [] };
    if (!o.delivery) return { text: `Order ${id} hasn't been delivered yet. When it arrives, tell me what you received, e.g. "${id} arrived, we got 590 L".`, cards: [{ type: 'order', data: gateway.getOrder(id) }] };
    const r = fulfilment.getReconciliation(id);
    return { text: r.delivery.shortValue ? `Order ${id} was short by ${gateway.money(r.delivery.shortValue)}. I drafted a follow-up for you.` : `Order ${id} arrived complete.`, cards: [{ type: 'reconciliation', data: r }] };
  }
  const short = orders.filter((o) => o.delivery?.followUp && !o.delivery.followUp.sentAt);
  if (short.length) {
    return {
      text: `${short.length === 1 ? 'One delivery was' : `${short.length} deliveries were`} short. Here's the comparison and a draft follow-up.`,
      cards: short.slice(0, 2).map((o) => ({ type: 'reconciliation' as const, data: fulfilment.getReconciliation(o.orderId) })),
    };
  }
  const open = orders.filter((o) => o.status === 'confirmed' && !o.delivery);
  return {
    text: open.length ? `${open.length} order(s) are on their way and nothing is short so far.` : 'No deliveries to check right now.',
    cards: open.length ? [{ type: 'orders', data: open }] : [],
  };
}

function receivedReply(text: string, t: string): Reply | undefined {
  const id = text.match(/\bO-[0-9A-F]{8}\b/i)?.[0]?.toUpperCase();
  const { quantity } = parseQuantity(t);
  if (!id || quantity === undefined || !/\b(arrived|received|got|delivered)\b/.test(t)) return undefined;
  const o = gateway.findOrder(id);
  if (o.lines.length !== 1) return { text: `Order ${id} has several products; record it on the order page.`, cards: [] };
  const r = fulfilment.recordDelivery(id, { received: [{ productId: o.lines[0].productId, quantity }] }, BUYER);
  return {
    text: r.delivery.shortValue ? `Recorded. It's ${gateway.money(r.delivery.shortValue)} short, so I drafted a follow-up to Valio Aimo.` : 'Recorded: the delivery is complete.',
    cards: [{ type: 'reconciliation', data: r }],
  };
}

function searchReply(text: string, t: string): Reply {
  const date = parseDate(text);
  const q = parseQuantity(text);
  const query = cleanQuery(text, date.match, q.match).replace(/\b\d+\b/g, ' ').trim();
  if (!query) return help();
  const r = gateway.search({ query, quantity: q.quantity, neededBy: date.date }, ASSISTANT);
  if (!r.offers.length) {
    const promise = r.excluded.filter((e) => e.promise);
    return {
      text: promise.length
        ? `I found ${promise.length === 1 ? promise[0].productName : `${promise.length} matching products`}, but ${promise.length === 1 ? 'it breaks' : 'they break'} your requirements (${promise[0].reason.replace('breaks your promise: ', '')}). I won't buy that.`
        : `I couldn't find "${query}" in the Valio Aimo assortment. Try milk, cream, yoghurt, butter, cheese, eggs, oat drink or coffee.`,
      cards: [],
    };
  }
  const best = r.offers.find((o) => o.badge === 'best-value');
  if (best && wantsToOrder(t) && q.quantity) {
    const quote = gateway.requestQuote(
      { lines: best.lines.map((l) => ({ productId: l.productId, quantity: l.quantity })), neededBy: r.neededBy, searchId: r.searchId, offerId: best.offerId, rationale: 'Best value for the request in the assistant' },
      ASSISTANT,
    ).quote;
    const order = gateway.placeOrder({ quoteId: quote.quoteId, rationale: best.explanation }, ASSISTANT);
    const reply = orderReply(order, `I ordered the best value: ${best.title}. ${best.explanation}`);
    return { ...reply, cards: [...reply.cards, { type: 'offers', data: r }] };
  }
  if (best && /\b(quote|price|cost)\b/.test(t)) return action({ type: 'quote-offer', searchId: r.searchId, offerId: best.offerId }, ASSISTANT);
  const note = r.usageNote ? ` Heads-up: ${r.usageNote}` : '';
  return {
    text: best
      ? `${r.offers.length} options. The best value is ${gateway.money(best.total)}, all delivered by ${formatDate(best.lastDeliveryDate)}.${note}`
      : `${r.offers.length} options, but none fully meets the request; ordering one needs your approval.${note}`,
    cards: [{ type: 'offers', data: r }],
    suggestions: [],
  };
}

/**
 * One chat turn. With GEMINI_API_KEY set, Gemini answers and calls the gateway as tools; without it (or if the
 * call fails) the rule-based mock answers.
 */
export async function chatTurn(
  message: string,
  conversationId: string,
  history: { role: 'user' | 'assistant'; text: string }[],
): Promise<Reply> {
  if (geminiEnabled()) {
    try {
      return { ...(await geminiChat(message.trim().slice(0, 12000), history, ASSISTANT, undefined, conversationId)), engine: 'gemini' };
    } catch (err) {
      console.error(`Gemini (${GEMINI_MODEL}) failed, using the rule-based assistant:`, err instanceof Error ? err.message : err);
      return { engine: 'rules', text: 'The assistant is unavailable right now. Please try again. Check your orders before retrying a purchase.', cards: [] };
    }
  }
  if (supplierEnabled()) {
    const date = parseDate(message);
    if (!date.date) return { engine: 'rules', text: 'What delivery date should I check with Valio Aimo?', cards: [] };
    const q = parseQuantity(message);
    const query = cleanQuery(message, date.match, q.match);
    try {
      const result = await supplier.search(query, date.date);
      return { engine: 'rules', text: 'Here are the supplier results for that date. Conversational combined estimates require the Gemini engine.', cards: [{ type: 'supplier-products', data: result }] };
    } catch { return { engine: 'rules', text: 'The supplier API could not complete this lookup. No demo prices were substituted.', cards: [] }; }
  }
  return { ...chat(message, conversationId), engine: 'rules' };
}

export const engineInfo = () => ({ engine: geminiEnabled() ? 'gemini' : 'rules', model: geminiEnabled() ? GEMINI_MODEL : undefined, supplier: supplierEnabled() ? (supplierMockEnabled() ? 'mock' : 'valio-api') : 'demo' });

/** Remembers the last search per conversation so "order the best value" works. */
const lastSearch = new Map<string, string>();
const lastBasket = new Map<string, string>();

export function chat(message: string, conversationId = 'default'): Reply {
  const text = message.trim().slice(0, 500);
  const t = text.toLowerCase();
  try {
    if (!t || /^(hi|hello|hey|moi|help|what can you do)\b/.test(t)) return help();

    if (/\b(order|buy)\b.*\b(best value|best one|that one|it|first)\b/.test(t) && lastSearch.has(conversationId)) {
      const r = gateway.getSearch(lastSearch.get(conversationId)!);
      const best = r?.offers.find((o) => o.badge === 'best-value') ?? r?.offers[0];
      if (r && best) return action({ type: 'order-offer', searchId: r.searchId, offerId: best.offerId }, ASSISTANT);
    }
    if (/\b(order|buy)\b.*\bbasket\b/.test(t) && lastBasket.has(conversationId)) {
      return action({ type: 'order-basket', basketId: lastBasket.get(conversationId)! }, ASSISTANT);
    }

    const received = receivedReply(text, t);
    if (received) return received;

    let reply: Reply;
    if (/\b(breakfast|brunch|coffee[ -]?break)\b/.test(t)) reply = basketReply(text, t);
    else if (/\b(events?|wedding|conference|summit|party)\b/.test(t)) reply = eventsReply();
    else if (/\b(stock|inventory|running (low|out)|run out|runs out|low on|restock|reorder)\b/.test(t)) reply = stockReply(t);
    else if (/\b(supplier|disruption|problem|can'?t deliver|cannot deliver|replacement)\b/.test(t)) reply = disruptionsReply();
    else if (/\b(deliver(y|ies|ed)?|arriv\w*|received|reconcil\w*|short)\b/.test(t) && !parseQuantity(t).quantity) reply = deliveryReply(text);
    else if (/\b(my orders|order status|orders|pending|approvals?|waiting)\b/.test(t)) reply = ordersReply();
    else if (/\b(limits?|budget|spend|spent|allowance)\b/.test(t)) reply = limitsReply();
    else if (/\b(requirements?|promise|sourcing|vegan only|organic only|eu only)\b/.test(t)) reply = requirementsReply();
    else reply = searchReply(text, t);

    for (const c of reply.cards) {
      if (c.type === 'offers') lastSearch.set(conversationId, c.data.searchId);
      if (c.type === 'basket') lastBasket.set(conversationId, c.data.basketId);
    }
    return reply;
  } catch (err) {
    if (err instanceof gateway.GatewayError) return { text: err.message, cards: [] };
    throw err;
  }
}

function eventsReply(): Reply {
  const list = events.listEvents();
  const next = list.find((e) => e.status === 'planned');
  return {
    text: list.length
      ? `${list.length} upcoming event(s).${next ? ` Next to order: ${next.name} on ${formatDate(next.date)}, about ${gateway.money(next.estimate.total)}; order by ${formatDate(next.orderBy)}.` : ' Everything is ordered.'}`
      : 'No upcoming events. Add one under Automations.',
    cards: list.length ? [{ type: 'events', data: list }] : [],
  };
}

function ordersReply(): Reply {
  const orders = gateway.listOrders().slice(0, 8);
  const pending = orders.filter((o) => o.status === 'pending_approval');
  return {
    text: orders.length
      ? `${orders.length} recent order(s)${pending.length ? `, ${pending.length} waiting for your approval` : ''}.`
      : 'No orders yet.',
    cards: orders.length ? [{ type: 'orders', data: orders }] : [],
  };
}

function limitsReply(): Reply {
  return {
    text: `I can order on my own up to ${gateway.money(mandate.autoApproveLimit)} per order and ${gateway.money(mandate.weeklyBudget)} per week (${gateway.money(mandate.spentThisWeek)} spent so far). Anything above that waits for you. You can change this under Limits; I can't change it myself.`,
    cards: [
      {
        type: 'limits',
        data: { perOrder: mandate.autoApproveLimit, perWeek: mandate.weeklyBudget, spent: mandate.spentThisWeek, categories: mandate.allowedCategories },
      },
    ],
  };
}

function requirementsReply(): Reply {
  return {
    text: sourcing.rules.length
      ? `I only buy products that meet your requirements: ${promiseLabels().join('; ')}. No one can approve an exception; change them under Requirements.`
      : 'You have no requirements set. Add them under Requirements (e.g. vegan only, EU origin only).',
    cards: [{ type: 'requirements', data: { rules: promiseLabels(), statement: sourcing.statement } }],
  };
}

// --- one-click actions ---------------------------------------------------------------------

export type Action = AssistantAction;

export function action(a: Action, actor: string = BUYER): Reply {
  if (supplierEnabled()) return { text: 'This is a local demo action. In supplier API mode, ask Aimo for a combined estimate. Supplier order submission is not supported by the challenge API.', cards: [] };
  try {
    switch (a.type) {
      case 'place-quote':
        return orderReply(gateway.placeOrder({ quoteId: a.quoteId }, actor), 'Order submitted.');
      case 'quote-offer':
      case 'order-offer': {
        const r = gateway.getSearch(a.searchId);
        const offer = r?.offers.find((o) => o.offerId === a.offerId);
        if (!r || !offer) throw new gateway.GatewayError('That offer has expired; search again.');
        const quote = gateway.requestQuote(
          { lines: offer.lines.map((l) => ({ productId: l.productId, quantity: l.quantity })), neededBy: r.neededBy, searchId: r.searchId, offerId: offer.offerId, rationale: 'Chosen in the assistant' },
          actor,
        ).quote;
        if (a.type === 'quote-offer') return { text: 'Here is your total quote. Nothing has been ordered.', cards: [{ type: 'quote', data: { kind: 'quote', quote, verifyUrl: '/quotes/' + quote.quoteId } }] };
        const existing = gateway.listOrders().find((o) => gateway.getQuote(o.quoteId)?.searchId === r.searchId && gateway.getQuote(o.quoteId)?.offerId === offer.offerId);
        if (existing) return orderReply(gateway.getOrder(existing.orderId), 'This offer has already been submitted.');
        return orderReply(gateway.placeOrder({ quoteId: quote.quoteId, rationale: offer.explanation }, actor), 'Order submitted.');
      }
      case 'quote-basket':
      case 'order-basket': {
        const b = planner.getBasket(a.basketId);
        if (!b) throw new gateway.GatewayError('That basket has expired; ask again.');
        const quote = gateway.requestQuote(
          { lines: b.lines.map((l) => ({ productId: l.line.productId, quantity: l.line.quantity })), neededBy: b.neededBy, basketId: b.basketId, explanation: b.explanation, rationale: 'Basket ordered in the assistant' },
          actor,
        ).quote;
        if (a.type === 'quote-basket') return { text: 'Here is the total quote for your basket. Nothing has been ordered.', cards: [{ type: 'quote', data: { kind: 'quote', quote, verifyUrl: `/quotes/${quote.quoteId}` } }] };
        return orderReply(gateway.placeOrder({ quoteId: quote.quoteId }, actor), `Ordered the ${b.meal.replace('-', ' ')} basket for ${b.guests} guests.`);
      }
      case 'order-stock': {
        const r = automations.orderStock(actor, a.keys, 'Restock from the assistant');
        automations.recordManualRun('stock', `Reordered with one click (${gateway.money(r.order.total)})`, r.order.orderId, r.order.status);
        return orderReply(r, 'Reordered.');
      }
      case 'order-event': {
        const e = events.getEvent(a.eventId);
        const { order } = events.orderEvent(a.eventId, actor);
        automations.recordManualRun('events', `Ordered for ${e?.name} with one click (${gateway.money(order.order.total)})`, order.order.orderId, order.order.status);
        return orderReply(order, `Ordered everything for ${e?.name}.`);
      }
      case 'resolve-disruption': {
        const r = fulfilment.resolveDisruption({ orderId: a.orderId, optionId: a.optionId, rationale: 'Chosen in the assistant' }, actor);
        return orderReply(r, 'Replacement ordered.');
      }
      case 'decide': {
        gateway.decide(a.orderId, a.approve, a.approve ? 'Approved in the assistant' : 'Rejected in the assistant');
        return orderReply(gateway.getOrder(a.orderId), a.approve ? 'Approved.' : 'Rejected.');
      }
      case 'send-follow-up': {
        fulfilment.markFollowUpSent(a.orderId);
        return { text: `Sent the follow-up for ${a.orderId} to Valio Aimo customer service (demo).`, cards: [] };
      }
    }
  } catch (err) {
    if (err instanceof gateway.GatewayError) return { text: err.message, cards: [] };
    throw err;
  }
}

// --- attention feed ---------------------------------------------------------------------------

export function attention(): AttentionItem[] {
  if (supplierEnabled()) return [];
  const items: AttentionItem[] = [];
  const orders = gateway.listOrders();

  for (const o of orders.filter((x) => x.status === 'pending_approval')) {
    const why = o.checks.filter((c) => !c.passed).map((c) => c.rule.toLowerCase());
    items.push({
      id: `a-${o.orderId}`,
      kind: 'approval',
      tone: 'warning',
      title: `Approve ${qty(o.lines[0].quantity, o.lines[0].baseUnit)} ${o.lines[0].productName}${o.lines.length > 1 ? ` + ${o.lines.length - 1} more` : ''}?`,
      detail: `${gateway.money(o.total)}, outside your limits: ${why.join(', ')}`,
      action: { label: `Approve ${gateway.money(o.total)}`, action: { type: 'decide', orderId: o.orderId, approve: true } },
      ask: 'Show my orders',
    });
  }

  for (const o of orders.filter((x) => x.disruption?.status === 'open')) {
    const d = o.disruption!;
    const best = d.options[0];
    items.push({
      id: `d-${o.orderId}`,
      kind: 'disruption',
      tone: 'urgent',
      title: `Supplier can't deliver ${qty(d.shortQuantity, d.baseUnit)} ${d.productName.replace(/ \(.*\)$/, '')}`,
      detail: best ? `Replacement: ${best.note.replace(/; needs approval$/, '')}` : 'No replacement in stock',
      date: d.originalDate,
      action: best ? { label: 'Use replacement', action: { type: 'resolve-disruption', orderId: o.orderId, optionId: best.optionId } } : undefined,
      ask: 'Any supplier problems?',
    });
  }

  for (const o of orders.filter((x) => x.status === 'confirmed' && !x.delivery && x.neededBy)) {
    const last = gateway.lastDelivery(o.lines);
    if (last > o.neededBy!) {
      items.push({
        id: `l-${o.orderId}`,
        kind: 'late',
        tone: 'warning',
        title: `Part of an order arrives late`,
        detail: `${o.lines[0].productName}: last delivery ${formatDate(last)}, needed by ${formatDate(o.neededBy!)}`,
        date: o.neededBy,
      });
    }
  }

  for (const o of orders.filter((x) => x.delivery?.followUp && !x.delivery.followUp.sentAt)) {
    items.push({
      id: `r-${o.orderId}`,
      kind: 'delivery',
      tone: 'warning',
      title: `Delivery short by ${gateway.money(o.delivery!.shortValue)}`,
      detail: o.delivery!.lines.filter((l) => l.issue).map((l) => `${l.productName}: ${l.issue}`).join('; '),
      action: { label: 'Send follow-up', action: { type: 'send-follow-up', orderId: o.orderId } },
      ask: `Check the delivery of ${o.orderId}`,
    });
  }

  const autopilot = automations.autopilotActive();
  for (const i of automations.dueStock()) {
    const s = i.suggestion!;
    items.push({
      id: `s-${i.key}`,
      kind: 'stock',
      tone: i.status === 'urgent' ? 'urgent' : 'warning',
      title: i.message,
      detail: `${qty(i.onHand, i.baseUnit)} left, about ${qty(i.usagePerDay, i.baseUnit)} a day. ${autopilot && automations.settings.stock.items[i.key] ? 'The autopilot will reorder it.' : `Suggested: ${s.line.packs} × ${s.line.packLabel}.`}`,
      date: i.runOutDate,
      action: { label: `Reorder · ${gateway.money(s.line.lineTotal)}`, action: { type: 'order-stock', keys: [i.key] } },
      ask: 'What is running low?',
    });
  }

  if (automations.settings.events.enabled) {
    const horizon = addDays(today(), Math.max(14, automations.settings.events.remindDaysBefore));
    for (const e of events.listEvents().filter((x) => x.status === 'planned' && x.date <= horizon)) {
      const soon = e.date <= addDays(today(), automations.settings.events.remindDaysBefore);
      items.push({
        id: `e-${e.id}`,
        kind: 'event',
        tone: soon ? (e.daysUntil <= 3 ? 'urgent' : 'warning') : 'info',
        title: `${e.name}: ${e.guests} guests ${e.daysUntil === 0 ? 'today' : e.daysUntil === 1 ? 'tomorrow' : `in ${e.daysUntil} days`}`,
        detail: `${e.estimate.items} items, about ${gateway.money(e.estimate.total)}${e.budget ? ` (budget ${gateway.money(e.budget)})` : ''}. ${e.orderBy === today() ? "Order today." : `Order by ${formatDate(e.orderBy)}.`}${e.estimate.needsApproval ? ' Needs your approval.' : ''}`,
        date: e.date,
        action: { label: `Order all · ${gateway.money(e.estimate.total)}`, action: { type: 'order-event', eventId: e.id } },
        ask: `Plan ${e.meal.replace('-', ' ')} for ${e.guests} guests, ${e.vegan} vegan${e.budget ? `, budget €${e.budget}` : ''}`,
      });
    }
  }

  const rank = { urgent: 0, warning: 1, info: 2 };
  return items.sort((a, b) => rank[a.tone] - rank[b.tone] || (a.date ?? '9').localeCompare(b.date ?? '9'));
}

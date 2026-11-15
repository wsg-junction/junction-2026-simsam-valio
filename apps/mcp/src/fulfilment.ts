import { record } from './audit';
import { catalog, getProduct } from './catalog';
import * as gateway from './gateway';
import { ACTORS, GATEWAY, GatewayError, firstName, list, money } from './gateway';
import { averageUsage, kitchenItems, receive, usageOn, type KitchenItem } from './kitchen';
import { mandate } from './mandate';
import { promiseGaps } from './sourcing';
import type {
  DeliveryLine,
  DeliveryRecord,
  Disruption,
  DisruptionsResult,
  OfferLine,
  Order,
  OrderResult,
  Product,
  ReconciliationResult,
  ReplacementOption,
  ReplenishmentResult,
  StockItem,
  StockSuggestion,
} from './types';
import { addDays, eur, formatDate, qty, round2, today } from './util';

// After checkout: supplier disruptions and replacements, delivery reconciliation, and proactive replenishment
// from the kitchen's stock and usage.

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weekday = (date: string) => DAY_NAMES[new Date(`${date}T00:00:00Z`).getUTCDay()];
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** "today", "tomorrow", "Thursday" (within a week) or "Thu 26 Nov" */
function when(date: string): string {
  const d = daysBetween(today(), date);
  if (d <= 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d < 7) return weekday(date);
  return formatDate(date);
}

const isOpen = (o: Order) => o.status === 'confirmed' && !o.delivery;

// --- disruption recovery ------------------------------------------------------------

function replacementOptions(order: Order, line: OfferLine, shortQuantity: number, originalDate: string): ReplacementOption[] {
  const original = getProduct(line.productId)!;
  const quote = gateway.getQuote(order.quoteId);
  const requirements = quote?.requirements ?? {};
  const subCategory = original.category;

  const candidates = catalog.filter(
    (p) =>
      p.id !== original.id &&
      (p.equivalenceGroup === original.equivalenceGroup ||
        (p.category === subCategory && original.dietary.every((d) => p.dietary.includes(d)))) &&
      promiseGaps(p).length === 0,
  );

  const creditPerUnit = line.unitPrice;
  const options = candidates.flatMap((p): ReplacementOption[] => {
    const { packs, deliveries } = gateway.allocate(p, Math.ceil(round2(shortQuantity / p.packSize)));
    if (packs * p.packSize < shortQuantity) return [];
    const repl = gateway.toLine(p, packs, deliveries);
    const sameProduct = p.equivalenceGroup === original.equivalenceGroup;
    const meetsRequirements = gateway.requirementGaps(p, requirements).length === 0;
    const priceDiff = round2(repl.lineTotal - shortQuantity * creditPerUnit);
    const date = gateway.lastDelivery([repl]);
    const daysLater = daysBetween(originalDate, date);
    const needsApproval =
      (!sameProduct && mandate.requireSubstituteApproval) ||
      repl.lineTotal > mandate.autoApproveLimit ||
      mandate.spentThisWeek + repl.lineTotal > mandate.weeklyBudget ||
      (!meetsRequirements && mandate.requireRequirementsMatch) ||
      (!!order.neededBy && date > order.neededBy && mandate.requireOnTimeDelivery);
    const diffText = Math.abs(priceDiff) < 0.01 ? 'same price' : priceDiff > 0 ? `${money(priceDiff)} more` : `${money(-priceDiff)} less`;
    const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
    const dateText = daysLater === 0 ? 'arrives the same day' : daysLater > 0 ? `arrives ${days(daysLater)} later (${formatDate(date)})` : `arrives ${days(-daysLater)} earlier`;
    return [
      {
        optionId: '',
        kind: sameProduct ? 'same-product' : 'substitute',
        line: repl,
        priceDiff,
        daysLater,
        meetsRequirements,
        needsApproval,
        note: `${sameProduct ? 'Same product in another pack' : `Substitute: ${p.brand} ${p.name}`}; ${diffText}; ${dateText}${needsApproval ? '; needs approval' : ''}`,
      },
    ];
  });

  return options
    .sort(
      (a, b) =>
        Number(b.kind === 'same-product') - Number(a.kind === 'same-product') ||
        Number(a.daysLater > 0) - Number(b.daysLater > 0) ||
        a.priceDiff - b.priceDiff,
    )
    .slice(0, 3)
    .map((o, i) => ({ ...o, optionId: `R${i + 1}` }));
}

/** Demo: the supplier can't deliver part of a confirmed order. */
export function simulateDisruption(orderId: string, productId?: string): Order {
  const order = gateway.findOrder(orderId);
  if (!isOpen(order)) throw new GatewayError('Only confirmed orders that are not yet delivered can be disrupted');
  if (order.disruption?.status === 'open') throw new GatewayError('This order already has an open supplier problem');
  const line = order.lines.find((l) => l.productId === productId) ?? [...order.lines].sort((a, b) => b.lineTotal - a.lineTotal)[0];
  const product = getProduct(line.productId)!;
  const shortPacks = Math.max(1, Math.ceil(line.packs / 2));
  const shortQuantity = round2(shortPacks * product.packSize);
  const originalDate = gateway.lastDelivery([line]);

  const disruption: Disruption = {
    productId: line.productId,
    productName: `${line.brand} ${line.productName} (${line.packLabel})`,
    supplier: product.supplier,
    baseUnit: line.baseUnit,
    shortQuantity,
    creditValue: round2(shortPacks * line.packPrice),
    originalDate,
    reason: `${product.supplier} reported a production stoppage and can't deliver ${qty(shortQuantity, line.baseUnit)} (synthetic)`,
    at: new Date().toISOString(),
    status: 'open',
    options: replacementOptions(order, line, shortQuantity, originalDate),
  };
  order.disruption = disruption;
  gateway.addSpend(-disruption.creditValue);

  const refs = gateway.refsFor(order);
  record(
    `supplier: ${product.supplier}`,
    'supplier_disruption',
    `Can't deliver ${qty(shortQuantity, line.baseUnit)} of ${line.productName} for order ${order.orderId}`,
    refs,
    disruption.reason,
  );
  record(
    GATEWAY,
    'replacements_found',
    disruption.options.length
      ? `Found ${disruption.options.length} replacement(s); ${eur(disruption.creditValue)} credited for the missing part`
      : `No replacement in stock; ${eur(disruption.creditValue)} credited`,
    refs,
    disruption.options.map((o) => `${o.optionId}: ${o.note}`).join(' | ') || undefined,
  );
  return order;
}

export function openDisruptions(): DisruptionsResult {
  return {
    kind: 'disruptions',
    orders: gateway
      .listOrders()
      .filter((o) => o.disruption?.status === 'open')
      .map((o) => ({
        orderId: o.orderId,
        summary: `${qty(o.disruption!.shortQuantity, o.disruption!.baseUnit)} ${o.disruption!.productName} missing from order ${o.orderId}`,
        disruption: o.disruption!,
      })),
  };
}

/**
 * Orders a replacement. Through the mandate as usual (a different product needs approval when the rules say
 * so). When the approver picks it in the console, it is approved by them.
 */
export function resolveDisruption(
  input: { orderId: string; optionId: string; rationale?: string },
  actor: string = ACTORS.agent,
  byApprover = false,
): OrderResult {
  const order = gateway.findOrder(input.orderId);
  const d = order.disruption;
  if (!d) throw new GatewayError(`Order ${order.orderId} has no supplier problem`);
  if (d.status !== 'open') {
    if (d.replacementOrderId) return gateway.getOrder(d.replacementOrderId);
    throw new GatewayError(`The supplier problem on ${order.orderId} is already ${d.status}`);
  }
  const option = d.options.find((o) => o.optionId === input.optionId);
  if (!option) throw new GatewayError(`No option ${input.optionId}. Options: ${d.options.map((o) => o.optionId).join(', ') || 'none'}`);

  const explanation = `Replaces ${qty(d.shortQuantity, d.baseUnit)} of ${d.productName} that ${d.supplier} couldn't deliver: ${option.note.replace(/; needs approval$/, '')}.`;
  const quote = gateway.requestQuote(
    {
      lines: [{ productId: option.line.productId, quantity: option.line.quantity }],
      neededBy: order.neededBy,
      requirements: gateway.getQuote(order.quoteId)?.requirements,
      rationale: input.rationale,
      explanation,
      replacementFor: { orderId: order.orderId, productId: d.productId },
    },
    actor,
  ).quote;
  const replacement = gateway.placeWithChecks(
    quote.quoteId,
    actor,
    input.rationale,
    (checks) =>
      byApprover
        ? checks.map((c) => (c.passed ? c : { ...c, passed: true, detail: `${c.detail} (chosen by ${firstName(mandate.approver)})` }))
        : checks,
    byApprover ? { approvedBy: mandate.approver, approvalNote: 'Chose this replacement in the console' } : {},
  );
  d.status = 'resolved';
  d.resolvedWith = option.optionId;
  d.replacementOrderId = replacement.orderId;
  record(
    GATEWAY,
    'disruption_resolved',
    `Supplier problem on ${order.orderId} resolved with replacement order ${replacement.orderId}`,
    { orderId: order.orderId },
    option.note,
  );
  return gateway.getOrder(replacement.orderId);
}

export function dismissDisruption(orderId: string): Order {
  const order = gateway.findOrder(orderId);
  if (order.disruption?.status !== 'open') throw new GatewayError('No open supplier problem on this order');
  order.disruption.status = 'dismissed';
  record(ACTORS.approver(), 'disruption_dismissed', `Accepted the shortage on ${orderId} without a replacement`, { orderId }, `${eur(order.disruption.creditValue)} credited`);
  return order;
}

// --- delivery reconciliation ---------------------------------------------------------

/** What the warehouse should send: ordered minus anything the supplier cancelled. */
const expected = (order: Order, l: OfferLine) =>
  round2(l.quantity - (order.disruption && order.disruption.productId === l.productId ? order.disruption.shortQuantity : 0));

function followUp(order: Order, lines: DeliveryLine[], shortValue: number) {
  const issues = lines.filter((l) => l.issue);
  const missing = issues.reduce((s, l) => s + Math.max(0, l.ordered - l.received), 0);
  const unit = issues[0]?.baseUnit ?? '';
  const subject = `Order ${order.orderId}: delivery short${issues.length === 1 ? ` by ${qty(missing, unit)}` : ` on ${issues.length} items`}`;
  const body = [
    'Hello Valio Aimo customer service,',
    '',
    `Order ${order.orderId} for ${mandate.buyer} was delivered today (${formatDate(today())}). Compared with the order, we are missing:`,
    ...issues.map(
      (l) =>
        `- ${l.productName} (${l.packLabel}): ordered ${qty(l.ordered, l.baseUnit)}, picked ${qty(l.picked, l.baseUnit)}, received ${qty(l.received, l.baseUnit)}. ${l.issue}.`,
    ),
    '',
    `Please credit ${eur(shortValue)} or redeliver the missing items by ${formatDate(addDays(today(), 1))}, and let us know which.`,
    '',
    'Kind regards,',
    mandate.approver,
    mandate.buyer,
  ].join('\n');
  return { subject, body };
}

/**
 * Compares ordered, picked and received quantities. `received` comes from the kitchen's goods receipt;
 * `sample` simulates a short pick and a damaged pack for the demo.
 */
export function recordDelivery(
  orderId: string,
  input: { received?: { productId: string; quantity: number }[]; sample?: boolean },
  actor: string,
): ReconciliationResult {
  const order = gateway.findOrder(orderId);
  if (order.delivery) return { kind: 'reconciliation', orderId, delivery: order.delivery };
  if (order.status !== 'confirmed') throw new GatewayError(`Order ${orderId} is ${order.status}; only confirmed orders are delivered`);
  if (!input.received?.length && !input.sample) {
    throw new GatewayError('No delivery recorded yet. Pass the received quantities from the goods receipt (productId + quantity).');
  }

  const biggest = [...order.lines].sort((a, b) => b.packs - a.packs)[0];
  const lines: DeliveryLine[] = order.lines.map((l, i) => {
    const product = getProduct(l.productId)!;
    const ordered = expected(order, l);
    let picked = ordered;
    if (input.sample && l === biggest && l.packs > 1) picked = round2(ordered - product.packSize); // one pack short-picked
    let received = input.received?.find((r) => r.productId === l.productId)?.quantity ?? picked;
    if (input.sample && !input.received && (order.lines.length === 1 || i === order.lines.length - 1) && received >= product.packSize * 2) {
      received = round2(received - product.packSize); // one pack damaged in transit
    }
    received = Math.max(0, round2(received));
    const issues: string[] = [];
    if (picked < ordered) issues.push(`${qty(ordered - picked, l.baseUnit)} short-picked at the warehouse`);
    if (received < picked) issues.push(`${qty(picked - received, l.baseUnit)} missing or damaged on arrival`);
    if (received > picked) issues.push(`${qty(received - picked, l.baseUnit)} more than picked`);
    return {
      productId: l.productId,
      productName: l.productName,
      packLabel: l.packLabel,
      baseUnit: l.baseUnit,
      unitPrice: l.unitPrice,
      ordered,
      picked,
      received,
      issue: issues.length ? issues.join('; ').replace(/^\w/, (c) => c.toUpperCase()) : undefined,
    };
  });

  const shortValue = round2(lines.reduce((s, l) => s + Math.max(0, l.ordered - l.received) * l.unitPrice, 0));
  const delivery: DeliveryRecord = {
    recordedAt: new Date().toISOString(),
    recordedBy: actor,
    lines,
    shortValue,
    followUp: lines.some((l) => l.received < l.ordered) ? followUp(order, lines, shortValue) : undefined,
  };
  order.delivery = delivery;
  for (const l of lines) receive(getProduct(l.productId)!.equivalenceGroup, l.received);

  const refs = gateway.refsFor(order);
  const short = lines.filter((l) => l.received < l.ordered);
  record(actor, 'delivery_received', `Recorded the delivery of order ${order.orderId}`, refs);
  record(
    GATEWAY,
    'delivery_reconciled',
    short.length
      ? `Delivery of ${order.orderId} is short on ${short.length} item(s), ${eur(shortValue)} to credit`
      : `Delivery of ${order.orderId} matches the order`,
    refs,
    short.map((l) => `${l.productName}: ${l.issue}`).join('; ') || undefined,
  );
  return { kind: 'reconciliation', orderId, delivery };
}

export function getReconciliation(orderId: string): ReconciliationResult {
  const order = gateway.findOrder(orderId);
  if (!order.delivery) {
    throw new GatewayError(
      `Order ${orderId} has no recorded delivery yet. Ask the user what was received and pass it as "received", or record it in the console.`,
    );
  }
  return { kind: 'reconciliation', orderId, delivery: order.delivery };
}

export function markFollowUpSent(orderId: string): Order {
  const order = gateway.findOrder(orderId);
  if (!order.delivery?.followUp) throw new GatewayError('Nothing to follow up on this order');
  order.delivery.followUp.sentAt ??= new Date().toISOString();
  record(ACTORS.approver(), 'follow_up_sent', `Sent the delivery follow-up for ${orderId} to Valio Aimo`, { orderId }, order.delivery.followUp.subject);
  return order;
}

// --- replenishment ------------------------------------------------------------------

function incomingFor(item: KitchenItem) {
  return gateway.listOrders().flatMap((o) =>
    isOpen(o)
      ? o.lines.flatMap((l) => {
          const p = getProduct(l.productId)!;
          if (!item.groups.includes(p.equivalenceGroup)) return [];
          const cancelled = o.disruption?.productId === l.productId ? o.disruption.shortQuantity : 0;
          let left = l.quantity - cancelled;
          return l.deliveries.flatMap((d) => {
            const quantity = Math.min(d.quantity, left);
            left -= quantity;
            return quantity > 0 ? [{ date: d.date, quantity: round2(quantity), orderId: o.orderId }] : [];
          });
        })
      : [],
  );
}

/** Cheapest effective option (price + likely waste) for an amount by a date, keeping the promise. */
function bestLine(item: KitchenItem, need: number, neededBy: string): { line: OfferLine; product: Product } | undefined {
  const options = catalog
    .filter((p) => item.groups.includes(p.equivalenceGroup) && promiseGaps(p).length === 0)
    .flatMap((p) => {
      const { packs, deliveries } = gateway.allocate(p, Math.ceil(round2(need / p.packSize)));
      if (packs === 0) return [];
      const line = gateway.toLine(p, packs, deliveries);
      const late = gateway.lastDelivery([line]) > neededBy;
      const waste = gateway.wasteFor(p, line.quantity, need);
      return [{ line, product: p, late, cost: line.lineTotal + waste.wasteValue }];
    })
    .sort((a, b) => Number(a.late) - Number(b.late) || a.cost - b.cost);
  return options[0];
}

export function replenishment(): ReplenishmentResult {
  const start = today();
  const items: StockItem[] = kitchenItems().map((item) => {
    const usage = averageUsage(item);
    const incoming = incomingFor(item);
    const u = item.baseUnit;

    // Day-by-day projection: deliveries arrive in the morning, then the day's use.
    let stock = item.onHand;
    let runOutDate: string | undefined;
    for (let d = 0; d < 21 && !runOutDate; d++) {
      const date = addDays(start, d);
      stock += incoming.filter((i) => i.date === date).reduce((s, i) => s + i.quantity, 0);
      stock -= usageOn(item, date);
      if (stock < 0) runOutDate = date;
    }
    const daysLeft = runOutDate ? daysBetween(start, runOutDate) : 21;
    const status: StockItem['status'] = runOutDate && daysLeft <= 2 ? 'urgent' : runOutDate && daysLeft <= 6 ? 'reorder' : 'ok';
    const name = item.name.replace(/ \d.*$/, '');

    let suggestion: StockSuggestion | undefined;
    if (status !== 'ok' && runOutDate) {
      const product = catalog.find((p) => item.groups.includes(p.equivalenceGroup));
      const earliest = addDays(start, product?.leadTimeDays ?? 1);
      const neededBy = runOutDate < earliest ? earliest : runOutDate;
      // Waste-aware: cover a week, but never more than the product keeps.
      const keeps = Math.min(...catalog.filter((p) => item.groups.includes(p.equivalenceGroup)).map((p) => p.shelfLifeDays));
      const coversDays = Math.max(2, Math.min(7, keeps - 2));
      let projected = item.onHand;
      for (let d = 0; addDays(start, d) < neededBy; d++) {
        const date = addDays(start, d);
        projected += incoming.filter((i) => i.date === date).reduce((s, i) => s + i.quantity, 0) - usageOn(item, date);
      }
      const later = incoming.filter((i) => i.date >= neededBy && i.date < addDays(neededBy, coversDays)).reduce((s, i) => s + i.quantity, 0);
      // A shortfall before the delivery can't be recovered, so only the days after it count.
      let need = 0;
      for (let d = 0; d < coversDays; d++) need += usageOn(item, addDays(neededBy, d));
      need = Math.max(0, need - Math.max(0, projected) - later);
      need = u === 'pcs' ? Math.ceil(need) : Math.ceil(need * 10) / 10;
      const best = need > 0 ? bestLine(item, need, neededBy) : undefined;
      if (best) {
        const waste = gateway.wasteFor(best.product, best.line.quantity, need);
        suggestion = {
          line: best.line,
          neededBy,
          coversDays,
          why: `Covers ${coversDays} days from ${formatDate(neededBy)} at about ${qty(usage, u)}/day${coversDays < 7 ? ` (it keeps ${keeps} days, so not a full week)` : ''}; ${best.line.packs} × ${best.line.packLabel} is the cheapest option arriving in time${waste.surplus ? `, ${waste.note.charAt(0).toLowerCase()}${waste.note.slice(1)}` : ''}.`,
        };
      }
    }

    const message = !runOutDate
      ? `${name}: enough for 3 weeks`
      : status === 'ok'
        ? `${name} lasts until ${when(runOutDate)}`
        : `${name} will run out ${when(runOutDate)}`;

    return {
      key: item.key,
      name: item.name,
      baseUnit: u,
      onHand: item.onHand,
      usagePerDay: usage,
      history: item.history,
      incoming,
      runOutDate,
      daysLeft,
      status,
      message,
      suggestion,
    };
  });

  items.sort((a, b) => a.daysLeft - b.daysLeft);
  return {
    kind: 'replenishment',
    asOf: new Date().toISOString(),
    items,
    suggestedTotal: round2(items.reduce((s, i) => s + (i.suggestion?.line.lineTotal ?? 0), 0)),
    buyer: mandate.buyer,
  };
}

/** One-line summary for agents: "Milk will run out Thursday; eggs tomorrow." */
export function replenishmentText(r: ReplenishmentResult): string {
  const due = r.items.filter((i) => i.suggestion);
  return [
    `Kitchen stock for ${r.buyer} as of ${formatDate(today())}:`,
    ...r.items.map(
      (i) =>
        `- ${i.message} (${qty(i.onHand, i.baseUnit)} on hand, ~${qty(i.usagePerDay, i.baseUnit)}/day${i.incoming.length ? `, incoming ${list(i.incoming.map((x) => `${qty(x.quantity, i.baseUnit)} ${formatDate(x.date)}`))}` : ''})${
          i.suggestion
            ? `\n    Suggest: productId ${i.suggestion.line.productId}, quantity ${i.suggestion.line.quantity} (${i.suggestion.line.packs} × ${i.suggestion.line.packLabel}, ${eur(i.suggestion.line.lineTotal)}), needed by ${i.suggestion.neededBy}. ${i.suggestion.why}`
            : ''
        }`,
    ),
    due.length
      ? `Suggested reorder total ${eur(r.suggestedTotal)}. To order, call request_quote with these lines and neededBy ${due.map((i) => i.suggestion!.neededBy).sort()[0]}.`
      : 'Nothing needs reordering this week.',
  ].join('\n');
}


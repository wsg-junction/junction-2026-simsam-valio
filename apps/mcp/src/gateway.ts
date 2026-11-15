import { allEvents, eventsFor, record, resetAudit, verifyChain } from './audit';
import { allTopCategories, catalog, getProduct, topCategory } from './catalog';
import { normalizeProductQuery } from './product-search';
import { APP_BASE, PUBLIC_URL } from './config';
import { resetKitchen, usageFor } from './kitchen';
import { mandate, resetMandate, type Mandate } from './mandate';
import { signQuote, verifyQuote } from './signing';
import { attestation, promiseGaps, promiseLabels, sourcing } from './sourcing';
import type {
  AssortmentResult,
  AuditEvent,
  AuditResult,
  Delivery,
  Offer,
  OfferLine,
  OffersResult,
  Order,
  OrderResult,
  Product,
  Quote,
  QuoteResult,
  RequestedChanges,
  Requirements,
  RuleCheck,
  WasteEstimate,
} from './types';
import { addDays, eur, formatDate, qty, round2, shortId, today } from './util';

/** Who performed an action, as recorded in the audit trail. */
export const ACTORS = {
  agent: `agent: ${mandate.agent}`,
  /** The buyer clicking in the widget inside their AI assistant (not the model). */
  buyerViaWidget: `buyer: ${mandate.buyer} user (via widget)`,
  approver: () => `human: ${mandate.approver}`,
};
export const GATEWAY = 'gateway: Valio Aimo';
const QUOTE_TTL_MS = 30 * 60 * 1000;

const searches = new Map<string, OffersResult>();
const quotes = new Map<string, Quote>();
const orders = new Map<string, Order>();
const resetHooks: (() => void)[] = [];

export class GatewayError extends Error {}

/** Other modules (baskets, fulfilment) register their own demo state here. */
export const onReset = (fn: () => void) => resetHooks.push(fn);

/** Demo only: clear searches, quotes, orders, the audit log and kitchen stock, and restore the default mandate. */
export function resetDemo() {
  searches.clear();
  quotes.clear();
  orders.clear();
  resetAudit();
  resetMandate();
  resetKitchen();
  resetHooks.forEach((fn) => fn());
}

export const categoryAllowed = (category: string) => mandate.allowedCategories.includes(topCategory(category));
export const firstName = (person: string) => person.split(/[ ,]/)[0];

/** Readable list: "a, b and c". */
export const list = (parts: string[]) =>
  parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;

// --- availability -------------------------------------------------------------

/** Allocates packs from stock first, then inbound deliveries, optionally only those arriving by `cutoff`. */
export function allocate(p: Product, packsWanted: number, cutoff?: string): { packs: number; deliveries: Delivery[] } {
  const sources = [
    { date: addDays(today(), p.leadTimeDays), packs: p.stockPacks },
    ...p.inbound.map((i) => ({ date: addDays(today(), i.inDays + p.leadTimeDays), packs: i.packs })),
  ]
    .filter((s) => !cutoff || s.date <= cutoff)
    .sort((a, b) => a.date.localeCompare(b.date));

  let remaining = packsWanted;
  const deliveries: Delivery[] = [];
  for (const s of sources) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, s.packs);
    if (take > 0) {
      deliveries.push({ date: s.date, quantity: round2(take * p.packSize) });
      remaining -= take;
    }
  }
  return { packs: packsWanted - remaining, deliveries };
}

export function toLine(p: Product, packs: number, deliveries: Delivery[]): OfferLine {
  return {
    productId: p.id,
    productName: p.name,
    image: p.image,
    brand: p.brand,
    packLabel: p.packLabel,
    packs,
    quantity: round2(packs * p.packSize),
    baseUnit: p.baseUnit,
    packPrice: p.packPrice,
    unitPrice: round2(p.packPrice / p.packSize),
    lineTotal: round2(packs * p.packPrice),
    deliveries,
    certificates: p.certificates,
    onTimeRate: p.onTimeRate,
    co2eRange: p.co2eRange,
    origin: p.origin,
    shelfLifeDays: p.shelfLifeDays,
  };
}

export const lastDelivery = (lines: OfferLine[]) =>
  lines
    .flatMap((l) => l.deliveries.map((d) => d.date))
    .sort()
    .at(-1) ?? today();

// --- waste ----------------------------------------------------------------------

/**
 * Pack-size surplus versus expected usage and shelf life. The surplus counts as likely waste when the kitchen
 * can't use it (on top of what is already on the shelf) before it expires.
 */
export function wasteFor(p: Product, delivered: number, requested: number, usagePerDay?: number): WasteEstimate {
  const surplus = round2(Math.max(0, delivered - requested));
  const tracked = usageFor(p.equivalenceGroup);
  const usage = usagePerDay ?? tracked?.usagePerDay;
  const onHand = usagePerDay !== undefined ? 0 : (tracked?.onHand ?? 0);
  const unitPrice = p.packPrice / p.packSize;
  const u = p.baseUnit;
  if (surplus === 0) return { surplus, likelyWaste: 0, wasteValue: 0, usagePerDay: usage, note: 'Packs match the quantity, no surplus' };
  if (!usage) {
    const likelyWaste = p.shelfLifeDays < 30 ? surplus : 0;
    return {
      surplus,
      likelyWaste,
      wasteValue: round2(likelyWaste * unitPrice),
      note: likelyWaste
        ? `${qty(surplus, u)} more than needed; no usage data and it keeps only ${p.shelfLifeDays} days, so it may go to waste`
        : `${qty(surplus, u)} more than needed; keeps ${p.shelfLifeDays} days`,
    };
  }
  const usable = Math.max(0, usage * p.shelfLifeDays - onHand);
  const likelyWaste = round2(Math.min(surplus, Math.max(0, surplus - usable)));
  return {
    surplus,
    likelyWaste,
    wasteValue: round2(likelyWaste * unitPrice),
    usagePerDay: usage,
    note: likelyWaste
      ? `${qty(surplus, u)} more than needed; at ${qty(usage, u)}/day and ${p.shelfLifeDays} days shelf life, about ${qty(likelyWaste, u)} would expire (${eur(likelyWaste * unitPrice)})`
      : `${qty(surplus, u)} more than needed, used in normal service before it expires (${qty(usage, u)}/day, keeps ${p.shelfLifeDays} days)`,
  };
}

/** Waste for a whole offer: the surplus sits in the pack with the shortest shelf life. */
function offerWaste(lines: OfferLine[], requested: number, usagePerDay?: number): WasteEstimate {
  const delivered = lines.reduce((s, l) => s + l.quantity, 0);
  const product = lines.map((l) => getProduct(l.productId)!).sort((a, b) => a.shelfLifeDays - b.shelfLifeDays)[0];
  return wasteFor(product, delivered, requested, usagePerDay);
}

// --- requirements & promise -----------------------------------------------------

export function requirementGaps(p: Product, req: Requirements): string[] {
  const gaps: string[] = [];
  for (const d of req.dietary ?? []) if (!p.dietary.includes(d)) gaps.push(`not ${d}`);
  for (const c of req.certificates ?? [])
    if (!p.certificates.some((pc) => pc.toLowerCase() === c.toLowerCase())) gaps.push(`no ${c} certificate`);
  for (const a of req.excludeAllergens ?? [])
    if (p.allergens.includes(a.toLowerCase())) gaps.push(`contains ${a}`);
  return gaps;
}

/** Throws if any product breaks the buyer's sourcing promise. Nobody can approve past this. */
export function assertPromise(productIds: string[]) {
  for (const id of productIds) {
    const p = getProduct(id);
    const gaps = p ? promiseGaps(p) : [];
    if (p && gaps.length) {
      throw new GatewayError(
        `${p.brand} ${p.name} (${p.id}) breaks the buyer's sourcing promise: ${gaps.join('; ')}. The gateway will not quote or order it, and no approver can override that; only a person can change the promise in the Valio Aimo console. Choose a product that keeps the promise.`,
      );
    }
  }
}

// --- search -------------------------------------------------------------------

const STOPWORDS = new Set(
  'a an and the of for by to in on at we i need want buy order some about around litre litres liter liters kg kilo kilos pcs pieces piece units unit l x'.split(
    ' ',
  ),
);

function matchProducts(query: string): Product[] {
  const tokens = normalizeProductQuery(query)
    .replace(/\bvegetable oil\b/g, 'oil')
    .split(/[^a-z0-9%.-]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t) && !/^[\d.,]+$/.test(t));
  if (tokens.length === 0) return catalog;

  const haystack = (p: Product) =>
    [p.name, ...(p.searchNames ?? []), p.brand, p.category, p.packLabel, p.origin, ...p.dietary, ...p.certificates].join(' ').toLowerCase();
  const matches = (p: Product, t: string) => haystack(p).includes(t) || haystack(p).includes(t.replace(/s$/, ''));

  const all = catalog.filter((p) => tokens.every((t) => matches(p, t)));
  if (all.length) return all;
  // A shared adjective (e.g. "gluten-free") is not a match for a different ingredient.
  return [];
}

function buildOffer(
  offerId: string,
  title: string,
  lines: OfferLine[],
  requested: number,
  baseUnit: string,
  neededBy?: string,
  usagePerDay?: number,
): Offer {
  const quantity = round2(lines.reduce((s, l) => s + l.quantity, 0));
  const lastDeliveryDate = lastDelivery(lines);
  return {
    offerId,
    rank: 0,
    badge: 'alternative',
    title,
    lines,
    total: round2(lines.reduce((s, l) => s + l.lineTotal, 0)),
    quantity,
    baseUnit,
    meetsQuantity: quantity >= requested,
    meetsDeadline: !neededBy || lastDeliveryDate <= neededBy,
    meetsRequirements: true,
    lastDeliveryDate,
    reasons: [],
    explanation: '',
    waste: offerWaste(lines, requested, usagePerDay),
  };
}

function describeDelivery(o: Offer, requested: number, neededBy?: string): string {
  const deliveries = o.lines.flatMap((l) => l.deliveries);
  if (!o.meetsQuantity) return `Only ${qty(o.quantity, o.baseUnit)} of ${qty(requested, o.baseUnit)} available`;
  if (!neededBy || o.meetsDeadline) {
    const n = new Set(deliveries.map((d) => d.date)).size;
    return `All ${qty(o.quantity, o.baseUnit)} delivered by ${formatDate(o.lastDeliveryDate)}${n > 1 ? ` (${n} deliveries)` : ''}`;
  }
  const onTime = deliveries.filter((d) => d.date <= neededBy).reduce((s, d) => s + d.quantity, 0);
  return `Only ${qty(onTime, o.baseUnit)} by ${formatDate(neededBy)}; the rest arrives ${formatDate(o.lastDeliveryDate)}`;
}

/** Effective cost: what you pay plus what is likely thrown away. "Best value" ranks on this. */
const effective = (o: Offer) => o.total + o.waste.wasteValue;

const packList = (lines: OfferLine[]) => list(lines.map((l) => `${l.packs} × ${l.packLabel}`));

/** "€174" for whole euros, "€1.65" otherwise. */
export const money = (n: number) => eur(n).replace(/\.00$/, '');

/**
 * "Chose these packs because they cover the 1,000 L, arrive by Mon 16 Nov and cost €174 less than …" for the
 * best value; "Covers the 1,000 L, arrives …" for the others.
 */
function explainOffer(o: Offer, all: Offer[], requested: number, neededBy?: string, quantityGiven = true): string {
  const u = o.baseUnit;
  const top = o.badge === 'best-value';
  const v = (plural: string, singular: string) => (top ? plural : singular);
  const parts: string[] = [];
  if (!quantityGiven) parts.push(`${v('are', 'is')} in stock`);
  else if (o.meetsQuantity) {
    parts.push(top && o.lines.length > 1 ? `${packList(o.lines)} together cover the ${qty(requested, u)}` : `${v('cover', 'covers')} the ${qty(requested, u)}`);
  } else parts.push(`only ${v('cover', 'covers')} ${qty(o.quantity, u)} of the ${qty(requested, u)}`);

  if (neededBy) {
    parts.push(o.meetsDeadline ? `${v('arrive', 'arrives')} by ${formatDate(neededBy)}` : `partly ${v('arrive', 'arrives')} late, on ${formatDate(o.lastDeliveryDate)}`);
  } else {
    parts.push(`${v('arrive', 'arrives')} ${formatDate(o.lastDeliveryDate)}`);
  }

  const valid = all.filter((x) => x !== o && x.meetsQuantity && x.meetsDeadline);
  const best = all.find((x) => x.badge === 'best-value');
  if (top) {
    const next = valid.sort((a, b) => effective(a) - effective(b))[0];
    if (next) {
      const pricier = next.total - o.total;
      parts.push(
        pricier > 0.005
          ? `cost ${money(pricier)} less than the next option that also meets the request`
          : `cost ${money(effective(next) - effective(o))} less once waste is counted (${money(next.waste.wasteValue)} would likely expire with the next option)`,
      );
    } else {
      parts.push('are the only option that fully meets the request');
    }
  } else if (best && o.badge === 'premium') {
    const extra = [...new Set(o.lines.flatMap((l) => l.certificates))].filter(
      (c) => !best.lines.some((l) => l.certificates.includes(c)),
    );
    parts.push(`costs ${money(o.total - best.total)} more than best value${extra.length ? ` for ${list(extra)}` : ''}`);
  } else if (best && o.total < best.total) {
    parts.push(`saves ${money(best.total - o.total)} against best value, but needs approval`);
  } else if (best) {
    parts.push(`costs ${money(o.total - best.total)} more than best value`);
  }

  const first = list(parts);
  const combo = top && o.lines.length > 1 && o.meetsQuantity && quantityGiven;
  const sentences = [
    top ? `Chose these packs because ${combo ? '' : 'they '}${first}.` : `${first.charAt(0).toUpperCase()}${first.slice(1)}.`,
  ];
  if (o.waste.likelyWaste > 0) sentences.push(`About ${qty(o.waste.likelyWaste, u)} may expire before it is used (${money(o.waste.wasteValue)}).`);
  else if (o.waste.surplus > 0) sentences.push(`The ${qty(o.waste.surplus, u)} extra gets used before it expires.`);
  return sentences.join(' ');
}

export function search(
  input: {
    query: string;
    quantity?: number;
    neededBy?: string;
    requirements?: Requirements;
    /** Expected use per day, base units; overrides the kitchen's stock data for the waste estimate */
    usagePerDay?: number;
  },
  actor: string = ACTORS.agent,
): OffersResult {
  const requirements = input.requirements ?? {};
  const searchId = shortId('S');
  const excluded: OffersResult['excluded'] = [];

  const candidates = matchProducts(input.query).filter((p) => {
    const promise = promiseGaps(p);
    if (promise.length) {
      excluded.push({ productName: `${p.brand} ${p.name} (${p.packLabel})`, reason: `breaks your promise: ${promise.join('; ')}`, promise: true });
      return false;
    }
    const gaps = requirementGaps(p, requirements);
    if (gaps.length) excluded.push({ productName: `${p.brand} ${p.name} (${p.packLabel})`, reason: gaps.join(', ') });
    return gaps.length === 0;
  });

  let offers: Offer[] = [];
  let n = 0;
  const nextId = () => `${searchId}-${++n}`;

  for (const p of candidates) {
    const requested = input.quantity ?? p.packSize;
    const packs = Math.ceil(round2(requested / p.packSize));
    const { packs: got, deliveries } = allocate(p, packs);
    if (got === 0) continue;
    offers.push(
      buildOffer(
        nextId(),
        `${p.brand} · ${p.name} (${p.packLabel})`,
        [toLine(p, got, deliveries)],
        requested,
        p.baseUnit,
        input.neededBy,
        input.usagePerDay,
      ),
    );
  }

  // Response logic: if no single pack size of a product can make the date, combine pack sizes of the same product.
  if (input.quantity) {
    const groups = Map.groupBy(candidates, (p) => p.equivalenceGroup);
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      let remaining = input.quantity;
      const lines: OfferLine[] = [];
      for (const p of [...group].sort((a, b) => a.packPrice / a.packSize - b.packPrice / b.packSize)) {
        if (remaining <= 0) break;
        const { packs, deliveries } = allocate(p, Math.ceil(round2(remaining / p.packSize)), input.neededBy);
        if (packs === 0) continue;
        lines.push(toLine(p, packs, deliveries));
        remaining -= packs * p.packSize;
      }
      if (remaining <= 0 && lines.length > 1) {
        const title = `${group[0].name}: ${lines.map((l) => `${l.brand} ${l.packLabel}`).join(' + ')}`;
        const offer = buildOffer(nextId(), title, lines, input.quantity, group[0].baseUnit, input.neededBy, input.usagePerDay);
        offer.reasons.push('Combines pack sizes of the same product to meet the requested date');
        offers.push(offer);
      }
    }
  }

  // Ranking: best value = lowest effective cost (price + likely waste) meeting quantity + date; premium = the
  // best-certified alternative that also meets them; partial = a cheaper offer that misses quantity or date.
  const valid = offers.filter((o) => o.meetsQuantity && o.meetsDeadline).sort((a, b) => effective(a) - effective(b));
  const invalid = offers.filter((o) => !(o.meetsQuantity && o.meetsDeadline)).sort((a, b) => a.total - b.total);
  const certCount = (o: Offer) => new Set(o.lines.flatMap((l) => l.certificates)).size;

  const best = valid[0];
  if (best) {
    best.badge = 'best-value';
    best.reasons.unshift(
      valid[1] && valid[1].total < best.total
        ? 'Lowest cost once likely waste is counted, and meets quantity, date and requirements'
        : 'Lowest total price that meets quantity, date and requirements',
    );
  }
  const premium = valid
    .slice(1)
    .sort((a, b) => certCount(b) - certCount(a) || a.total - b.total)
    .find((o) => !best || certCount(o) > certCount(best));
  if (premium) {
    premium.badge = 'premium';
    premium.reasons.unshift(
      best
        ? `More certifications than best value for ${eur(premium.total - best.total)} more`
        : 'Most certified option meeting the request',
    );
  }
  const partial = invalid.find((o) => !best || o.total < best.total);
  if (partial) {
    partial.badge = 'partial';
    partial.reasons.unshift('Cheaper, but does not fully meet the request; ordering it needs approval');
  }

  const badgeOrder = { 'best-value': 0, premium: 1, partial: 2, alternative: 3 } as const;
  offers = offers.sort((a, b) => badgeOrder[a.badge] - badgeOrder[b.badge] || effective(a) - effective(b)).slice(0, 50);

  for (const [i, o] of offers.entries()) {
    o.rank = i + 1;
    const requested = input.quantity ?? o.quantity;
    o.reasons.push(describeDelivery(o, requested, input.neededBy));
    o.reasons.push(`${eur(o.total / o.quantity)} per ${o.baseUnit} on average (fixed list price, excl. VAT)`);
    if (o.waste.surplus > 0) o.reasons.push(`Waste check: ${o.waste.note}`);
    const certs = [...new Set(o.lines.flatMap((l) => l.certificates))];
    if (certs.length) o.reasons.push(`Certificates: ${certs.join(', ')}`);
    o.reasons.push(`Origin: ${[...new Set(o.lines.map((l) => l.origin))].join(', ')}`);
    o.reasons.push(`On-time delivery ${Math.round(Math.min(...o.lines.map((l) => l.onTimeRate)) * 100)}% (last 90 days)`);
  }
  for (const o of offers) o.explanation = explainOffer(o, offers, input.quantity ?? o.quantity, input.neededBy, !!input.quantity);

  // Heads-up when the request itself is more than normal use can consume before it expires.
  let usageNote: string | undefined;
  const top = offers[0] && getProduct(offers[0].lines[0].productId);
  const usage = top && (input.usagePerDay ?? usageFor(top.equivalenceGroup)?.usagePerDay);
  if (top && usage && input.quantity) {
    const days = input.quantity / usage;
    const keeps = Math.max(...offers[0].lines.map((l) => l.shelfLifeDays));
    if (days > keeps) {
      usageNote = `${qty(input.quantity, top.baseUnit)} is about ${Math.round(days)} days of your usual use (${qty(usage, top.baseUnit)}/day), but it keeps ${keeps} days. Fine for an event; for everyday use, order less, more often.`;
    }
  }

  const result: OffersResult = {
    kind: 'offers',
    searchId,
    query: input.query,
    quantity: input.quantity,
    neededBy: input.neededBy,
    requirements,
    offers,
    excluded,
    buyer: mandate.buyer,
    promise: promiseLabels(),
    usageNote,
  };
  searches.set(searchId, result);

  const what = input.quantity ? `${qty(input.quantity, offers[0]?.baseUnit ?? 'units')} of ` : '';
  record(
    actor,
    'search',
    `Searched for ${what}"${input.query}"${input.neededBy ? ` by ${formatDate(input.neededBy)}` : ''}`,
    { searchId },
  );
  record(
    GATEWAY,
    'offers',
    offers.length
      ? `Returned ${offers.length} offer(s); best value: ${best ? `${best.title}, ${eur(best.total)}` : 'none fully meets the request'}`
      : 'No matching products',
    { searchId },
    excluded.length ? `Excluded: ${excluded.map((e) => `${e.productName} (${e.reason})`).join('; ')}` : undefined,
  );
  return result;
}

// --- quotes -------------------------------------------------------------------

export interface QuoteInput {
  lines: { productId: string; quantity: number }[];
  neededBy?: string;
  requirements?: Requirements;
  searchId?: string;
  offerId?: string;
  basketId?: string;
  rationale?: string;
  /** Used by baskets, revisions and replacements to carry their own explanation */
  explanation?: string;
  /** Prepended to the generated explanation */
  explanationPrefix?: string;
  revisionOf?: string;
  replacementFor?: { orderId: string; productId: string };
}

/** Plain explanation for a quote that didn't come from a ranked offer. */
function explainQuote(q: Quote): string {
  const what = list(q.lines.map((l) => `${qty(l.quantity, l.baseUnit)} ${l.productName} (${l.packs} × ${l.packLabel})`));
  const when = q.neededBy
    ? q.meetsDeadline
      ? `all arriving by ${formatDate(q.neededBy)}`
      : `part arriving after ${formatDate(q.neededBy)}`
    : `arriving by ${formatDate(lastDelivery(q.lines))}`;
  return `Quoted ${what}, ${when}, at the fixed list price of ${eur(q.total)}.`;
}

export function requestQuote(input: QuoteInput, actor: string = ACTORS.agent): QuoteResult {
  const requirements = input.requirements ?? {};
  if (!input.lines.length) throw new GatewayError('A quote needs at least one product');
  const quantities = new Map<string, number>();
  for (const l of input.lines) {
    if (!Number.isFinite(l.quantity) || l.quantity <= 0) throw new GatewayError('Quantities must be positive finite numbers');
    quantities.set(l.productId, (quantities.get(l.productId) ?? 0) + l.quantity);
  }
  input = { ...input, lines: [...quantities].map(([productId, quantity]) => ({ productId, quantity })) };
  assertPromise(input.lines.map((l) => l.productId));
  const lines = input.lines.map(({ productId, quantity }) => {
    const p = getProduct(productId);
    if (!p) throw new GatewayError(`Unknown product ${productId}`);
    const { packs, deliveries } = allocate(p, Math.ceil(round2(quantity / p.packSize)));
    if (packs < Math.ceil(round2(quantity / p.packSize))) throw new GatewayError(`${p.name} cannot supply the quoted quantity; search again for available stock`);
    return { line: toLine(p, packs, deliveries), gaps: requirementGaps(p, requirements) };
  });

  const issuedAt = new Date();
  const quote: Quote = {
    quoteId: shortId('Q'),
    searchId: input.searchId,
    offerId: input.offerId,
    basketId: input.basketId,
    buyer: mandate.buyer,
    lines: lines.map((l) => l.line),
    total: round2(lines.reduce((s, l) => s + l.line.lineTotal, 0)),
    currency: 'EUR',
    neededBy: input.neededBy,
    requirements,
    meetsDeadline:
      !input.neededBy || lines.every((l) => l.line.deliveries.every((d) => d.date <= input.neededBy!)),
    meetsRequirements: lines.every((l) => l.gaps.length === 0),
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + QUOTE_TTL_MS).toISOString(),
    promise: attestation(),
    revisionOf: input.revisionOf,
    replacementFor: input.replacementFor,
  };
  // The offer's explanation still holds if the quote matches it line for line.
  const offer = input.searchId && input.offerId ? searches.get(input.searchId)?.offers.find((o) => o.offerId === input.offerId) : undefined;
  const sameAsOffer =
    offer &&
    offer.lines.length === quote.lines.length &&
    offer.lines.every((l) => quote.lines.some((q) => q.productId === l.productId && q.quantity === l.quantity));
  quote.explanation = input.explanation ?? (sameAsOffer ? offer.explanation : explainQuote(quote));
  if (input.explanationPrefix) quote.explanation = `${input.explanationPrefix} ${quote.explanation}`;
  quote.signature = signQuote(quote);
  quotes.set(quote.quoteId, quote);

  const refs = { searchId: input.searchId, quoteId: quote.quoteId };
  record(
    actor,
    'quote_requested',
    `Requested a quote for ${quote.lines.map((l) => `${qty(l.quantity, l.baseUnit)} ${l.brand} ${l.packLabel}`).join(' + ')}`,
    refs,
    input.rationale,
  );
  record(
    GATEWAY,
    'quote_issued',
    `Issued signed quote ${quote.quoteId}: ${eur(quote.total)}, valid until ${quote.expiresAt.slice(11, 16)} UTC`,
    refs,
    [
      quote.meetsDeadline ? 'Delivers by the requested date' : 'Some deliveries arrive after the requested date',
      quote.meetsRequirements ? 'meets stated requirements' : 'does NOT meet all stated requirements',
      sourcing.rules.length ? `keeps the sourcing promise (v${quote.promise.version})` : '',
    ]
      .filter(Boolean)
      .join('; '),
  );

  return { kind: 'quote', quote, verifyUrl: `${PUBLIC_URL}/quotes/${quote.quoteId}` };
}

export function getSearch(searchId: string): OffersResult | undefined {
  return searches.get(searchId);
}

export function getQuote(quoteId: string): Quote | undefined {
  return quotes.get(quoteId);
}

// --- orders & mandate ---------------------------------------------------------

export const RULES = {
  signature: 'Signed quote is valid',
  limit: 'Within autonomous spend limit',
  budget: 'Within weekly budget',
  categories: 'Allowed product categories',
  date: 'Delivered by requested date',
  requirements: 'Meets stated requirements',
  promise: 'Keeps the sourcing promise',
  substitute: 'Same product as originally ordered',
  conditions: "Meets the approver's conditions",
} as const;

export function evaluateMandate(quote: Quote): RuleCheck[] {
  const checks: RuleCheck[] = [
    {
      rule: RULES.signature,
      passed: true,
      detail: `Signature ${quote.signature!.kid} verified, quote not expired`,
    },
    {
      rule: RULES.limit,
      passed: quote.total <= mandate.autoApproveLimit,
      detail: `${eur(quote.total)} ${quote.total <= mandate.autoApproveLimit ? '≤' : '>'} ${eur(mandate.autoApproveLimit)} per order`,
    },
    {
      rule: RULES.budget,
      passed: mandate.spentThisWeek + quote.total <= mandate.weeklyBudget,
      detail: `${eur(mandate.spentThisWeek)} spent + ${eur(quote.total)} vs ${eur(mandate.weeklyBudget)} budget`,
    },
  ];

  const blocked = quote.lines
    .map((l) => getProduct(l.productId)!)
    .filter((p) => !categoryAllowed(p.category));
  checks.push({
    rule: RULES.categories,
    passed: blocked.length === 0,
    detail: blocked.length
      ? `Outside mandate: ${[...new Set(blocked.map((p) => p.category))].join(', ')}`
      : `All in ${mandate.allowedCategories.join(', ')}`,
  });

  if (quote.neededBy && mandate.requireOnTimeDelivery) {
    checks.push({
      rule: RULES.date,
      passed: quote.meetsDeadline,
      detail: quote.meetsDeadline
        ? `All deliveries by ${formatDate(quote.neededBy)}`
        : `Part of the order arrives after ${formatDate(quote.neededBy)}`,
    });
  }
  if (mandate.requireRequirementsMatch && Object.keys(quote.requirements).length) {
    checks.push({
      rule: RULES.requirements,
      passed: quote.meetsRequirements,
      detail: quote.meetsRequirements
        ? 'All products meet the requirements'
        : 'Contains a substitute outside the stated requirements',
    });
  }
  if (sourcing.rules.length) {
    checks.push({ rule: RULES.promise, passed: true, detail: promiseLabels().join('; ') });
  }
  if (quote.replacementFor && mandate.requireSubstituteApproval) {
    const original = getProduct(quote.replacementFor.productId);
    const same = quote.lines.every((l) => getProduct(l.productId)?.equivalenceGroup === original?.equivalenceGroup);
    checks.push({
      rule: RULES.substitute,
      passed: same,
      detail: same ? 'Same product, possibly another pack size' : `Replaces ${original?.name ?? 'the original'} with a different product`,
    });
  }
  return checks;
}

function orderResult(order: Order): OrderResult {
  return {
    kind: 'order',
    order,
    approvalUrl: order.status === 'pending_approval' ? `${PUBLIC_URL}${APP_BASE}/orders/${order.orderId}` : undefined,
  };
}

export const addSpend = (amount: number) => {
  mandate.spentThisWeek = round2(Math.max(0, mandate.spentThisWeek + amount));
};

export const refsFor = (order: Order) => ({
  searchId: quotes.get(order.quoteId)?.searchId,
  quoteId: order.quoteId,
  orderId: order.orderId,
});

/** Creates the order for a verified quote and records it. `approvedBy` confirms it on a person's behalf. */
function createOrder(
  quote: Quote,
  checks: RuleCheck[],
  actor: string,
  rationale: string | undefined,
  extra: { revisionOf?: string; approvedBy?: string; approvalNote?: string } = {},
): Order {
  const failed = checks.filter((c) => !c.passed);
  const order: Order = {
    orderId: shortId('O'),
    quoteId: quote.quoteId,
    buyer: quote.buyer,
    status: failed.length ? 'pending_approval' : 'confirmed',
    total: quote.total,
    lines: quote.lines,
    checks,
    approver: failed.length || extra.approvedBy ? mandate.approver : undefined,
    createdAt: new Date().toISOString(),
    agentRationale: rationale,
    placedBy: actor,
    neededBy: quote.neededBy,
    explanation: quote.explanation,
    promise: quote.promise,
    revisionOf: extra.revisionOf,
    replacementFor: quote.replacementFor,
  };
  if (order.status === 'confirmed' && extra.approvedBy) {
    order.decidedBy = extra.approvedBy;
    order.decidedAt = order.createdAt;
    order.decisionComment = extra.approvalNote;
  }
  orders.set(order.orderId, order);
  if (order.status === 'confirmed') addSpend(order.total);

  const refs = { searchId: quote.searchId, quoteId: quote.quoteId, orderId: order.orderId };
  record(actor, 'order_placed', `Placed order ${order.orderId} from quote ${quote.quoteId} (${eur(order.total)})`, refs, rationale);
  record(
    GATEWAY,
    order.status === 'confirmed' ? 'order_confirmed' : 'approval_requested',
    order.status === 'confirmed'
      ? extra.approvedBy
        ? `Confirmed under ${firstName(extra.approvedBy)}'s approval with changes`
        : `Confirmed automatically: all ${checks.length} mandate rules passed`
      : `Sent to ${mandate.approver} for approval`,
    refs,
    failed.length ? failed.map((c) => `${c.rule}: ${c.detail}`).join('; ') : (quote.explanation ?? undefined),
  );
  return order;
}

function verifiedQuote(quoteId: string): Quote {
  const quote = quotes.get(quoteId);
  if (!quote) throw new GatewayError(`Quote ${quoteId} not found`);
  if (Date.now() > Date.parse(quote.expiresAt)) {
    throw new GatewayError(`Quote ${quote.quoteId} expired at ${quote.expiresAt}; request a new quote`);
  }
  if (!verifyQuote(quote)) throw new GatewayError(`Quote ${quote.quoteId} failed signature verification`);
  // The promise may have changed since the quote was issued.
  assertPromise(quote.lines.map((l) => l.productId));
  return quote;
}

export function placeOrder(input: { quoteId: string; rationale?: string }, actor: string = ACTORS.agent): OrderResult {
  const existing = [...orders.values()].find((o) => o.quoteId === input.quoteId);
  if (existing) return orderResult(existing);
  const quote = verifiedQuote(input.quoteId);
  if (quote.revisionOf) {
    return reviseOrder({ orderId: quote.revisionOf, quoteId: quote.quoteId, rationale: input.rationale }, actor);
  }
  return orderResult(createOrder(quote, evaluateMandate(quote), actor, input.rationale));
}

/** Places an order for a quote with extra checks and, optionally, a person's approval (used by fulfilment). */
export function placeWithChecks(
  quoteId: string,
  actor: string,
  rationale: string | undefined,
  adjust: (checks: RuleCheck[]) => RuleCheck[] = (c) => c,
  extra: { approvedBy?: string; approvalNote?: string } = {},
): Order {
  const quote = verifiedQuote(quoteId);
  return createOrder(quote, adjust(evaluateMandate(quote)), actor, rationale, extra);
}

export function getOrder(orderId: string): OrderResult {
  return orderResult(findOrder(orderId));
}

export function findOrder(orderId: string): Order {
  const order = orders.get(orderId);
  if (!order) throw new GatewayError(`Order ${orderId} not found`);
  return order;
}

export function listOrders(): Order[] {
  return [...orders.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Human decision from the approval console (outside the chat). */
export function decide(orderId: string, approve: boolean, comment?: string): Order {
  const order = findOrder(orderId);
  if (order.status !== 'pending_approval') throw new GatewayError(`Order ${orderId} is already ${order.status}`);

  order.status = approve ? 'confirmed' : 'rejected';
  order.decidedBy = mandate.approver;
  order.decidedAt = new Date().toISOString();
  order.decisionComment = comment || undefined;
  if (approve) addSpend(order.total);

  record(
    ACTORS.approver(),
    approve ? 'approved' : 'rejected',
    `${approve ? 'Approved' : 'Rejected'} order ${order.orderId} (${eur(order.total)})`,
    refsFor(order),
    comment || undefined,
  );
  return order;
}

// --- approve with changes ---------------------------------------------------------

export function describeChanges(order: Order, ch: Omit<RequestedChanges, 'by' | 'at'>): string {
  const parts: string[] = [];
  for (const l of ch.lines ?? []) {
    const line = order.lines.find((x) => x.productId === l.productId);
    if (!line || line.quantity === l.quantity) continue;
    parts.push(l.quantity === 0 ? `drop ${line.productName}` : `${qty(l.quantity, line.baseUnit)} instead of ${qty(line.quantity, line.baseUnit)} ${line.productName}`);
  }
  if (ch.maxTotal !== undefined) parts.push(`approve if the total stays at or below ${eur(ch.maxTotal)}`);
  return parts.join('; ');
}

/**
 * The approver answers "yes, but…": new quantities and/or a price cap. With new quantities the gateway
 * produces the revised quote right away; with only a cap the agent proposes the revision (revise_order).
 */
export function requestChanges(
  orderId: string,
  input: { lines?: { productId: string; quantity: number }[]; maxTotal?: number; comment?: string },
): Order {
  const order = findOrder(orderId);
  if (order.status !== 'pending_approval') throw new GatewayError(`Order ${orderId} is already ${order.status}`);
  const lines = (input.lines ?? []).filter((l) => {
    const line = order.lines.find((x) => x.productId === l.productId);
    return line && Number.isFinite(l.quantity) && l.quantity >= 0 && l.quantity !== line.quantity;
  });
  if (!lines.length && input.maxTotal === undefined) throw new GatewayError('Change at least one quantity or set a maximum total');
  if (lines.length && lines.length === order.lines.length && lines.every((l) => l.quantity === 0)) {
    throw new GatewayError('That removes every line; reject the order instead');
  }
  // A cap the current order already meets is a plain approval.
  if (!lines.length && input.maxTotal! >= order.total) {
    return decide(orderId, true, input.comment || `Approved: total within ${eur(input.maxTotal!)}`);
  }

  const changes: RequestedChanges = {
    lines: lines.length ? lines : undefined,
    maxTotal: input.maxTotal,
    comment: input.comment || undefined,
    by: mandate.approver,
    at: new Date().toISOString(),
  };
  order.status = 'changes_requested';
  order.requestedChanges = changes;
  order.decidedBy = mandate.approver;
  order.decidedAt = changes.at;
  order.decisionComment = changes.comment;
  record(
    ACTORS.approver(),
    'changes_requested',
    `Asked for changes to order ${order.orderId}: ${describeChanges(order, changes)}`,
    refsFor(order),
    changes.comment,
  );

  if (lines.length) {
    const merged = order.lines
      .map((l) => ({ productId: l.productId, quantity: lines.find((x) => x.productId === l.productId)?.quantity ?? l.quantity }))
      .filter((l) => l.quantity > 0);
    reviseOrder(
      { orderId, lines: merged, rationale: `Revised to ${firstName(mandate.approver)}'s quantities` },
      ACTORS.approver(),
    );
  }
  return order;
}

/** Revises an order the approver asked to change; confirmed straight away if it meets their conditions. */
export function reviseOrder(
  input: { orderId: string; lines?: { productId: string; quantity: number }[]; quoteId?: string; rationale?: string },
  actor: string = ACTORS.agent,
): OrderResult {
  const original = findOrder(input.orderId);
  if (original.status === 'revised' && original.revisedAs) return getOrder(original.revisedAs);
  if (original.status !== 'changes_requested' || !original.requestedChanges) {
    throw new GatewayError(`Order ${original.orderId} is ${original.status}; only orders with requested changes can be revised`);
  }
  const ch = original.requestedChanges;
  const origQuote = quotes.get(original.quoteId);

  let quoteId = input.quoteId;
  if (!quoteId) {
    if (!input.lines?.length) throw new GatewayError('Pass the revised lines (productId + quantity)');
    quoteId = requestQuote(
      {
        lines: input.lines,
        neededBy: origQuote?.neededBy,
        requirements: origQuote?.requirements,
        searchId: origQuote?.searchId,
        rationale: input.rationale,
        revisionOf: original.orderId,
        explanationPrefix: `Revised per ${firstName(ch.by)}'s request (${describeChanges(original, ch)}).`,
      },
      actor,
    ).quote.quoteId;
  }
  const quote = verifiedQuote(quoteId);

  const conditions: string[] = [];
  let conditionsMet = true;
  if (ch.maxTotal !== undefined) {
    const ok = quote.total <= ch.maxTotal;
    conditionsMet &&= ok;
    conditions.push(`${eur(quote.total)} ${ok ? '≤' : '>'} ${eur(ch.maxTotal)} cap`);
  }
  for (const want of ch.lines ?? []) {
    const p = getProduct(want.productId);
    const got = quote.lines.filter((l) => l.productId === want.productId).reduce((s, l) => s + l.quantity, 0);
    const ok = want.quantity === 0 ? got === 0 : got >= want.quantity && got < want.quantity + (p?.packSize ?? 1);
    conditionsMet &&= ok;
    conditions.push(`${p?.name ?? want.productId}: ${qty(got, p?.baseUnit ?? '')} (asked ${qty(want.quantity, p?.baseUnit ?? '')})`);
  }

  const originallyFailed = new Set(original.checks.filter((c) => !c.passed).map((c) => c.rule));
  const order = placeWithChecks(
    quote.quoteId,
    actor,
    input.rationale,
    (checks) => {
      for (const c of checks) {
        const covered = c.rule === RULES.limit || c.rule === RULES.budget || originallyFailed.has(c.rule);
        if (!c.passed && conditionsMet && covered) {
          c.passed = true;
          c.detail += ` (covered by ${firstName(ch.by)}'s approval with changes)`;
        }
      }
      return [...checks, { rule: RULES.conditions, passed: conditionsMet, detail: conditions.join('; ') }];
    },
    { approvedBy: ch.by, approvalNote: ch.comment },
  );
  order.revisionOf = original.orderId;
  if (order.status !== 'confirmed') {
    order.decidedBy = order.decidedAt = order.decisionComment = undefined;
  }
  original.status = 'revised';
  original.revisedAs = order.orderId;
  record(
    GATEWAY,
    'order_revised',
    `Order ${original.orderId} revised as ${order.orderId} (${eur(order.total)})`,
    { orderId: original.orderId },
    conditionsMet ? `Meets ${firstName(ch.by)}'s conditions: ${conditions.join('; ')}` : `Does not meet the conditions: ${conditions.join('; ')}`,
  );
  return orderResult(order);
}

export function auditTrail(orderId: string): AuditResult {
  const order = findOrder(orderId);
  const quote = quotes.get(order.quoteId);
  return {
    kind: 'audit',
    orderId,
    events: eventsFor({ orderId, quoteId: order.quoteId, searchId: quote?.searchId }),
    chainValid: verifyChain(),
  };
}

// --- assortment ---------------------------------------------------------------

/** The whole assortment (or one top-level category) with prices and what can be delivered soonest. */
export function browseAssortment(category?: string): AssortmentResult {
  const wanted = category?.toLowerCase();
  const products = catalog.filter((p) => !wanted || topCategory(p.category).toLowerCase().includes(wanted));
  if (products.length === 0) {
    throw new GatewayError(`No category matching "${category}". Categories: ${allTopCategories.join(', ')}`);
  }
  const groups = Map.groupBy(products, (p) => p.category);
  return {
    kind: 'assortment',
    buyer: mandate.buyer,
    categories: [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, items]) => ({
        name,
        items: items.map((p) => ({
          id: p.id,
          name: p.name,
          image: p.image,
          brand: p.brand,
          packLabel: p.packLabel,
          packPrice: p.packPrice,
          unitPrice: round2(p.packPrice / p.packSize),
          baseUnit: p.baseUnit,
          inStock: round2(p.stockPacks * p.packSize),
          firstDelivery: addDays(today(), p.leadTimeDays),
          dietary: p.dietary,
          certificates: p.certificates,
          withinMandate: categoryAllowed(p.category),
          origin: p.origin,
          breaksPromise: promiseGaps(p).join('; ') || undefined,
        })),
      })),
  };
}

// --- mandate administration (humans only, via the console) --------------------

export type MandatePatch = Partial<
  Pick<
    Mandate,
    | 'autoApproveLimit'
    | 'weeklyBudget'
    | 'allowedCategories'
    | 'requireOnTimeDelivery'
    | 'requireRequirementsMatch'
    | 'requireSubstituteApproval'
  >
>;

export function updateMandate(patch: MandatePatch): string[] {
  const changes: string[] = [];
  const describe = (v: unknown) =>
    typeof v === 'number' ? eur(v) : Array.isArray(v) ? v.join(', ') || 'none' : v ? 'on' : 'off';
  const labels: Record<keyof MandatePatch, string> = {
    autoApproveLimit: 'Per-order limit',
    weeklyBudget: 'Weekly budget',
    allowedCategories: 'Allowed categories',
    requireOnTimeDelivery: 'Late delivery needs approval',
    requireRequirementsMatch: 'Requirement mismatch needs approval',
    requireSubstituteApproval: 'Substitute product needs approval',
  };
  for (const key of Object.keys(labels) as (keyof MandatePatch)[]) {
    const next = patch[key];
    if (next === undefined) continue;
    const prev = mandate[key];
    if (JSON.stringify(prev) === JSON.stringify(next)) continue;
    changes.push(`${labels[key]}: ${describe(prev)} → ${describe(next)}`);
    (mandate as Record<string, unknown>)[key] = next;
  }
  if (changes.length) {
    record(ACTORS.approver(), 'mandate_changed', 'Changed the agent mandate', {}, changes.join('; '));
  }
  return changes;
}

export function fullAuditLog(): { events: AuditEvent[]; chainValid: boolean } {
  return { events: allEvents(), chainValid: verifyChain() };
}

export function orderDetail(orderId: string): {
  order: Order;
  quote?: Quote;
  events: AuditEvent[];
  chainValid: boolean;
  related: Order[];
} {
  const order = findOrder(orderId);
  const quote = quotes.get(order.quoteId);
  const relatedIds = new Set(
    [order.revisionOf, order.revisedAs, order.replacementFor?.orderId, order.disruption?.replacementOrderId].filter(
      (x): x is string => !!x,
    ),
  );
  return {
    order,
    quote,
    events: eventsFor({ orderId, quoteId: order.quoteId, searchId: quote?.searchId }),
    chainValid: verifyChain(),
    related: [...relatedIds].flatMap((id) => (orders.has(id) ? [orders.get(id)!] : [])),
  };
}

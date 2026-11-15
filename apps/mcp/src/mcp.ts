import { RESOURCE_MIME_TYPE, registerAppResource, registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import { McpServer } from '@modelcontextprotocol/server';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { allTopCategories } from './catalog';
import { PUBLIC_URL } from './config';
import * as gateway from './gateway';
import * as fulfilment from './fulfilment';
import { describeMandate, mandate } from './mandate';
import * as planner from './planner';
import { describePromise, promiseLabels, sourcing } from './sourcing';
import { currentAgent, hasScope } from './tokens';
import type { DisruptionsResult, Offer, OrderResult, QuoteResult, ReconciliationResult, WidgetPayload } from './types';
import { eur, formatDate, qty, today } from './util';

const WIDGET_URI = 'ui://aimo/widget.html';

const here = dirname(fileURLToPath(import.meta.url));
const widgetPath = [resolve(here, 'widget.html'), resolve(here, '../dist/widget.html')].find(existsSync);

function readWidget(): string {
  // Read on every request so `npm run dev` picks up rebuilt widgets without a restart.
  if (!widgetPath || !existsSync(widgetPath)) {
    return '<!doctype html><p style="font-family:sans-serif">Widget not built. Run <code>npm run build -w @valio/mcp</code>.</p>';
  }
  return readFileSync(widgetPath, 'utf8');
}

const uiMeta = { ui: { resourceUri: WIDGET_URI } };

// --- input schemas --------------------------------------------------------------

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe('Date as YYYY-MM-DD');

const requirementsSchema = z
  .object({
    dietary: z
      .array(z.enum(['lactose-free', 'dairy-free', 'gluten-free', 'vegan']))
      .optional()
      .describe('Dietary properties every product must have'),
    certificates: z
      .array(z.string())
      .optional()
      .describe('Certificates every product must have, e.g. "EU Organic", "Finnish origin"'),
    excludeAllergens: z.array(z.string()).optional().describe('Allergens to exclude, e.g. "milk", "egg", "oats"'),
  })
  .describe("The buyer's hard requirements. Products not meeting them are excluded and listed with the reason.");

const rationale = z
  .string()
  .max(500)
  .optional()
  .describe('One or two sentences on why you chose this, in plain language. Stored in the audit trail.');

// --- result helpers -------------------------------------------------------------

type ToolResult = {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function ok(payload: WidgetPayload, text: string): ToolResult {
  return { content: [{ type: 'text', text }], structuredContent: payload as unknown as Record<string, unknown> };
}

function guarded(fn: () => ToolResult): ToolResult {
  try {
    return fn();
  } catch (err) {
    if (err instanceof gateway.GatewayError) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
    throw err;
  }
}

function quoteText(r: QuoteResult): string {
  const q = r.quote;
  return [
    `Quote ${q.quoteId}: ${eur(q.total)} excl. VAT, valid until ${q.expiresAt}.`,
    ...q.lines.map(
      (l) =>
        `- ${qty(l.quantity, l.baseUnit)} ${l.brand} ${l.productName} (${l.packLabel}), deliveries: ${l.deliveries.map((d) => `${qty(d.quantity, l.baseUnit)} on ${d.date}`).join(', ')}`,
    ),
    `Meets requested date: ${q.meetsDeadline ? 'yes' : 'no'}. Meets requirements: ${q.meetsRequirements ? 'yes' : 'no'}. Keeps the sourcing promise (v${q.promise.version}).`,
    q.explanation ? `Why: ${q.explanation}` : '',
    `Signed with ${q.signature?.kid}; verify at ${r.verifyUrl}.`,
  ]
    .filter(Boolean)
    .join('\n');
}

function orderText(r: OrderResult): string {
  const o = r.order;
  const next: Record<string, string> = {
    pending_approval: `Waiting for ${o.approver}. Approval link for the approver: ${r.approvalUrl}. Check later with get_order_status.`,
    confirmed: o.decidedBy
      ? `Approved by ${o.decidedBy}${o.decisionComment ? `: "${o.decisionComment}"` : ''}.`
      : 'Confirmed within the mandate.',
    rejected: `Rejected by ${o.decidedBy}${o.decisionComment ? `: "${o.decisionComment}"` : ''}.`,
    changes_requested: o.requestedChanges
      ? `${o.requestedChanges.by} approved with changes: ${gateway.describeChanges(o, o.requestedChanges)}${o.requestedChanges.comment ? ` ("${o.requestedChanges.comment}")` : ''}. Propose a revision with revise_order (orderId ${o.orderId} and the new lines); if it meets these conditions it is confirmed straight away.`
      : '',
    revised: `Revised as order ${o.revisedAs}; check that one with get_order_status.`,
  };
  return [
    `Order ${o.orderId}: ${o.status.toUpperCase()} (${eur(o.total)}).`,
    o.explanation ? `Why: ${o.explanation}` : '',
    ...o.checks.map((c) => `- ${c.passed ? 'PASS' : 'NEEDS APPROVAL'} ${c.rule}: ${c.detail}`),
    next[o.status],
    o.revisionOf ? `This revises order ${o.revisionOf}.` : '',
    o.disruption?.status === 'open'
      ? `SUPPLIER PROBLEM: ${o.disruption.reason}. Replacement options: ${o.disruption.options.map((x) => `${x.optionId} ${x.note}`).join(' | ') || 'none'}. Use resolve_disruption.`
      : '',
    o.delivery
      ? `Delivered; ${o.delivery.shortValue > 0 ? `short by ${eur(o.delivery.shortValue)}, see reconcile_delivery` : 'matches the order'}.`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function disruptionsText(r: DisruptionsResult): string {
  if (!r.orders.length) return 'No open supplier problems.';
  return r.orders
    .map(({ orderId, summary, disruption: d }) =>
      [
        `${summary}. ${d.reason}. ${eur(d.creditValue)} credited.`,
        ...d.options.map(
          (o) =>
            `  - optionId ${o.optionId} (orderId ${orderId}): ${o.line.packs} × ${o.line.brand} ${o.line.productName} ${o.line.packLabel}, ${eur(o.line.lineTotal)}. ${o.note}`,
        ),
      ].join('\n'),
    )
    .join('\n')
    .concat('\nTo fix one, call resolve_disruption with orderId and optionId. Prefer the same product; a different product may need approval.');
}

function reconciliationText(r: ReconciliationResult): string {
  const d = r.delivery;
  return [
    `Delivery of ${r.orderId}: ${d.shortValue > 0 ? `short, ${eur(d.shortValue)} to credit` : 'matches the order'}.`,
    ...d.lines.map(
      (l) =>
        `- ${l.productName}: ordered ${qty(l.ordered, l.baseUnit)}, picked ${qty(l.picked, l.baseUnit)}, received ${qty(l.received, l.baseUnit)}${l.issue ? ` (${l.issue})` : ''}`,
    ),
    d.followUp
      ? `Draft follow-up (${d.followUp.sentAt ? 'already sent' : 'not sent yet; show it to the user, the approver sends it from the console'}):\nSubject: ${d.followUp.subject}\n${d.followUp.body}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function offerText(o: Offer): string {
  const lines = o.lines
    .map((l) => `    - productId ${l.productId}: ${qty(l.quantity, l.baseUnit)} (${l.packs} × ${l.packLabel}) ${eur(l.lineTotal)}`)
    .join('\n');
  return [
    `${o.rank}. [${o.badge}] offerId ${o.offerId}: ${o.title}, total ${eur(o.total)}`,
    lines,
    `    Why: ${o.explanation}`,
    ...o.reasons.map((r) => `    · ${r}`),
  ].join('\n');
}

// --- server ---------------------------------------------------------------------

export function createServer(): McpServer {
  // Tools are registered per request according to the token's scopes: a read-only token never sees place_order.
  const can = hasScope;
  const server = new McpServer(
    { name: 'valio-aimo-agent-gateway', title: 'Valio Aimo Agent Gateway (mock)', version: '0.1.0' },
    {
      instructions: [
        'Valio Aimo Agent Gateway (mock, synthetic data). Lets a purchasing agent buy from Valio Aimo on behalf of a professional kitchen.',
        'Flow: get_mandate → search_products → request_quote (signed, fixed price) → place_order. The gateway enforces the buyer mandate: orders within it are confirmed, others go to a named human approver.',
        'Never claim an order is approved unless get_order_status says so. Approval happens outside the chat, in the Valio Aimo approval console.',
        'Use browse_assortment (one call) when the user wants to see what is available. You cannot change the mandate; only a human can, in the Valio Aimo console.',
        'The buyer has a sourcing promise to its guests (e.g. Finnish dairy, EU origin only). The gateway never offers or quotes a product that breaks it and no approver can override it; do not try to work around it.',
        'Planning a meal or event ("breakfast for 180 guests, 20 vegan, budget €450"): plan_menu_basket, then request_quote with its lines and basketId.',
        'Proactive: check_stock shows what will run out and suggests a waste-aware reorder. check_disruptions shows supplier problems with replacements (resolve_disruption).',
        'If the approver approves with changes (status changes_requested), call revise_order with the revised lines. After delivery, reconcile_delivery compares ordered, picked and received quantities and drafts a follow-up.',
        'Each offer, quote and order carries a one-sentence explanation ("Why"). Use it when telling the user what you chose.',
        'The user may also act directly in the widgets (request a quote, place an order); the widget then tells you what happened.',
        `Today is ${today()} (${formatDate(today())}).`,
      ].join('\n'),
    },
  );

  registerAppResource(
    server,
    'Valio Aimo offer & order view',
    WIDGET_URI,
    { description: 'Interactive offers, quotes, order status and audit trail', mimeType: RESOURCE_MIME_TYPE, _meta: { ui: { csp: { resourceDomains: [new URL(PUBLIC_URL).origin] } } } },
    async () => ({ contents: [{ uri: WIDGET_URI, mimeType: RESOURCE_MIME_TYPE, text: readWidget() }] }),
  );

  if (can('catalog:read'))
  server.registerTool(
    'get_mandate',
    {
      title: 'Get purchasing mandate',
      description:
        "Returns the buyer's agent mandate (spend limits, weekly budget, allowed categories, which decisions need human approval) and its sourcing promise to guests (e.g. Finnish dairy only), which the gateway enforces as a hard rule. Call this first so you know what you may decide on your own.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => ({
      content: [{ type: 'text', text: `${describeMandate()}\n${describePromise()}\nToday is ${today()} (${formatDate(today())}).` }],
      structuredContent: { ...mandate, promise: promiseLabels(), promiseStatement: sourcing.statement, today: today() },
    }),
  );

  if (can('catalog:read'))
  registerAppTool(
    server,
    'search_products',
    {
      title: 'Search products, prices & availability',
      description: [
        'Search the Valio Aimo assortment and get ranked offers with fixed list prices, availability per delivery date, lead times, on-time delivery rate and sustainability certificates.',
        'Pass quantity (in litres, kg or pieces) and neededBy to get availability for that date. Offers are ranked good/better/best: "best-value" meets quantity, date and requirements at the lowest cost once likely waste is counted (pack-size surplus vs usage and shelf life); "premium" has more certifications; "partial" is cheaper but misses the date or quantity.',
        "Products that break the buyer's sourcing promise are never offered; they are listed as excluded with the reason.",
        'When no single pack size can meet the date, the gateway proposes a combination of pack sizes of the same product.',
        'Shows an interactive offer comparison to the user.',
      ].join(' '),
      inputSchema: z.object({
        query: z.string().describe('What to look for, e.g. "lactose-free milk"'),
        quantity: z.number().positive().optional().describe('Total quantity needed in the base unit (L, kg or pcs)'),
        neededBy: isoDate.optional().describe('Latest acceptable delivery date (YYYY-MM-DD)'),
        requirements: requirementsSchema.optional(),
        usagePerDay: z
          .number()
          .positive()
          .optional()
          .describe('Expected use per day in the base unit, if the user said so. Otherwise the kitchen stock data is used for the waste check.'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: uiMeta,
    },
    async (args) =>
      guarded(() => {
        const r = gateway.search(args, currentAgent());
        const header = `searchId ${r.searchId} — ${r.offers.length} offer(s) for "${r.query}"${r.quantity ? `, ${r.quantity} units` : ''}${r.neededBy ? ` by ${r.neededBy}` : ''}:`;
        const excluded = r.excluded.length
          ? `\nExcluded: ${r.excluded.map((e) => `${e.productName}: ${e.reason}`).join('; ')}`
          : '';
        const notes = [
          r.usageNote ? `\nHeads-up: ${r.usageNote}` : '',
          r.promise.length ? `\nAll offers keep the sourcing promise: ${r.promise.join('; ')}.` : '',
        ].join('');
        return ok(
          r,
          `${header}\n${r.offers.map(offerText).join('\n')}${excluded}${notes}\nTo continue, call request_quote with the offer's lines (productId + quantity), searchId and offerId.`,
        );
      }),
  );

  if (can('quotes:write'))
  registerAppTool(
    server,
    'request_quote',
    {
      title: 'Request a signed quote',
      description: [
        'Turn an offer into a binding, fixed-price quote signed by Valio Aimo (Ed25519, verifiable via /.well-known/jwks.json). Quotes are valid for 30 minutes.',
        'Use the lines from a search_products offer. Include neededBy and requirements again so the gateway can check them, and a short rationale for the audit trail.',
        'Shows the quote to the user.',
      ].join(' '),
      inputSchema: z.object({
        lines: z
          .array(z.object({ productId: z.string(), quantity: z.number().positive().describe('Base units (L, kg, pcs)') }))
          .min(1),
        neededBy: isoDate.optional(),
        requirements: requirementsSchema.optional(),
        searchId: z.string().optional(),
        offerId: z.string().optional(),
        basketId: z.string().optional().describe('From plan_menu_basket, when quoting a planned basket'),
        rationale,
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: uiMeta,
    },
    async (args) =>
      guarded(() => {
        const r = gateway.requestQuote({ ...args, explanation: planner.basketExplanation(args.basketId) }, currentAgent());
        return ok(
          r,
          `${quoteText(r)}\nTo commit, call place_order with this quoteId. The gateway decides whether it is within the mandate or needs approval.`,
        );
      }),
  );

  if (can('orders:write'))
  registerAppTool(
    server,
    'place_order',
    {
      title: 'Place order from quote',
      description: [
        'Commit to a signed quote. The gateway verifies the signature and checks the buyer mandate (spend limit, weekly budget, categories, delivery date, requirements).',
        `If every rule passes the order is confirmed. Otherwise it is sent to ${mandate.approver} for approval and the status is "pending_approval"; tell the user it is waiting for sign-off and do not retry.`,
        'Include a short rationale for the audit trail. Shows the order status and mandate checks to the user.',
      ].join(' '),
      inputSchema: z.object({ quoteId: z.string(), rationale }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: uiMeta,
    },
    async (args) =>
      guarded(() => {
        const r = gateway.placeOrder(args, currentAgent());
        return ok(r, orderText(r));
      }),
  );

  if (can('catalog:read'))
  registerAppTool(
    server,
    'browse_assortment',
    {
      title: 'Browse the assortment',
      description: [
        'List the Valio Aimo assortment by category with list prices, pack sizes, stock, earliest delivery, dietary properties and certificates, and whether each category is within the buyer mandate.',
        `Use this when the user wants to see what is available, instead of running many searches. Optional category filter (top-level categories: ${allTopCategories.join(', ')}).`,
        'Shows a compact catalogue view to the user. For quantities and delivery dates, use search_products.',
      ].join(' '),
      inputSchema: z.object({ category: z.string().optional().describe('Top-level category, e.g. "Dairy"') }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: uiMeta,
    },
    async ({ category }) =>
      guarded(() => {
        const r = gateway.browseAssortment(category);
        return ok(
          r,
          r.categories
            .map(
              (c) =>
                `${c.name}:\n${c.items
                  .map(
                    (i) =>
                      `- ${i.id} ${i.brand} ${i.name}, ${i.packLabel}: ${eur(i.packPrice)} (${eur(i.unitPrice)}/${i.baseUnit}), ${qty(i.inStock, i.baseUnit)} in stock from ${i.firstDelivery}${i.withinMandate ? '' : ' [category needs approval]'}`,
                  )
                  .join('\n')}`,
            )
            .join('\n'),
        );
      }),
  );

  // --- planning, stock and after-checkout tools ------------------------------------------

  if (can('catalog:read'))
  registerAppTool(
    server,
    'plan_menu_basket',
    {
      title: 'Plan a basket from a menu',
      description: [
        'Turn a meal into a shopping basket: "breakfast for 180 guests, 20 vegan, budget €450". Calculates quantities from per-guest norms, picks the pack sizes that cost least once likely waste is counted, keeps the sourcing promise and stays within the budget (leaving out optional items if needed, and saying so).',
        'Nothing is ordered. To order, call request_quote with the basket lines and basketId. Shows the proposed basket to the user.',
      ].join(' '),
      inputSchema: z.object({
        meal: z.enum(['breakfast', 'brunch', 'coffee-break']),
        guests: z.number().int().positive().describe('Total number of guests'),
        vegan: z.number().int().min(0).optional().describe('How many of them are vegan'),
        budget: z.number().positive().optional().describe('Budget in EUR excl. VAT'),
        neededBy: isoDate.optional(),
        requirements: requirementsSchema.optional(),
        exclude: z.array(z.string()).optional().describe('Items to leave out, e.g. ["coffee"] if bought elsewhere'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: uiMeta,
    },
    async (args) =>
      guarded(() => {
        const r = planner.planBasket(args, currentAgent());
        return ok(r, planner.basketText(r));
      }),
  );

  if (can('catalog:read'))
  registerAppTool(
    server,
    'check_stock',
    {
      title: 'Check kitchen stock & suggest reorders',
      description: [
        "Smart replenishment: the kitchen's stock, daily usage and incoming deliveries, with the day each item runs out (\"Milk will run out Thursday\") and a suggested reorder for what runs out within a week.",
        "Suggestions are waste-aware: they cover up to a week but never more than the product keeps. Nothing is ordered; to order, call request_quote with the suggested lines. Shows a stock overview to the user.",
      ].join(' '),
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: uiMeta,
    },
    async () =>
      guarded(() => {
        const r = fulfilment.replenishment();
        return ok(r, fulfilment.replenishmentText(r));
      }),
  );

  if (can('catalog:read'))
  registerAppTool(
    server,
    'check_disruptions',
    {
      title: 'Check supplier problems',
      description:
        "Lists confirmed orders where a supplier can't deliver an item, with replacement options: price and delivery differences, and whether each would need approval. Shows the options to the user.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: uiMeta,
    },
    async () =>
      guarded(() => {
        const r = fulfilment.openDisruptions();
        return ok(r, disruptionsText(r));
      }),
  );

  if (can('orders:write'))
  registerAppTool(
    server,
    'resolve_disruption',
    {
      title: 'Order a replacement',
      description:
        'Orders a replacement option from check_disruptions. It goes through the mandate like any order: a different product, a higher price or a later date can need approval. Shows the replacement order to the user.',
      inputSchema: z.object({ orderId: z.string(), optionId: z.string(), rationale }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: uiMeta,
    },
    async (args) =>
      guarded(() => {
        const r = fulfilment.resolveDisruption(args, currentAgent());
        return ok(r, orderText(r));
      }),
  );

  if (can('orders:write'))
  registerAppTool(
    server,
    'revise_order',
    {
      title: 'Revise an order after "approve with changes"',
      description: [
        'When the approver approved with changes (status changes_requested, e.g. "approve if the total stays below €1,600"), propose the revised lines here. The gateway quotes them and, if they meet the approver\'s conditions, confirms the order straight away; otherwise it goes back for approval.',
        'You may change quantities or switch to a cheaper product. Shows the revised order to the user.',
      ].join(' '),
      inputSchema: z.object({
        orderId: z.string(),
        lines: z.array(z.object({ productId: z.string(), quantity: z.number().positive() })).min(1),
        rationale,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      _meta: uiMeta,
    },
    async (args) =>
      guarded(() => {
        const r = gateway.reviseOrder(args, currentAgent());
        return ok(r, orderText(r));
      }),
  );

  if (can('catalog:read'))
  registerAppTool(
    server,
    'reconcile_delivery',
    {
      title: 'Reconcile a delivery',
      description: [
        'Compares ordered, picked and received quantities for a delivered order, highlights shortages and drafts a follow-up to Valio Aimo customer service.',
        'If the delivery is not recorded yet, pass what the kitchen received (from the user) as "received"; that needs order permission. Shows the comparison and the draft to the user.',
      ].join(' '),
      inputSchema: z.object({
        orderId: z.string(),
        received: z
          .array(z.object({ productId: z.string(), quantity: z.number().min(0).describe('Base units received') }))
          .optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: uiMeta,
    },
    async ({ orderId, received }) =>
      guarded(() => {
        if (received?.length && !can('orders:write')) {
          throw new gateway.GatewayError('This token may not record deliveries. Ask the user to record it in the Valio Aimo console.');
        }
        const r = received?.length
          ? fulfilment.recordDelivery(orderId, { received }, currentAgent())
          : fulfilment.getReconciliation(orderId);
        return ok(r, reconciliationText(r));
      }),
  );

  // --- app-only tools ---------------------------------------------------------------
  // Called by the widget when the user clicks a button. Hidden from the model (visibility: app), so the audit
  // trail can tell the buyer's own click apart from the agent's decision. The mandate still applies.

  const appOnly = { ui: { resourceUri: WIDGET_URI, visibility: ['app' as const] } };

  if (can('quotes:write'))
  registerAppTool(
    server,
    'widget_request_quote',
    {
      title: 'Request quote (from widget)',
      description: 'Used by the offer widget when the user clicks "Request signed quote". Not for the model.',
      inputSchema: z.object({
        lines: z.array(z.object({ productId: z.string(), quantity: z.number().positive() })).min(1),
        neededBy: isoDate.optional(),
        requirements: requirementsSchema.optional(),
        searchId: z.string().optional(),
        offerId: z.string().optional(),
        basketId: z.string().optional(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: appOnly,
    },
    async (args) =>
      guarded(() => {
        const r = gateway.requestQuote(
          {
            ...args,
            explanation: planner.basketExplanation(args.basketId),
            rationale: args.basketId ? 'Selected by the buyer in the basket view' : 'Selected by the buyer in the offer comparison',
          },
          gateway.ACTORS.buyerViaWidget,
        );
        return ok(r, quoteText(r));
      }),
  );

  if (can('orders:write'))
  registerAppTool(
    server,
    'widget_place_order',
    {
      title: 'Place order (from widget)',
      description: 'Used by the quote widget when the user confirms "Place order". Not for the model.',
      inputSchema: z.object({ quoteId: z.string() }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: appOnly,
    },
    async ({ quoteId }) =>
      guarded(() => {
        const r = gateway.placeOrder({ quoteId, rationale: 'Confirmed by the buyer in the quote widget' }, gateway.ACTORS.buyerViaWidget);
        return ok(r, orderText(r));
      }),
  );

  if (can('orders:write'))
  registerAppTool(
    server,
    'widget_resolve_disruption',
    {
      title: 'Order replacement (from widget)',
      description: 'Used by the supplier-problem widget when the user picks a replacement. Not for the model.',
      inputSchema: z.object({ orderId: z.string(), optionId: z.string() }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: appOnly,
    },
    async (args) =>
      guarded(() => {
        const r = fulfilment.resolveDisruption({ ...args, rationale: 'Chosen by the buyer in the widget' }, gateway.ACTORS.buyerViaWidget);
        return ok(r, orderText(r));
      }),
  );

  if (can('catalog:read'))
  registerAppTool(
    server,
    'get_order_status',
    {
      title: 'Get order status',
      description:
        'Current status of an order (confirmed, pending_approval, rejected, changes_requested or revised), with the mandate checks, the approver decision, any supplier problem and the delivery result.',
      inputSchema: z.object({ orderId: z.string() }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: uiMeta,
    },
    async ({ orderId }) =>
      guarded(() => {
        const r = gateway.getOrder(orderId);
        return ok(r, orderText(r));
      }),
  );

  if (can('catalog:read'))
  registerAppTool(
    server,
    'get_audit_trail',
    {
      title: 'Get audit trail',
      description:
        'Human-readable, tamper-evident (hash-chained) log of everything the agent, the gateway and humans did for an order, with reasons. Shows a timeline to the user.',
      inputSchema: z.object({ orderId: z.string() }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: uiMeta,
    },
    async ({ orderId }) =>
      guarded(() => {
        const r = gateway.auditTrail(orderId);
        return ok(
          r,
          [
            `Audit trail for ${orderId} (chain ${r.chainValid ? 'intact' : 'BROKEN'}):`,
            ...r.events.map((e) => `${e.at} ${e.actor} — ${e.summary}${e.reason ? ` (why: ${e.reason})` : ''}`),
          ].join('\n'),
        );
      }),
  );

  return server;
}

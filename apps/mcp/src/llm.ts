import { GoogleGenAI, type Content, type FunctionDeclaration, type Part } from '@google/genai';
import * as automations from './automations';
import * as events from './events';
import * as fulfilment from './fulfilment';
import * as gateway from './gateway';
import { mandate } from './mandate';
import * as planner from './planner';
import { promiseLabels } from './sourcing';
import type { AssistantCard, AssistantReply, Meal, Order } from './types';
import { formatDate, today } from './util';
import { supplier, supplierEnabled, supplierMockEnabled, SupplierError } from './supplier';

// Aimo Assistant with a real model behind it (Gemini). The model plans and talks; every action goes through the
// same gateway functions as the MCP tools, so limits, requirements, approvals and the audit trail still apply.
// The model gets no tool to approve orders or change limits/requirements: those stay with the person.

export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.8-flash';
export const geminiEnabled = () => !!process.env.GEMINI_API_KEY;

let client: GoogleGenAI | undefined;
const ai = () => (client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }));

const MAX_STEPS = 8;
const conversations = new Map<string, Content[]>();
gateway.onReset(() => conversations.clear());

/** A tool the model can call: its declaration, and what it does (result for the model + card for the user). */
interface Tool {
  declaration: FunctionDeclaration;
  run: (
    args: Record<string, unknown>,
    actor: string,
  ) => { result: unknown; card?: AssistantCard } | Promise<{ result: unknown; card?: AssistantCard }>;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const num = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v)
    ? v
    : typeof v === 'string' && v.trim() && !Number.isNaN(Number(v))
      ? Number(v)
      : undefined;
const date = { type: 'string', description: 'Date as YYYY-MM-DD' };

const orderSummary = (o: Order) => ({
  orderId: o.orderId,
  status: o.status,
  total: o.total,
  lines: o.lines.map(
    (l) => `${l.quantity} ${l.baseUnit} ${l.brand} ${l.productName} (${l.packs} × ${l.packLabel})`,
  ),
  failedRules: o.checks.filter((c) => !c.passed).map((c) => `${c.rule}: ${c.detail}`),
  why: o.explanation,
  supplierProblem: o.disruption?.status === 'open' ? o.disruption.reason : undefined,
  delivered: o.delivery ? { shortValue: o.delivery.shortValue } : undefined,
});

const placed = (r: ReturnType<typeof gateway.placeOrder>) => ({
  result: {
    ...orderSummary(r.order),
    note:
      r.order.status === 'pending_approval'
        ? `Waiting for ${mandate.approver}. The user can approve it with the button on the order card; you cannot approve it.`
        : 'Confirmed.',
  },
  card: { type: 'order', data: r } as AssistantCard,
});

const TOOLS: Tool[] = [
  {
    declaration: {
      name: 'request_quote',
      description:
        'Prepare ONE combined total for all selected products without ordering. In supplier API mode this is a non-binding estimate and line.quantity MUST be in SALES UNITS, using explicit pack metadata to convert litres/kg. In local demo mode it is a signed quote and quantities are in base units. Use product IDs from search results. Include all available recipe ingredients in one estimate; explain missing ingredients separately.',
      parametersJsonSchema: {
        type: 'object',
        properties: {
          lines: {
            type: 'array',
            items: {
              type: 'object',
              properties: { productId: { type: 'string' }, quantity: { type: 'number' } },
              required: ['productId', 'quantity'],
            },
          },
          neededBy: date,
        },
        required: ['lines'],
      },
    },
    run: async (a, actor) => {
      const lines = a.lines as { productId: string; quantity: number }[];
      if (
        !Array.isArray(lines) ||
        lines.some((l) => !l || typeof l.productId !== 'string' || typeof l.quantity !== 'number')
      )
        throw new gateway.GatewayError('Pass product IDs and quantities from search results');
      if (supplierEnabled()) {
        if (!str(a.neededBy))
          throw new SupplierError('Ask the customer for the desired delivery date first.');
        const quote = await supplier.quote(lines, String(a.neededBy));
        return { result: quote, card: { type: 'supplier-quote', data: quote } };
      }
      const r = gateway.requestQuote({ lines, neededBy: str(a.neededBy) }, actor);
      return {
        result: {
          quoteId: r.quote.quoteId,
          total: r.quote.total,
          lines: r.quote.lines,
          expiresAt: r.quote.expiresAt,
          ordered: false,
        },
        card: { type: 'quote', data: r },
      };
    },
  },
  {
    declaration: {
      name: 'place_quote',
      description:
        'Place the complete quoted purchase as ONE order. Only after the user explicitly asks to order this quote. Never place an order for a request for pricing or a quote.',
      parametersJsonSchema: {
        type: 'object',
        properties: { quoteId: { type: 'string' } },
        required: ['quoteId'],
      },
    },
    run: (a, actor) => placed(gateway.placeOrder({ quoteId: String(a.quoteId) }, actor)),
  },
  {
    declaration: {
      name: 'get_rules',
      description:
        "The buyer's spending limits (per order, per week, spent so far), allowed categories and sourcing requirements (e.g. vegan only, Finnish dairy). Read-only: only the user can change them, in Limits and Requirements.",
      parametersJsonSchema: { type: 'object', properties: {} },
    },
    run: () => ({
      result: {
        perOrderLimit: mandate.autoApproveLimit,
        weeklyBudget: mandate.weeklyBudget,
        spentThisWeek: mandate.spentThisWeek,
        allowedCategories: mandate.allowedCategories,
        requirements: promiseLabels(),
      },
      card: {
        type: 'limits',
        data: {
          perOrder: mandate.autoApproveLimit,
          perWeek: mandate.weeklyBudget,
          spent: mandate.spentThisWeek,
          categories: mandate.allowedCategories,
        },
      },
    }),
  },
  {
    declaration: {
      name: 'search_products',
      description:
        'Search the Valio Aimo assortment. Returns ranked offers (best-value, premium, partial) with price, delivery dates, a one-sentence explanation and waste check. Products that break the requirements are excluded. Shows the offers to the user, who can order with one click.',
      parametersJsonSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to look for, e.g. "lactose-free milk"' },
          quantity: { type: 'number', description: 'Total quantity in the base unit (L, kg or pcs)' },
          neededBy: date,
        },
        required: ['query'],
      },
    },
    run: async (a, actor) => {
      if (supplierEnabled()) {
        if (!str(a.neededBy))
          throw new SupplierError(
            'Ask the customer for the desired delivery date before checking prices and availability.',
          );
        const result = await supplier.search(String(a.query ?? ''), String(a.neededBy));
        return { result, card: { type: 'supplier-products', data: result } };
      }
      const r = gateway.search(
        { query: String(a.query ?? ''), quantity: num(a.quantity), neededBy: str(a.neededBy) },
        actor,
      );
      return {
        result: {
          searchId: r.searchId,
          offers: r.offers.map((o) => ({
            offerId: o.offerId,
            badge: o.badge,
            title: o.title,
            lines: o.lines.map((l) => ({
              productId: l.productId,
              quantity: l.quantity,
              baseUnit: l.baseUnit,
              productName: l.productName,
            })),
            total: o.total,
            quantity: o.quantity,
            baseUnit: o.baseUnit,
            meetsQuantity: o.meetsQuantity,
            meetsDeadline: o.meetsDeadline,
            lastDelivery: o.lastDeliveryDate,
            why: o.explanation,
            likelyWaste: o.waste.likelyWaste ? o.waste.note : undefined,
          })),
          excludedByRequirements: r.excluded
            .filter((e) => e.promise)
            .map((e) => `${e.productName}: ${e.reason}`),
          usageNote: r.usageNote,
        },
        card: { type: 'offers', data: r },
      };
    },
  },
  {
    declaration: {
      name: 'order_offer',
      description:
        'Order one offer from search_products (gets a signed quote and places the order). The gateway checks the limits: within them it is confirmed, otherwise it waits for the user to approve. Only order when the user asked you to buy.',
      parametersJsonSchema: {
        type: 'object',
        properties: {
          searchId: { type: 'string' },
          offerId: { type: 'string' },
          reason: { type: 'string', description: 'One sentence, for the audit trail' },
        },
        required: ['searchId', 'offerId'],
      },
    },
    run: (a, actor) => {
      const r = gateway.getSearch(String(a.searchId));
      const offer = r?.offers.find((o) => o.offerId === a.offerId);
      if (!r || !offer) throw new gateway.GatewayError('Unknown searchId/offerId; search again.');
      const quote = gateway.requestQuote(
        {
          lines: offer.lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
          neededBy: r.neededBy,
          searchId: r.searchId,
          offerId: offer.offerId,
          rationale: str(a.reason),
        },
        actor,
      ).quote;
      return placed(
        gateway.placeOrder({ quoteId: quote.quoteId, rationale: str(a.reason) ?? offer.explanation }, actor),
      );
    },
  },
  {
    declaration: {
      name: 'plan_basket',
      description:
        'Turn a meal into a shopping basket from per-guest norms ("breakfast for 180 guests, 20 vegan, budget €450"). Waste-aware pack choice, keeps the requirements, leaves out optional items to fit the budget. Nothing is ordered. Shows the basket to the user.',
      parametersJsonSchema: {
        type: 'object',
        properties: {
          meal: { type: 'string', enum: ['breakfast', 'brunch', 'coffee-break'] },
          guests: { type: 'number' },
          vegan: { type: 'number', description: 'How many of the guests are vegan' },
          budget: { type: 'number', description: 'EUR excl. VAT' },
          neededBy: { ...date, description: 'Delivery date, usually the day before the event' },
        },
        required: ['meal', 'guests'],
      },
    },
    run: (a, actor) => {
      const b = planner.planBasket(
        {
          meal: (str(a.meal) ?? 'breakfast') as Meal,
          guests: num(a.guests) ?? 0,
          vegan: num(a.vegan),
          budget: num(a.budget),
          neededBy: str(a.neededBy),
        },
        actor,
      );
      return {
        result: {
          basketId: b.basketId,
          total: b.total,
          withinBudget: b.withinBudget,
          explanation: b.explanation,
          lines: b.lines.map(
            (l) =>
              `${l.role}: ${l.line.packs} × ${l.line.brand} ${l.line.packLabel}, €${l.line.lineTotal}${l.outsideRules ? ' (category needs approval)' : ''}`,
          ),
          quoteLines: b.lines.map((l) => ({ productId: l.line.productId, quantity: l.line.quantity })),
          leftOut: b.leftOut,
        },
        card: { type: 'basket', data: b },
      };
    },
  },
  {
    declaration: {
      name: 'order_basket',
      description:
        'Order a basket from plan_basket. Goes through the limits like any order. Only when the user asked to order it.',
      parametersJsonSchema: {
        type: 'object',
        properties: { basketId: { type: 'string' } },
        required: ['basketId'],
      },
    },
    run: (a, actor) => {
      const b = planner.getBasket(String(a.basketId));
      if (!b) throw new gateway.GatewayError('Unknown basketId; plan the basket again.');
      const quote = gateway.requestQuote(
        {
          lines: b.lines.map((l) => ({ productId: l.line.productId, quantity: l.line.quantity })),
          neededBy: b.neededBy,
          basketId: b.basketId,
          explanation: b.explanation,
          rationale: 'Basket ordered by the assistant',
        },
        actor,
      ).quote;
      return placed(gateway.placeOrder({ quoteId: quote.quoteId }, actor));
    },
  },
  {
    declaration: {
      name: 'check_stock',
      description:
        "The kitchen's stock: what runs out when, usage per day, incoming deliveries, and a waste-aware reorder suggestion per item. Shows a stock overview to the user.",
      parametersJsonSchema: { type: 'object', properties: {} },
    },
    run: () => {
      const r = fulfilment.replenishment();
      return {
        result: {
          items: r.items.map((i) => ({
            key: i.key,
            message: i.message,
            onHand: `${i.onHand} ${i.baseUnit}`,
            perDay: `${i.usagePerDay} ${i.baseUnit}`,
            suggestion: i.suggestion
              ? `${i.suggestion.line.packs} × ${i.suggestion.line.packLabel}, €${i.suggestion.line.lineTotal}, by ${i.suggestion.neededBy}`
              : undefined,
          })),
          suggestedTotal: r.suggestedTotal,
          autopilot: automations.autopilotActive() ? 'on (orders automatically)' : 'asks first',
        },
        card: { type: 'stock', data: r },
      };
    },
  },
  {
    declaration: {
      name: 'reorder_stock',
      description:
        'Order the suggested reorder from check_stock, for all due items or the given item keys. Only when the user asked to reorder.',
      parametersJsonSchema: {
        type: 'object',
        properties: { keys: { type: 'array', items: { type: 'string' } } },
      },
    },
    run: (a, actor) => {
      const keys = Array.isArray(a.keys) && a.keys.length ? a.keys.map(String) : undefined;
      const r = automations.orderStock(actor, keys, 'Restock asked in the assistant');
      automations.recordManualRun(
        'stock',
        `Reordered by the assistant (€${r.order.total})`,
        r.order.orderId,
        r.order.status,
      );
      return placed(r);
    },
  },
  {
    declaration: {
      name: 'list_events',
      description:
        'Upcoming big events (conferences, weddings…) with date, guests, estimated basket cost and whether they are ordered. Shows them to the user.',
      parametersJsonSchema: { type: 'object', properties: {} },
    },
    run: () => {
      const list = events.listEvents();
      return {
        result: list.map((e) => ({
          eventId: e.id,
          name: e.name,
          date: e.date,
          meal: e.meal,
          guests: e.guests,
          vegan: e.vegan,
          budget: e.budget,
          estimate: e.estimate.total,
          orderBy: e.orderBy,
          status: e.status,
        })),
        card: list.length ? { type: 'events', data: list } : undefined,
      };
    },
  },
  {
    declaration: {
      name: 'order_event',
      description:
        'Plan and order everything for an event from list_events (delivered the day before). Only when the user asked.',
      parametersJsonSchema: {
        type: 'object',
        properties: { eventId: { type: 'string' } },
        required: ['eventId'],
      },
    },
    run: (a, actor) => {
      const { order } = events.orderEvent(String(a.eventId), actor);
      automations.recordManualRun(
        'events',
        `Ordered by the assistant (€${order.order.total})`,
        order.order.orderId,
        order.order.status,
      );
      return placed(order);
    },
  },
  {
    declaration: {
      name: 'check_supplier_problems',
      description:
        "Orders where a supplier can't deliver an item, with replacement options (price and delivery difference). Shows them to the user.",
      parametersJsonSchema: { type: 'object', properties: {} },
    },
    run: () => {
      const r = fulfilment.openDisruptions();
      return {
        result: r.orders.map((o) => ({
          orderId: o.orderId,
          problem: o.summary,
          options: o.disruption.options.map((x) => ({
            optionId: x.optionId,
            product: `${x.line.brand} ${x.line.productName}`,
            total: x.line.lineTotal,
            note: x.note,
          })),
        })),
        card: r.orders.length ? { type: 'disruptions', data: r } : undefined,
      };
    },
  },
  {
    declaration: {
      name: 'use_replacement',
      description:
        'Order a replacement option for a supplier problem. Prefer the same product. Only when the user agreed.',
      parametersJsonSchema: {
        type: 'object',
        properties: { orderId: { type: 'string' }, optionId: { type: 'string' } },
        required: ['orderId', 'optionId'],
      },
    },
    run: (a, actor) =>
      placed(
        fulfilment.resolveDisruption(
          { orderId: String(a.orderId), optionId: String(a.optionId), rationale: 'Chosen by the assistant' },
          actor,
        ),
      ),
  },
  {
    declaration: {
      name: 'list_orders',
      description:
        'Recent orders with status (confirmed, pending_approval, rejected…), totals and any supplier problem or delivery result. Shows them to the user.',
      parametersJsonSchema: { type: 'object', properties: {} },
    },
    run: () => {
      const orders = gateway.listOrders().slice(0, 10);
      return {
        result: orders.map(orderSummary),
        card: orders.length ? { type: 'orders', data: orders } : undefined,
      };
    },
  },
  {
    declaration: {
      name: 'show_order',
      description:
        'One order in detail, shown to the user as a card (with Approve/Reject buttons if it waits for approval).',
      parametersJsonSchema: {
        type: 'object',
        properties: { orderId: { type: 'string' } },
        required: ['orderId'],
      },
    },
    run: (a) => {
      const r = gateway.getOrder(String(a.orderId));
      return { result: orderSummary(r.order), card: { type: 'order', data: r } };
    },
  },
  {
    declaration: {
      name: 'check_delivery',
      description:
        'Compare ordered, picked and received quantities for an order and draft a follow-up if something is missing. If the delivery is not recorded yet, pass what the user says was received.',
      parametersJsonSchema: {
        type: 'object',
        properties: {
          orderId: { type: 'string' },
          received: {
            type: 'array',
            items: {
              type: 'object',
              properties: { productId: { type: 'string' }, quantity: { type: 'number' } },
              required: ['productId', 'quantity'],
            },
          },
        },
        required: ['orderId'],
      },
    },
    run: (a, actor) => {
      const received = Array.isArray(a.received)
        ? (a.received as { productId?: unknown; quantity?: unknown }[]).flatMap((x) =>
            typeof x.productId === 'string' && num(x.quantity) !== undefined
              ? [{ productId: x.productId, quantity: num(x.quantity)! }]
              : [],
          )
        : [];
      const r = received.length
        ? fulfilment.recordDelivery(String(a.orderId), { received }, actor)
        : fulfilment.getReconciliation(String(a.orderId));
      return {
        result: {
          shortValue: r.delivery.shortValue,
          lines: r.delivery.lines,
          followUpDrafted: !!r.delivery.followUp,
        },
        card: { type: 'reconciliation', data: r },
      };
    },
  },
];

const byName = new Map(TOOLS.map((t) => [t.declaration.name!, t]));

function systemInstruction(): string {
  return [
    ...(supplierEnabled()
      ? [
          supplierMockEnabled()
            ? 'MOCK SUPPLIER MODE: The full source catalogue and original dairy/plant-drink demo products have prices and synthetic stock for the requested date. Results with source=mock are demo data, not live supplier data. Clearly call them mock prices and availability. Use search_products and request_quote for non-binding demo estimates; no real orders are submitted.'
            : 'SUPPLIER API MODE: search_products uses the official static challenge product download and on-demand customer-specific price/availability APIs. request_quote produces ONE combined non-binding estimate based on refreshed API data, not a supplier-issued fixed-price quote. No supplier order or reservation endpoint exists. Never say an order has been submitted, confirmed or reserved. Explain that checkout/order submission is not connected.',
          'In supplier mode request_quote line.quantity is the number of SALES UNITS, NOT litres/kg. Use salesUnit and product.amountPerSalesUnit to convert the customer need. For example 40 sales units of 10 L plus 600 sales units of 1 L supplies 1000 L. If the pack conversion is unknown, ask for clarification; never guess it or infer it from price. availableSalesUnits=null for Terminal goods means UNKNOWN stock, never unlimited or confirmed stock. Mention terminal availability uncertainty in the final answer.',
          'Ask for the delivery date before using dynamic APIs. Use a narrow product query (ingredient name, not a sentence). Do not look up the entire catalogue or repeatedly retrieve unchanged static files. Requirements marked unverified cannot be assumed satisfied; explain the missing evidence and ask the customer to review their Requirements. Do not invent dietary labels, certifications, shelf life, delivery reliability or footprint.',
        ]
      : []),
    `You are Aimo, the purchasing assistant of ${mandate.buyer} (a hotel kitchen in Helsinki), talking with ${mandate.approver}. You buy from Valio Aimo, a Finnish foodservice wholesaler. All data is synthetic (a demo).`,
    `Today is ${today()} (${formatDate(today())}). Resolve relative dates ("Monday", "tomorrow") to YYYY-MM-DD yourself.`,
    'Use the tools for every fact about products, prices, stock, events, orders and rules; never invent prices, products, dates or order numbers.',
    'Tool results are also shown to the user as cards (offers, baskets, stock, orders…), so do not repeat tables or long lists: answer in 1–3 short sentences, highlight the decision or the next step, and refer to the card.',
    'Ordering: when the user clearly asks to buy or order, prepare one combined quote and place_quote. When they only ask for options or a quote, search or plan and prepare the quote without placing it.',
    'The gateway enforces the spending limits and the sourcing requirements. Orders outside the limits wait for the user to approve; you cannot approve them, change limits or change requirements. Say so plainly and point to the Approve button, or to the Limits / Requirements pages.',
    "If a product breaks the requirements (e.g. Greek yoghurt when dairy must be Finnish), say you won't buy it and suggest an alternative.",
    'Write in the language the user writes in. Use € with the amount, no markdown tables.',
    ...(supplierEnabled()
      ? [
          'Supplier mode overrides all local-demo purchasing instructions: only search (mock data by default; live only with VALIO_DATA_MODE=live) and non-binding combined estimates are available. Never call local ordering/planning/stock tools. No confirmed supplier orders or signed supplier quotes can be created.',
        ]
      : []),
    'Keep exploratory searches internal. For purchasing requests, select products and call request_quote once with all selected lines so the user sees ONE combined total, not individual orders. Multiple compatible milk products can together supply 1000 L; do not quote 1000 L of each. Prefer complete combined offers over partial offers. Never combine different base units or unrelated products to meet one quantity.',
    'A request to calculate, price, quote, or "can we get" is not permission to purchase. Use request_quote, never order_offer or order_basket, for these requests. A quote is not an order. Only describe a signed quote as a quote after request_quote succeeds.',
    'Ask one concise clarification when recipe yield or the delivery date is missing. Do not silently assume portions per cake or convert approximate cup measures into precise weights without stating assumptions. Before substituting dairy with plant drinks, or adapting a recipe to vegan/gluten-free rules, explain the conflict and ask whether to adapt. Do not search unrelated alternatives repeatedly. Never claim a product is suitable merely because a broad search returned it.',
  ].join('\n');
}

/** One user turn: lets Gemini call tools until it answers, and collects the cards to show. */
/** What the loop needs from a model response (lets tests script the model). */
export interface ModelTurn {
  functionCalls?: { id?: string; name?: string; args?: Record<string, unknown> }[];
  text?: string;
  candidates?: { content?: Content }[];
}
export type Generate = (contents: Content[]) => Promise<ModelTurn>;

const gemini: Generate = (contents) =>
  ai().models.generateContent({
    model: GEMINI_MODEL,
    contents,
    config: {
      systemInstruction: systemInstruction(),
      tools: [
        {
          functionDeclarations: TOOLS.filter((t) =>
            supplierEnabled()
              ? ['get_rules', 'search_products', 'request_quote'].includes(t.declaration.name!)
              : !['order_offer', 'order_basket'].includes(t.declaration.name!),
          ).map((t) => t.declaration),
        },
      ],
      temperature: 0.3,
    },
  });

export async function geminiChat(
  message: string,
  history: { role: 'user' | 'assistant'; text: string }[],
  actor: string,
  generate: Generate = gemini,
  conversationId?: string,
): Promise<AssistantReply> {
  const remembered = conversationId ? conversations.get(conversationId) : undefined;
  const contents: Content[] = [
    ...(remembered ??
      history
        .slice(-16)
        .map((h) => ({
          role: h.role === 'user' ? 'user' : 'model',
          parts: [{ text: h.text.slice(0, 8000) }],
        }))),
    { role: 'user', parts: [{ text: message }] },
  ];
  const cards: AssistantCard[] = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    let response: ModelTurn;
    try {
      response = await generate(contents);
    } catch (err) {
      // Never replay a purchase through the offline router after a model failure.
      if (cards.length)
        return {
          text: 'I could not finish the explanation. Review the result below before continuing.',
          cards: dedupe(cards)
            .filter((c) => c.type === 'quote' || c.type === 'order')
            .slice(-1),
        };
      throw err;
    }

    const calls = response.functionCalls ?? [];
    if (!calls.length) {
      const finalCards = dedupe(cards);
      const purchase = finalCards.filter(
        (c) => c.type === 'quote' || c.type === 'order' || c.type === 'supplier-quote',
      );
      const text = response.text?.trim() || 'Done.';
      contents.push({ role: 'model', parts: [{ text }] });
      if (conversationId) {
        conversations.delete(conversationId);
        // Trim at a user text boundary so tool calls always keep their responses.
        const boundaries = contents.flatMap((c, i) =>
          c.role === 'user' && c.parts?.some((p) => p.text) ? [i] : [],
        );
        conversations.set(conversationId, contents.slice(boundaries.at(-8) ?? 0));
        if (conversations.size > 100) conversations.delete(conversations.keys().next().value!);
      }
      return {
        text,
        cards: purchase.length
          ? purchase
          : finalCards.length === 1
            ? finalCards
            : finalCards.filter((c) => c.type !== 'limits' && c.type !== 'events').slice(-1),
      };
    }

    // Keep the model's turn as returned (including thought signatures), then answer each call.
    const modelContent = response.candidates?.[0]?.content;
    if (modelContent) contents.push(modelContent);
    const parts: Part[] = [];
    for (const call of calls) {
      const tool = byName.get(call.name ?? '');
      let output: unknown;
      try {
        if (!tool) throw new gateway.GatewayError(`Unknown tool ${call.name}`);
        if (supplierEnabled() && !['get_rules', 'search_products', 'request_quote'].includes(call.name ?? ''))
          throw new SupplierError(
            'Supplier order submission is not available. Prepare a combined estimate instead.',
          );
        const { result, card } = await tool.run((call.args ?? {}) as Record<string, unknown>, actor);
        if (card) cards.push(card);
        output = { result };
      } catch (err) {
        if (!(err instanceof gateway.GatewayError) && !(err instanceof SupplierError)) throw err;
        output = { error: err.message };
      }
      parts.push({
        functionResponse: { id: call.id, name: call.name, response: output as Record<string, unknown> },
      });
    }
    contents.push({ role: 'user', parts });
  }
  const finalCards = dedupe(cards);
  const purchases = finalCards.filter(
    (c) => c.type === 'quote' || c.type === 'order' || c.type === 'supplier-quote',
  );
  return {
    text: 'I stopped after several steps. Review the result below, or clarify your request to continue.',
    cards: purchases.length ? purchases : finalCards.slice(-1),
  };
}

/** Keeps the latest card per subject, so a search repeated by the model shows once. */
function dedupe(cards: AssistantCard[]): AssistantCard[] {
  const key = (c: AssistantCard) =>
    c.type === 'order'
      ? `order-${c.data.order.orderId}`
      : c.type === 'offers'
        ? `offers-${c.data.query}-${c.data.quantity}`
        : c.type;
  const seen = new Map<string, AssistantCard>();
  for (const c of cards) {
    seen.delete(key(c));
    seen.set(key(c), c);
  }
  return [...seen.values()];
}

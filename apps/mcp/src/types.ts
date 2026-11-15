// Types shared between the MCP server and the widget (structuredContent payloads).

export type Dietary = 'lactose-free' | 'dairy-free' | 'gluten-free' | 'vegan';

export interface Product {
  image?: string;
  searchNames?: string[];
  id: string;
  name: string;
  brand: string;
  supplier: string;
  category: string;
  /** Products in the same group are interchangeable (same spec, different pack). */
  equivalenceGroup: string;
  /** What one orderable unit is, e.g. "1 L carton" */
  packLabel: string;
  /** Base-unit quantity per pack, e.g. 10 for a 10 L bag-in-box */
  packSize: number;
  baseUnit: 'L' | 'kg' | 'pcs';
  /** EUR per pack, excl. VAT, fixed list price */
  packPrice: number;
  dietary: Dietary[];
  allergens: string[];
  certificates: string[];
  /** Category-level carbon footprint range, kg CO2e per base unit (synthetic) */
  co2eRange: [number, number];
  /** Packs in stock at the distribution centre */
  stockPacks: number;
  /** Days from order to delivery for in-stock goods */
  leadTimeDays: number;
  /** Incoming supplier deliveries: available `inDays` from today */
  inbound: { inDays: number; packs: number }[];
  /** Share of deliveries on time over the last 90 days (synthetic) */
  onTimeRate: number;
  /** Country of origin */
  origin: string;
  /** Days the product keeps after delivery (unopened) */
  shelfLifeDays: number;
}

export interface Requirements {
  dietary?: Dietary[];
  certificates?: string[];
  excludeAllergens?: string[];
}

export interface Delivery {
  date: string; // YYYY-MM-DD
  quantity: number; // base units
}

export interface OfferLine {
  image?: string;
  productId: string;
  productName: string;
  brand: string;
  packLabel: string;
  packs: number;
  quantity: number; // base units
  baseUnit: string;
  packPrice: number;
  unitPrice: number; // EUR per base unit
  lineTotal: number;
  deliveries: Delivery[];
  certificates: string[];
  onTimeRate: number;
  co2eRange: [number, number];
  origin: string;
  shelfLifeDays: number;
}

/** Pack-size surplus versus expected usage and shelf life. */
export interface WasteEstimate {
  /** Delivered beyond what was asked for, because of pack sizes (base units) */
  surplus: number;
  /** Part of the surplus likely to expire before it is used */
  likelyWaste: number;
  wasteValue: number;
  /** Usage the estimate is based on, base units per day; undefined = no usage data */
  usagePerDay?: number;
  note: string;
}

export type OfferBadge = 'best-value' | 'premium' | 'partial' | 'alternative';

export interface Offer {
  offerId: string;
  rank: number;
  badge: OfferBadge;
  title: string;
  lines: OfferLine[];
  total: number;
  quantity: number;
  baseUnit: string;
  meetsQuantity: boolean;
  meetsDeadline: boolean;
  meetsRequirements: boolean;
  lastDeliveryDate: string;
  /** Plain-language reasons this offer was ranked where it is */
  reasons: string[];
  /** One sentence a reviewer can read: why this offer */
  explanation: string;
  waste: WasteEstimate;
}

export interface OffersResult {
  kind: 'offers';
  searchId: string;
  query: string;
  quantity?: number;
  neededBy?: string;
  requirements: Requirements;
  offers: Offer[];
  /** Products found but not turned into offers (e.g. not meeting requirements) */
  excluded: { productName: string; reason: string; promise?: boolean }[];
  buyer: string;
  /** The buyer's sourcing promise that every offer keeps */
  promise: string[];
  /** Heads-up when the request itself is more than normal use can consume before it expires */
  usageNote?: string;
}

export interface Signature {
  alg: 'EdDSA';
  kid: string;
  /** base64url Ed25519 signature over the canonical JSON of the quote without `signature` */
  value: string;
}

export interface Quote {
  quoteId: string;
  searchId?: string;
  offerId?: string;
  buyer: string;
  lines: OfferLine[];
  total: number;
  currency: 'EUR';
  neededBy?: string;
  requirements: Requirements;
  meetsDeadline: boolean;
  meetsRequirements: boolean;
  issuedAt: string;
  expiresAt: string;
  /** Why these products and packs, in one or two sentences */
  explanation?: string;
  basketId?: string;
  /** Signed attestation that every line keeps the buyer's sourcing promise */
  promise: PromiseAttestation;
  /** Set when this quote revises an order the approver asked to change */
  revisionOf?: string;
  /** Set when this quote replaces part of an order a supplier could not deliver */
  replacementFor?: { orderId: string; productId: string };
  signature?: Signature;
}

export interface PromiseAttestation {
  version: number;
  /** sha256 of the promise rules at quote time */
  fingerprint: string;
  rules: string[];
  kept: true;
}

export interface QuoteResult {
  kind: 'quote';
  quote: Quote;
  verifyUrl: string;
}

export interface RuleCheck {
  rule: string;
  passed: boolean;
  detail: string;
}

export type OrderStatus = 'confirmed' | 'pending_approval' | 'rejected' | 'changes_requested' | 'revised';

/** "Approve with changes": what the approver asked for instead. */
export interface RequestedChanges {
  /** New quantities per product (base units); products left out keep their quantity, 0 removes a line */
  lines?: { productId: string; quantity: number }[];
  /** Approve automatically if the revised total stays at or below this */
  maxTotal?: number;
  comment?: string;
  by: string;
  at: string;
}

export interface ReplacementOption {
  optionId: string;
  kind: 'same-product' | 'substitute';
  line: OfferLine;
  /** Compared with the undelivered part of the original line */
  priceDiff: number;
  /** Days later than the original delivery (negative = earlier) */
  daysLater: number;
  meetsRequirements: boolean;
  /** Whether placing it would need the approver under the current rules */
  needsApproval: boolean;
  note: string;
}

export interface Disruption {
  productId: string;
  productName: string;
  supplier: string;
  baseUnit: string;
  /** Base units the supplier cannot deliver */
  shortQuantity: number;
  /** Value of the undelivered part, credited back */
  creditValue: number;
  originalDate: string;
  reason: string;
  at: string;
  status: 'open' | 'resolved' | 'dismissed';
  options: ReplacementOption[];
  resolvedWith?: string;
  replacementOrderId?: string;
}

export interface DeliveryLine {
  productId: string;
  productName: string;
  packLabel: string;
  baseUnit: string;
  unitPrice: number;
  ordered: number;
  picked: number;
  received: number;
  issue?: string;
}

export interface DeliveryRecord {
  recordedAt: string;
  recordedBy: string;
  lines: DeliveryLine[];
  /** Value of what was ordered but not received */
  shortValue: number;
  followUp?: { subject: string; body: string; sentAt?: string };
}

export interface Order {
  orderId: string;
  quoteId: string;
  buyer: string;
  status: OrderStatus;
  total: number;
  lines: OfferLine[];
  checks: RuleCheck[];
  approver?: string;
  decidedBy?: string;
  decisionComment?: string;
  createdAt: string;
  decidedAt?: string;
  agentRationale?: string;
  /** Audit actor who placed it: the agent, or the buyer via the widget */
  placedBy: string;
  neededBy?: string;
  explanation?: string;
  promise: PromiseAttestation;
  requestedChanges?: RequestedChanges;
  /** The order this one revises (approve with changes) */
  revisionOf?: string;
  /** The order that replaced this one after the approver asked for changes */
  revisedAs?: string;
  replacementFor?: { orderId: string; productId: string };
  disruption?: Disruption;
  delivery?: DeliveryRecord;
}

export interface OrderResult {
  kind: 'order';
  order: Order;
  approvalUrl?: string;
}

export interface AuditEvent {
  seq: number;
  at: string;
  actor: string;
  action: string;
  summary: string;
  reason?: string;
  refs: { searchId?: string; quoteId?: string; orderId?: string };
  /** sha256(prevHash + canonical event) — tamper-evident chain */
  hash: string;
  prevHash: string;
}

export interface AuditResult {
  kind: 'audit';
  orderId: string;
  events: AuditEvent[];
  chainValid: boolean;
}

export interface AssortmentItem {
  image?: string;
  id: string;
  name: string;
  brand: string;
  packLabel: string;
  packPrice: number;
  unitPrice: number;
  baseUnit: string;
  /** Quantity (base units) deliverable with the shortest lead time */
  inStock: number;
  firstDelivery: string;
  dietary: string[];
  certificates: string[];
  /** Whether the buyer's mandate allows this category without approval */
  withinMandate: boolean;
  origin: string;
  /** Set when the product breaks the buyer's sourcing promise (it can't be ordered) */
  breaksPromise?: string;
}

export interface AssortmentResult {
  kind: 'assortment';
  categories: { name: string; items: AssortmentItem[] }[];
  buyer: string;
}

// --- menu → basket --------------------------------------------------------------

export type Meal = 'breakfast' | 'brunch' | 'coffee-break';

export interface BasketLine {
  /** What it is for, e.g. "Milk for coffee and cereal" */
  role: string;
  forWhom: string;
  /** Calculated need in base units */
  need: number;
  line: OfferLine;
  waste: WasteEstimate;
  why: string;
  /** Category not allowed by the rules: ordering needs approval */
  outsideRules: boolean;
  arrivesInTime: boolean;
}

export interface BasketResult {
  kind: 'basket';
  basketId: string;
  meal: Meal;
  guests: number;
  vegan: number;
  budget?: number;
  neededBy?: string;
  lines: BasketLine[];
  total: number;
  withinBudget: boolean;
  leftOut: { role: string; reason: string }[];
  explanation: string;
  promise: string[];
  buyer: string;
}

// --- kitchen stock & replenishment --------------------------------------------------

export interface StockSuggestion {
  line: OfferLine;
  neededBy: string;
  /** Days of use the reorder covers */
  coversDays: number;
  why: string;
}

export interface StockItem {
  key: string;
  name: string;
  baseUnit: string;
  onHand: number;
  usagePerDay: number;
  /** Usage over the last 14 days, oldest first (simulated) */
  history: number[];
  incoming: { date: string; quantity: number; orderId: string }[];
  /** First day the projected stock does not cover that day's use */
  runOutDate?: string;
  daysLeft: number;
  status: 'ok' | 'reorder' | 'urgent';
  message: string;
  suggestion?: StockSuggestion;
}

export interface ReplenishmentResult {
  kind: 'replenishment';
  asOf: string;
  items: StockItem[];
  suggestedTotal: number;
  buyer: string;
}

export interface DisruptionsResult {
  kind: 'disruptions';
  orders: { orderId: string; summary: string; disruption: Disruption }[];
}

export interface ReconciliationResult {
  kind: 'reconciliation';
  orderId: string;
  delivery: DeliveryRecord;
}

export type WidgetPayload =
  | OffersResult
  | QuoteResult
  | OrderResult
  | AuditResult
  | AssortmentResult
  | BasketResult
  | ReplenishmentResult
  | DisruptionsResult
  | ReconciliationResult;

// --- Aimo Assistant (consumer chat), events, automations ---------------------------------

export interface KitchenEvent {
  id: string;
  name: string;
  /** The day of the event, YYYY-MM-DD */
  date: string;
  meal: Meal;
  guests: number;
  vegan: number;
  budget?: number;
  notes?: string;
  status: 'planned' | 'ordered';
  orderId?: string;
  createdAt: string;
}

export interface EventView extends KitchenEvent {
  /** Order by this day so everything arrives the day before */
  orderBy: string;
  daysUntil: number;
  estimate: { total: number; items: number; withinBudget: boolean; needsApproval: boolean };
  orderStatus?: string;
}

export interface AutomationSettings {
  stock: {
    enabled: boolean;
    /** ask = suggest and wait for one click; auto = order on its own (within the limits) */
    mode: 'ask' | 'auto';
    /** Kitchen items the autopilot looks after */
    items: Record<string, boolean>;
  };
  events: {
    enabled: boolean;
    /** Remind this many days before the event */
    remindDaysBefore: number;
    /** Order the event basket on its own when the reminder is due */
    autoOrder: boolean;
  };
}

export interface AutomationRun {
  at: string;
  automation: 'stock' | 'events';
  summary: string;
  orderId?: string;
  status?: string;
}

export type AssistantCard =
  | { type: 'supplier-products'; data: import('./supplier-types').SupplierSearch }
  | { type: 'supplier-quote'; data: import('./supplier-types').SupplierQuote }
  | { type: 'quote'; data: QuoteResult }
  | { type: 'offers'; data: OffersResult }
  | { type: 'order'; data: OrderResult }
  | { type: 'basket'; data: BasketResult }
  | { type: 'stock'; data: ReplenishmentResult }
  | { type: 'disruptions'; data: DisruptionsResult }
  | { type: 'reconciliation'; data: ReconciliationResult }
  | { type: 'events'; data: EventView[] }
  | { type: 'orders'; data: Order[] }
  | { type: 'limits'; data: { perOrder: number; perWeek: number; spent: number; categories: string[] } }
  | { type: 'requirements'; data: { rules: string[]; statement: string } };

export interface AssistantReply {
  text: string;
  /** Which engine answered: the Gemini model, or the built-in rule-based mock */
  engine?: 'gemini' | 'rules';
  cards: AssistantCard[];
  /** Follow-up prompts shown as chips */
  suggestions?: string[];
}

export type AssistantAction =
  | { type: 'quote-offer'; searchId: string; offerId: string }
  | { type: 'quote-basket'; basketId: string }
  | { type: 'place-quote'; quoteId: string }
  | { type: 'order-offer'; searchId: string; offerId: string }
  | { type: 'order-basket'; basketId: string }
  | { type: 'order-stock'; keys?: string[] }
  | { type: 'order-event'; eventId: string }
  | { type: 'resolve-disruption'; orderId: string; optionId: string }
  | { type: 'decide'; orderId: string; approve: boolean }
  | { type: 'send-follow-up'; orderId: string };

export interface AttentionItem {
  id: string;
  kind: 'approval' | 'disruption' | 'late' | 'delivery' | 'stock' | 'event';
  tone: 'urgent' | 'warning' | 'info';
  title: string;
  detail: string;
  /** When it matters, YYYY-MM-DD */
  date?: string;
  action?: { label: string; action: AssistantAction };
  /** Prompt to continue in the chat */
  ask?: string;
}

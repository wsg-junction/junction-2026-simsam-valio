import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { DATA_DIR, PUBLIC_URL } from './config';
import sourceProducts from './catalog-data.json' with { type: 'json' };
import { normalizeProductQuery } from './product-search';
import { catalog as demoCatalog } from './catalog';
import { sourcing } from './sourcing';
import { round2, shortId } from './util';

export class SupplierError extends Error {}
const money = z.object({
  value: z.number().nonnegative(),
  currency: z.string(),
  validFrom: z.string(),
  validTo: z.string(),
});
const pricesSchema = z.object({
  currency: z.string(),
  pricingDate: z.string(),
  products: z.array(
    z.object({
      productId: z.string(),
      quantity: z.number().positive(),
      error: z.boolean(),
      catalogPrice: money.nullish(),
      comparisonPrice: money.nullish(),
      comparisonUnit: z.string().nullish(),
    }),
  ),
});
const availabilitySchema = z.object({
  timeNow: z.string(),
  requestedDate: z.string(),
  products: z.array(
    z.object({
      productId: z.string(),
      salesBlock: z.boolean(),
      closingTime: z.string().nullish(),
      logisticModel: z.string().nullish(),
      scheduleLines: z.array(
        z.object({
          salesBlock: z.boolean(),
          availableAmount: z.number().nonnegative(),
          availableDate: z.string().nullish(),
          salesUnit: z.string(),
        }),
      ),
    }),
  ),
});

import type { SupplierProduct, SupplierOffer, SupplierSearch, SupplierQuote } from './supplier-types';

type Raw = Record<string, unknown>;
const strings = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.flatMap((x) =>
        typeof x === 'string'
          ? [x]
          : x && typeof x === 'object' && typeof (x as Raw).name === 'string'
            ? [(x as Raw).name as string]
            : [],
      )
    : [];
export function parseCatalog(data: unknown): SupplierProduct[] {
  const rows = Array.isArray(data)
    ? data
    : data && typeof data === 'object'
      ? (data as Raw).products
      : undefined;
  if (!Array.isArray(rows))
    throw new SupplierError(
      'Product download must contain a products array. Check the challenge dataset format.',
    );
  const products = rows.flatMap((r): SupplierProduct[] => {
    if (!r || typeof r !== 'object') return [];
    const p = r as Raw;
    const id = p.code ?? p.productId;
    const name =
      typeof p.name === 'string'
        ? p.name
        : Array.isArray(p.names)
          ? (p.names as Raw[]).find((n) => n.language === 'en')?.value
          : undefined;
    if (typeof id !== 'string' || typeof name !== 'string') return [];
    // Only explicit pack dimensions; never derive units from stale price ratios.
    const pack = name.match(/\b(?:(\d+)\s*[x×]\s*)?(\d+(?:[.,]\d+)?)\s*(ml|cl|dl|l|kg|g)\b/i);
    const size = pack
      ? Number(pack[2].replace(',', '.')) *
        Number(pack[1] ?? 1) *
        ({ ml: 0.001, cl: 0.01, dl: 0.1, l: 1, kg: 1, g: 0.001 }[pack[3].toLowerCase()] ?? 1)
      : undefined;
    const unit = p.unit && typeof p.unit === 'object' ? (p.unit as Raw).code : undefined;
    const origins = Array.isArray(p.countriesOfOrigin) ? (p.countriesOfOrigin as Raw[]) : [];
    return [
      {
        productId: id,
        name,
        image: (() => {
          const image = sourceProducts.find((s) => s.id === id)?.image;
          return image ? PUBLIC_URL + '/assistant' + image : undefined;
        })(),
        categories: strings(p.categories),
        description: typeof p.description === 'string' ? p.description.replace(/<[^>]*>/g, ' ') : '',
        origin:
          typeof p.origin === 'string'
            ? p.origin
            : origins.length === 1 && typeof origins[0].name === 'string'
              ? origins[0].name
              : undefined,
        dietary: strings(p.dietary),
        certificates: strings(p.certificates),
        allergens: Array.isArray(p.allergens) ? strings(p.allergens) : undefined,
        salesUnit: typeof unit === 'string' ? unit : undefined,
        amountPerSalesUnit:
          size && pack && !/\b(?:KG|L)\b/i.test(String(unit))
            ? { quantity: size, unit: /g$/i.test(pack[3]) ? 'kg' : 'L' }
            : unit === 'L' || unit === 'KG'
              ? { quantity: 1, unit: unit === 'L' ? 'L' : 'kg' }
              : undefined,
      },
    ];
  });
  if (!products.length) throw new SupplierError('No product codes/names found in the challenge dataset.');
  return products;
}

function requirementsIssues(p: SupplierProduct): string[] {
  const categoryText = p.categories.join(' ').toLowerCase();
  const group = /plant/.test(categoryText)
    ? 'Plant-based'
    : /dairy|milk|cream|cheese|yog[hu]urt|butter/.test(categoryText)
      ? 'Dairy'
      : /egg/.test(categoryText)
        ? 'Eggs'
        : /coffee|\btea\b/.test(categoryText)
          ? 'Coffee & Tea'
          : /flour|sugar|oil|spice|fruit|vegetable|baking|bakery|meat|fish|seafood|cereal|grain/.test(
                categoryText,
              )
            ? 'Other'
            : undefined;
  return sourcing.rules.flatMap((r) => {
    if (r.categories.length && group && !r.categories.includes(group)) return [];
    if (r.categories.length && !group) return [`Cannot verify category for ${r.kind} requirement`];
    const known =
      r.kind === 'finnish-origin'
        ? p.origin === 'Finland'
        : r.kind === 'eu-origin'
          ? !!p.origin &&
            [
              'Finland',
              'Sweden',
              'Denmark',
              'Germany',
              'France',
              'Netherlands',
              'Estonia',
              'Latvia',
              'Lithuania',
              'Poland',
              'Belgium',
              'Austria',
              'Italy',
              'Spain',
              'Portugal',
              'Ireland',
              'Greece',
              'Cyprus',
              'Malta',
              'Croatia',
              'Slovenia',
              'Slovakia',
              'Czechia',
              'Hungary',
              'Romania',
              'Bulgaria',
              'Luxembourg',
            ].includes(p.origin)
          : r.kind === 'no-allergen'
            ? !!p.allergens && !p.allergens.some((a) => a.toLowerCase() === r.allergen?.toLowerCase())
            : r.kind === 'organic'
              ? p.certificates.includes('EU Organic')
              : r.kind === 'free-range'
                ? p.certificates.includes('Free range')
                : r.kind === 'fairtrade'
                  ? p.certificates.includes('Fairtrade')
                  : p.dietary.includes(r.kind);
    return known
      ? []
      : [`Cannot verify ${r.kind}${r.allergen ? ` (${r.allergen})` : ''} from supplier metadata`];
  });
}

export class SupplierClient {
  private catalog?: Promise<SupplierProduct[]>;
  private narrowed = new Set<string>();
  constructor(
    private options: {
      key: string;
      baseUrl: string;
      customer: string;
      file: string;
      fetch?: typeof fetch;
      products?: SupplierProduct[];
      mockProducts?: SupplierProduct[];
      mock?: () => boolean;
    },
  ) {}
  private async request(path: string, body?: unknown): Promise<Response> {
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(new URL(path, this.options.baseUrl), {
        method: body ? 'POST' : 'GET',
        headers: { 'X-API-Key': this.options.key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000),
        redirect: 'manual',
      });
    } catch {
      throw new SupplierError('Valio Aimo API could not be reached. No demo prices were substituted.');
    }
    if (response.status >= 300 && response.status < 400 && !body) {
      const target = new URL(response.headers.get('location') ?? '', this.options.baseUrl);
      if (target.protocol !== 'https:') throw new SupplierError('Product download must use HTTPS');
      // Download redirects may point at signed object storage: do not forward the API key.
      response = await (this.options.fetch ?? fetch)(target, {
        signal: AbortSignal.timeout(30000),
        redirect: 'error',
      });
    }
    if (!response.ok)
      throw new SupplierError(
        `Valio Aimo API returned HTTP ${response.status}${response.status === 429 ? '; wait before retrying' : ''}.`,
      );
    return response;
  }
  async products(): Promise<SupplierProduct[]> {
    if (this.options.products)
      return this.options.mock?.()
        ? [...this.options.products, ...(this.options.mockProducts ?? [])]
        : this.options.products;
    if (!this.catalog)
      this.catalog = (async () => {
        if (existsSync(this.options.file))
          return parseCatalog(JSON.parse(readFileSync(this.options.file, 'utf8')));
        const raw: unknown = await (await this.request('/api/products/download')).json();
        const products = parseCatalog(raw);
        mkdirSync(dirname(this.options.file), { recursive: true });
        writeFileSync(this.options.file, JSON.stringify(raw));
        return products;
      })().catch((e) => {
        this.catalog = undefined;
        throw e;
      });
    return this.catalog;
  }
  async check(ids: string[], requestedDate: string): Promise<SupplierOffer[]> {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ||
      !Number.isFinite(Date.parse(requestedDate)) ||
      new Date(requestedDate).toISOString().slice(0, 10) !== requestedDate
    )
      throw new SupplierError('Provide a valid delivery date as YYYY-MM-DD');
    if (!ids.length || ids.length > 24 || new Set(ids).size !== ids.length)
      throw new SupplierError('Check 1–24 distinct shortlisted products at a time.');
    const catalog = await this.products();
    if (ids.some((id) => !this.narrowed.has(id)))
      throw new SupplierError('Search the static assortment before checking product codes.');
    if (this.options.mock?.()) {
      return ids.map((id) => {
        const product = catalog.find((p) => p.productId === id);
        const source = sourceProducts.find((p) => p.id === id);
        const fixture = demoCatalog.find((p) => p.id === id && p.id.startsWith('AIMO-'));
        if (!product || (!source && !fixture)) throw new SupplierError('Unknown mock product code: ' + id);
        // Reproducible demo stock, priced from the supplied dataset; no network request.
        const seed = [...id].reduce((sum, c) => sum * 31 + c.charCodeAt(0), 0) >>> 0;
        const issues = requirementsIssues(product);
        return {
          product,
          unitPrice: source?.price ?? fixture!.packPrice,
          salesUnit: source?.unit || product.salesUnit || 'pcs',
          availableSalesUnits: fixture?.stockPacks ?? 250 + (seed % 751),
          terminal: false,
          availableDate: requestedDate,
          validFrom: requestedDate + 'T00:00:00Z',
          validTo: requestedDate + 'T23:59:59Z',
          blocked: issues.length > 0,
          issues,
        };
      });
    }
    const body = { customer: this.options.customer, requestedDate, products: ids };
    const [priceRaw, availabilityRaw] = await Promise.all([
      this.request('/api/price', body).then((r) => r.json()),
      this.request('/api/availability', body).then((r) => r.json()),
    ]);
    const prices = pricesSchema.safeParse(priceRaw),
      availability = availabilitySchema.safeParse(availabilityRaw);
    if (!prices.success || !availability.success)
      throw new SupplierError('Supplier response did not match the documented price/availability format.');
    if (
      prices.data.currency !== 'EUR' ||
      prices.data.pricingDate.slice(0, 10) !== requestedDate ||
      availability.data.requestedDate.slice(0, 10) !== requestedDate
    )
      throw new SupplierError('Supplier returned a different currency or requested date.');
    return ids.map((id) => {
      const product = catalog.find((p) => p.productId === id)!;
      const price = prices.data.products.find((p) => p.productId === id);
      const stock = availability.data.products.find((p) => p.productId === id);
      const schedule = stock?.scheduleLines[0];
      const terminal = /terminal/i.test(stock?.logisticModel ?? '') || schedule?.availableAmount === 999999;
      const issues = requirementsIssues(product);
      const value = price?.catalogPrice;
      if (!value || price?.error || value.currency !== 'EUR') issues.push('No valid price available');
      if (
        value &&
        !(value.validFrom.slice(0, 10) <= requestedDate && value.validTo.slice(0, 10) >= requestedDate)
      )
        issues.push('Price is not valid for requested date');
      if (
        !stock ||
        stock.salesBlock ||
        !schedule ||
        schedule.salesBlock ||
        !schedule.availableDate ||
        schedule.availableAmount === 0
      )
        issues.push('Not orderable');
      if (product.salesUnit && schedule?.salesUnit && product.salesUnit !== schedule.salesUnit)
        issues.push('Supplier sales unit differs from static pack metadata');
      return {
        product,
        unitPrice:
          value &&
          !price?.error &&
          value.currency === 'EUR' &&
          value.validFrom.slice(0, 10) <= requestedDate &&
          value.validTo.slice(0, 10) >= requestedDate
            ? value.value / (price?.quantity ?? 1)
            : undefined,
        salesUnit: schedule?.salesUnit,
        availableSalesUnits: terminal ? null : (schedule?.availableAmount ?? 0),
        terminal,
        availableDate: schedule?.availableDate?.slice(0, 10),
        closingTime: stock?.closingTime ?? undefined,
        validFrom: value?.validFrom,
        validTo: value?.validTo,
        blocked: issues.length > 0,
        issues,
      };
    });
  }
  async search(query: string, requestedDate: string): Promise<SupplierSearch> {
    const tokens = normalizeProductQuery(query)
      .replace(/vegetable oil/g, 'oil')
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean);
    if (!tokens.length) throw new SupplierError('Name an ingredient or product to search.');
    const matches = (await this.products())
      .filter((p) => {
        if (tokens.length === 1 && tokens[0] === 'milk' && /milk[- ]fed|\bveal\b/i.test(p.name)) return false;
        const text = normalizeProductQuery(
          `${p.name} ${(p.searchNames ?? []).join(' ')} ${p.categories.join(' ')}`,
        );
        return tokens.every((t) => text.includes(t));
      })
      .sort(
        (a, b) =>
          Number(b.name.toLowerCase().includes(normalizeProductQuery(query))) -
          Number(a.name.toLowerCase().includes(normalizeProductQuery(query))),
      )
      .slice(0, 24);
    matches.forEach((p) => this.narrowed.add(p.productId));
    return {
      source: this.options.mock?.() ? 'mock' : 'valio-api',
      query,
      requestedDate,
      checkedAt: new Date().toISOString(),
      offers: matches.length
        ? await this.check(
            matches.map((p) => p.productId),
            requestedDate,
          )
        : [],
    };
  }
  async quote(
    lines: { productId: string; quantity: number }[],
    requestedDate: string,
  ): Promise<SupplierQuote> {
    const merged = new Map<string, number>();
    for (const l of lines) {
      if (!l || typeof l.productId !== 'string' || !Number.isFinite(l.quantity) || l.quantity <= 0)
        throw new SupplierError('Quote quantities must be positive numbers of sales units.');
      merged.set(l.productId, (merged.get(l.productId) ?? 0) + l.quantity);
    }
    const offers = await this.check([...merged.keys()], requestedDate);
    const quoted = offers.map((o) => {
      const salesUnits = merged.get(o.product.productId)!;
      if (
        o.blocked ||
        !o.salesUnit ||
        o.unitPrice === undefined ||
        !o.availableDate ||
        !o.validFrom ||
        !o.validTo
      )
        throw new SupplierError(`${o.product.name}: ${o.issues.join('; ') || 'Incomplete supplier data'}`);
      if (o.availableDate > requestedDate)
        throw new SupplierError(
          `${o.product.name} is only available on ${o.availableDate}. Ask the customer before changing delivery date.`,
        );
      if (!o.terminal && salesUnits > (o.availableSalesUnits ?? 0))
        throw new SupplierError(
          `${o.product.name}: only ${o.availableSalesUnits} ${o.salesUnit} available. Combine products or ask about a partial quote.`,
        );
      const cutoff = o.closingTime && Date.parse(o.closingTime);
      if (cutoff && cutoff <= Date.now())
        throw new SupplierError(`${o.product.name}: order cutoff has passed. Check a later delivery date.`);
      return {
        productId: o.product.productId,
        name: o.product.name,
        image: o.product.image,
        salesUnits,
        salesUnit: o.salesUnit,
        quantity: o.product.amountPerSalesUnit
          ? round2(salesUnits * o.product.amountPerSalesUnit.quantity)
          : undefined,
        baseUnit: o.product.amountPerSalesUnit?.unit,
        unitPrice: o.unitPrice,
        total: round2(o.unitPrice * salesUnits),
        availableDate: o.availableDate,
        terminal: o.terminal,
        closingTime: o.closingTime,
        validFrom: o.validFrom,
        validTo: o.validTo,
      };
    });
    return {
      source: this.options.mock?.() ? 'mock' : 'valio-api',
      quoteId: shortId('VQ'),
      customer: this.options.customer,
      requestedDate,
      checkedAt: new Date().toISOString(),
      currency: 'EUR',
      total: round2(quoted.reduce((s, l) => s + l.total, 0)),
      lines: quoted,
      binding: false,
    };
  }
}

/** Explicit live opt-in; demo mode supplies complete local prices and stock. */
export const supplierMockEnabled = () => process.env.VALIO_DATA_MODE !== 'live';
export const supplierEnabled = () => !!process.env.VALIO_API_KEY;
export const supplier = new SupplierClient({
  mock: supplierMockEnabled,
  mockProducts: demoCatalog
    .filter((p) => p.id.startsWith('AIMO-'))
    .map((p) => ({
      productId: p.id,
      name: p.name,
      categories: p.category.split(' / '),
      description: 'Synthetic demo product',
      origin: p.origin,
      dietary: p.dietary,
      certificates: p.certificates,
      allergens: p.allergens,
      image: p.image,
      salesUnit: 'pack',
      amountPerSalesUnit:
        p.baseUnit === 'L' || p.baseUnit === 'kg' ? { quantity: p.packSize, unit: p.baseUnit } : undefined,
    })),
  key: process.env.VALIO_API_KEY ?? '',
  baseUrl: process.env.VALIO_API_URL ?? 'https://junction26.valioaimo.fi',
  customer: process.env.VALIO_CUSTOMER_ID ?? '123',
  file: resolve(DATA_DIR, 'supplier-products.json'),
  products: parseCatalog(
    sourceProducts.map((p) => ({
      code: p.id,
      name: p.name,
      categories: p.category.split(' / '),
      origin: p.origin,
      unit: { code: p.unit === 'kg' ? 'KG' : p.unit === 'l' ? 'L' : 'ST' },
    })),
  ).map((p) => ({ ...p, searchNames: sourceProducts.find((s) => s.id === p.productId)?.names })),
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SupplierClient, parseCatalog, supplier } from './supplier';
import { geminiChat, type Generate } from './llm';
import { addDays, today } from './util';

test('supplier static shortlist, live combined total, units, redirects and failures', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'aimo-supplier-'));
  const requestedDate = addDays(today(), 2);
  const rows = [
    { code: '460013', name: 'Milk 10L', categories: [{ name: 'Dairy / Milk' }], countriesOfOrigin: [{ name: 'Finland' }], unit: { code: 'BOX' } },
    { code: '460063', name: 'Milk 1L', categories: [{ name: 'Dairy / Milk' }], countriesOfOrigin: [{ name: 'Finland' }], unit: { code: 'ST' } },
    { code: '463989', name: 'Supplier oil 1L', categories: [{ name: 'Oils' }], unit: { code: 'ST' } },
  ];
  const calls: { path: string; ids?: string[] }[] = [];
  let fail = false;
  let blocked = false;
  let noPrice = false;
  const mockFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    if (url.host === 'download.example') {
      assert.equal(headers.get('X-API-Key'), null, 'never leak API key across download redirect');
      return Response.json({ products: rows });
    }
    assert.equal(headers.get('X-API-Key'), 'test-key');
    if (url.pathname.endsWith('/download')) {
      calls.push({ path: url.pathname });
      return new Response(null, { status: 302, headers: { location: 'https://download.example/products.json' } });
    }
    const body = JSON.parse(String(init?.body)) as { products: string[]; customer: string; requestedDate: string };
    assert.equal(body.customer, 'hotel-test');
    assert.equal(body.requestedDate, requestedDate);
    calls.push({ path: url.pathname, ids: body.products });
    if (fail) return new Response(null, { status: 429 });
    if (url.pathname === '/api/price') return Response.json({ currency: 'EUR', pricingDate: requestedDate, products: body.products.map((id) => ({
      productId: id, quantity: 1, netPriceFound: true, error: noPrice,
      catalogPrice: { value: id === '460013' ? 13.1 : 1.42, valueWithTax: 0, currency: 'EUR', validFrom: '2020-01-01', validTo: '2099-12-31' },
    })) });
    return Response.json({ timeNow: new Date().toISOString(), requestedDate, products: body.products.map((id) => ({
      productId: id, salesBlock: blocked, closingTime: null, logisticModel: id === '463989' ? 'Terminal' : 'Stock',
      scheduleLines: [{ salesBlock: false, availableAmount: id === '460013' ? 40 : id === '463989' ? 999999 : 600, availableDate: requestedDate, salesUnit: id === '460013' ? 'BOX' : 'ST' }],
    })) });
  };
  const client = new SupplierClient({ key: 'test-key', baseUrl: 'https://supplier.example', customer: 'hotel-test', file: join(directory, 'products.json'), fetch: mockFetch });
  try {
    const search = await client.search('milk', requestedDate);
    assert.equal(search.offers.length, 2);
    assert.deepEqual(calls.find((c) => c.path === '/api/price')?.ids, ['460013', '460063'], 'query only static shortlist, never the whole catalogue');
    assert.equal(search.offers[0].product.amountPerSalesUnit?.quantity, 10);
    const quote = await client.quote([{ productId: '460013', quantity: 40 }, { productId: '460063', quantity: 500 }, { productId: '460063', quantity: 100 }], requestedDate);
    assert.equal(quote.total, 1376);
    assert.equal(quote.lines.length, 2);
    assert.equal(quote.lines.reduce((s, l) => s + l.quantity!, 0), 1000);
    assert.equal(quote.binding, false);
    assert.equal(calls.filter((c) => c.path.endsWith('/download')).length, 1);
    assert.equal(calls.filter((c) => c.path === '/api/price').length, 2, 'refresh prices when making estimate');
    await assert.rejects(client.quote([{ productId: '460013', quantity: 41 }], requestedDate), /only 40/);
    await assert.rejects(client.quote([{ productId: 'invented-code', quantity: 1 }], requestedDate), /Search the static/);
    await assert.rejects(client.quote([{ productId: '460013', quantity: -1 }], requestedDate), /positive/);
    const terminal = await client.search('oil', requestedDate);
    assert.equal(terminal.offers[0].availableSalesUnits, null);
    assert.equal(terminal.offers[0].terminal, true);
    blocked = true;
    await assert.rejects(client.quote([{ productId: '460013', quantity: 1 }], requestedDate), /Not orderable/);
    blocked = false;
    noPrice = true;
    await assert.rejects(client.quote([{ productId: '460013', quantity: 1 }], requestedDate), /No valid price/);
    noPrice = false;
    await assert.rejects(client.search('milk', '2026-02-30'), /valid delivery date/);
    const key = process.env.VALIO_API_KEY;
    const originalSearch = supplier.search, originalQuote = supplier.quote;
    process.env.VALIO_API_KEY = 'test-mode';
    supplier.search = client.search.bind(client);
    supplier.quote = client.quote.bind(client);
    try {
      let step = 0;
      const generate: Generate = async () => {
        if (step++ === 0) return { functionCalls: [{ name: 'search_products', args: { query: 'milk', quantity: 1000, neededBy: requestedDate } }] };
        if (step === 2) return { functionCalls: [{ name: 'request_quote', args: { lines: [{ productId: '460013', quantity: 40 }, { productId: '460063', quantity: 600 }], neededBy: requestedDate } }] };
        return { text: 'One combined live estimate, nothing ordered.' };
      };
      const reply = await geminiChat('Quote 1000 L milk', [], 'test', generate);
      assert.deepEqual(reply.cards.map((c) => c.type), ['supplier-quote'], 'chat uses API adapter and hides searches');
      if (reply.cards[0].type === 'supplier-quote') assert.equal(reply.cards[0].data.total, 1376);
    } finally {
      supplier.search = originalSearch;
      supplier.quote = originalQuote;
      if (key) process.env.VALIO_API_KEY = key; else delete process.env.VALIO_API_KEY;
    }
    fail = true;
    await assert.rejects(client.quote([{ productId: '460013', quantity: 1 }], requestedDate), /429/);
    assert.throws(() => parseCatalog({ unrelated: [] }), /products array/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

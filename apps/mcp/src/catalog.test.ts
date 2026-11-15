import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { catalog } from './catalog';
import { search, browseAssortment } from './gateway';
import { sourcing } from './sourcing';

test('supplier mock mode quotes 1000 L Finnish milk and preserves plant drinks', async () => {
  const { supplier } = await import('./supplier');
  const previous = process.env.VALIO_DATA_MODE;
  process.env.VALIO_DATA_MODE = 'mock';
  const rules = sourcing.rules;
  sourcing.rules = [{ id: 'test-dairy', kind: 'finnish-origin', categories: ['Dairy'] }];
  try {
    for (const query of ['milk', 'maito']) {
      const result = await supplier.search(query, '2026-11-18');
      assert.ok(result.offers.some((o) => o.product.productId === 'AIMO-10231'));
      assert.ok(result.offers.every((o) => !/veal|milk-fed/i.test(o.product.name)));
    }
    const quote = await supplier.quote(
      [
        { productId: 'AIMO-10231', quantity: 40 },
        { productId: 'AIMO-10218', quantity: 600 },
      ],
      '2026-11-18',
    );
    assert.equal(quote.source, 'mock');
    assert.equal(quote.total, 1376);
    assert.equal(
      quote.lines.reduce((total, line) => total + (line.quantity ?? 0), 0),
      1000,
    );
    assert.ok(quote.lines.every((line) => line.baseUnit === 'L'));
    assert.ok(
      (await supplier.search('oat drink', '2026-11-18')).offers.some(
        (o) => o.product.productId === 'AIMO-20410',
      ),
    );
    process.env.VALIO_DATA_MODE = 'live';
    assert.ok(
      (await supplier.products()).every((p) => !p.productId.startsWith('AIMO-')),
      'synthetic fixtures must not enter live mode',
    );
  } finally {
    sourcing.rules = rules;
    if (previous === undefined) delete process.env.VALIO_DATA_MODE;
    else process.env.VALIO_DATA_MODE = previous;
  }
});

test('full source assortment and matching carrot photos reach search and browse', () => {
  const rules = sourcing.rules;
  sourcing.rules = [];
  try {
    assert.ok(catalog.length >= 1199);
    const result = search({ query: 'carrots' });
    assert.ok(result.offers.length > 5);
    assert.ok(result.offers.every((o) => /carrot/i.test(o.lines[0].productName)));
    const pictured = result.offers.flatMap((o) => o.lines).filter((l) => l.image);
    assert.ok(pictured.length > 0);
    for (const line of pictured) {
      const path = new URL(line.image!).pathname.replace('/assistant/', '');
      assert.ok(existsSync(new URL(`../../web/public/${path}`, import.meta.url)));
    }
    const items = browseAssortment('Fruits and Vegetables').categories.flatMap((c) => c.items);
    assert.ok(items.length > 100);
    assert.ok(items.some((p) => /carrot/i.test(p.name) && p.image));
  } finally {
    sourcing.rules = rules;
  }
});

test('live supplier searches all local chicken products in English, Finnish and Swedish', async () => {
  const { supplier } = await import('./supplier');
  const products = await supplier.products();
  assert.ok(products.length >= 1199);
  const original = supplier.check;
  const checked: string[][] = [];
  supplier.check = async (ids) => {
    checked.push(ids);
    return ids.map((id) => ({
      product: products.find((p) => p.productId === id)!,
      availableSalesUnits: 5,
      terminal: false,
      blocked: false,
      issues: [],
    }));
  };
  try {
    for (const query of ['chicken', 'kana', 'broileri', 'kyckling']) {
      const result = await supplier.search(query, '2026-11-18');
      assert.equal(result.offers.length, 24, query);
      assert.ok(
        result.offers.every((o) => /chicken/i.test(o.product.name)),
        query,
      );
      assert.ok(
        result.offers.some((o) => o.product.image),
        query,
      );
    }
    assert.deepEqual(checked[0], checked[1]);
    assert.deepEqual(checked[0], checked[2]);
  } finally {
    supplier.check = original;
  }
});

test('all source and original demo mock products have prices, stock and delivery dates without live requests', async () => {
  const { supplier, supplierMockEnabled } = await import('./supplier');
  const previous = process.env.VALIO_DATA_MODE;
  process.env.VALIO_DATA_MODE = 'mock';
  const rules = sourcing.rules;
  sourcing.rules = [];
  try {
    assert.equal(supplierMockEnabled(), true);
    const products = await supplier.products();
    const checked = new Set<string>();
    for (const p of products) {
      const result = await supplier.search(p.name, '2026-11-18');
      assert.equal(result.source, 'mock');
      for (const offer of result.offers) {
        checked.add(offer.product.productId);
        assert.ok(offer.unitPrice! > 0, offer.product.name);
        assert.ok(offer.availableSalesUnits! > 0);
        assert.equal(offer.availableDate, '2026-11-18');
        assert.equal(offer.blocked, false);
      }
    }
    assert.equal(checked.size, products.length);
    const grapes = await supplier.search('grapes', '2026-11-18');
    assert.ok(grapes.offers.length >= 5);
    const quote = await supplier.quote(
      [{ productId: grapes.offers[0].product.productId, quantity: 2 }],
      '2026-11-18',
    );
    assert.equal(quote.source, 'mock');
    assert.equal(quote.total, Math.round(grapes.offers[0].unitPrice! * 200) / 100);
  } finally {
    sourcing.rules = rules;
    if (previous === undefined) delete process.env.VALIO_DATA_MODE;
    else process.env.VALIO_DATA_MODE = previous;
  }
});

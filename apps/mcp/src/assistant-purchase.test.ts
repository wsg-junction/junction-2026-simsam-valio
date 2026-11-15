import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as gateway from './gateway';
import { geminiChat, type Generate, type ModelTurn } from './llm';
import { action } from './assistant';
import { sourcing } from './sourcing';
import { addDays, today } from './util';

test('combined milk quote, one order, and repeat submissions', async () => {
  const apiKey = process.env.VALIO_API_KEY;
  delete process.env.VALIO_API_KEY;
  gateway.resetDemo();
  const rules = sourcing.rules;
  sourcing.rules = [];
  try {
    assert.equal(gateway.search({ query: 'soy drink', quantity: 1000 }).offers.length, 0, 'soy search must not return coconut drink');
    assert.equal(gateway.search({ query: 'gluten-free flour', quantity: 3 }).offers.length, 0, 'dietary adjective must not match unrelated foods');
    assert.ok(gateway.search({ query: 'vegetable oil', quantity: 3 }).offers.length, 'known ingredient synonym remains searchable');
    const search = gateway.search({ query: 'lactose-free semi-skimmed milk', quantity: 1000, neededBy: addDays(today(), 2) });
    const combined = search.offers.find((o) => o.lines.length === 2 && o.meetsDeadline && o.meetsQuantity);
    assert.ok(combined, 'combine the 400 L bulk stock and 600 L cartons');
    assert.equal(combined.quantity, 1000);
    const quoted = action({ type: 'quote-offer', searchId: search.searchId, offerId: combined.offerId });
    const card = quoted.cards[0];
    assert.equal(card.type, 'quote');
    if (card.type !== 'quote') throw new Error('Expected quote');
    assert.equal(card.data.quote.lines.length, 2);
    assert.equal(card.data.quote.total, 1376);
    assert.equal(gateway.listOrders().length, 0, 'quoting must not purchase');
    action({ type: 'place-quote', quoteId: card.data.quote.quoteId });
    action({ type: 'place-quote', quoteId: card.data.quote.quoteId });
    assert.equal(gateway.listOrders().length, 1, 'same quote can only create one order');
    assert.equal(gateway.listOrders()[0].lines.length, 2);

    assert.throws(() => gateway.requestQuote({ lines: [] }), /at least one/);
    assert.throws(() => gateway.requestQuote({ lines: [{ productId: 'AIMO-10231', quantity: -1 }] }), /positive/);
    assert.throws(() => gateway.requestQuote({ lines: [{ productId: 'AIMO-10240', quantity: 999999 }] }), /cannot supply/);
    const merged = gateway.requestQuote({ lines: [{ productId: 'AIMO-10218', quantity: 2 }, { productId: 'AIMO-10218', quantity: 3 }] });
    assert.equal(merged.quote.lines.length, 1);
    assert.equal(merged.quote.lines[0].quantity, 5);

    gateway.resetDemo();
    const call = (name: string, args: Record<string, unknown>): ModelTurn => ({
      functionCalls: [{ name, args }],
      candidates: [{ content: { role: 'model', parts: [{ functionCall: { name, args } }] } }],
    });
    let step = 0;
    const generate: Generate = async (contents) => {
      if (step++ === 0) return call('search_products', { query: 'lactose-free semi-skimmed milk', quantity: 1000, neededBy: addDays(today(), 2) });
      if (step === 2) {
        const result = contents.at(-1)?.parts?.[0].functionResponse?.response?.result as { offers: { lines: { productId: string; quantity: number }[] }[] };
        const offer = result.offers.find((o) => o.lines.length === 2)!;
        assert.ok(offer, 'model receives product IDs and quantities');
        return call('request_quote', { lines: offer.lines, neededBy: addDays(today(), 2) });
      }
      return { text: 'Your combined quote is ready. Nothing ordered.' };
    };
    const reply = await geminiChat('Quote 1000 L milk', [], 'test', generate, 'purchase-test');
    assert.deepEqual(reply.cards.map((c) => c.type), ['quote'], 'hide intermediate search cards');
    assert.equal(gateway.listOrders().length, 0);
    await geminiChat('What quantities are included?', [], 'test', async (contents) => {
      assert.ok(contents.some((c) => c.parts?.some((p) => p.functionResponse?.name === 'request_quote')), 'follow-up retains structured quote');
      return { text: '400 L and 600 L.' };
    }, 'purchase-test');
  } finally {
    if (apiKey) process.env.VALIO_API_KEY = apiKey;
    sourcing.rules = rules;
    gateway.resetDemo();
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './index.mjs';
import { priceOrder } from './routes/orders.mjs';

async function withServer(fn) {
  const server = await new Promise((r) => { const s = createApp().listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { server.close(); }
}

test('priceOrder never goes negative with a large flat coupon', () => {
  const t = priceOrder([{ id: 'p8', qty: 1 }], 'WELCOME50');
  assert.equal(t.subtotal, 19.99);
  assert.equal(t.discount, 19.99);
  assert.ok(t.total >= 0);
});

test('priceOrder reprices from catalog and ignores client price', () => {
  const t = priceOrder([{ id: 'p1', qty: 2, price: 0.01 }], '');
  assert.equal(t.subtotal, 259.98);
});

test('priceOrder clamps negative and fractional qty to a valid integer', () => {
  const t = priceOrder([{ id: 'p1', qty: -5 }], '');
  assert.equal(t.items[0].qty, 1);
  assert.ok(t.total >= 0);
});

test('search with regex-special chars returns 200, not 500', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/products?search=${encodeURIComponent('(')}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.products));
  });
});

test('categories does not expose the empty clearance bucket', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/categories`);
    const { categories } = await res.json();
    assert.ok(!categories.includes('clearance'));
  });
});

test('order can be tracked by its orderNumber', async () => {
  await withServer(async (base) => {
    const placed = await fetch(`${base}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ id: 'p1', qty: 1 }] })
    });
    const { order } = await placed.json();
    assert.match(order.orderNumber, /^NB-\d+$/);
    const track = await fetch(`${base}/api/orders/track/${order.orderNumber}`);
    assert.equal(track.status, 200);
    const byId = await fetch(`${base}/api/orders/track/${order.id}`);
    assert.equal(byId.status, 404);
  });
});

test('forged auth token is rejected', async () => {
  await withServer(async (base) => {
    const forged = Buffer.from('demo@nimbus.test').toString('base64url');
    const res = await fetch(`${base}/api/profile`, { headers: { Authorization: `Bearer ${forged}` } });
    assert.equal(res.status, 401);
  });
});

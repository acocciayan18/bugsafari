import { orders, coupons, nextOrderNumber, findProduct } from '../data.mjs';
import { userFromReq } from './auth.mjs';

let oid = 0;
const SHIP_FLAT = 6.99;
const round2 = (n) => Math.round(n * 100) / 100;

function normalizeItems(items) {
  const out = [];
  for (const raw of Array.isArray(items) ? items : []) {
    const product = findProduct(raw && raw.id);
    if (!product) continue;
    let qty = Math.floor(Number(raw.qty));
    if (!Number.isFinite(qty) || qty < 1) qty = 1;
    if (qty > product.stock) qty = Math.max(product.stock, 1);
    out.push({ id: product.id, name: product.name, price: product.price, image: product.image, qty });
  }
  return out;
}

export function priceOrder(items, code) {
  const line = normalizeItems(items);
  const subtotal = round2(line.reduce((s, i) => s + i.price * i.qty, 0));
  let discount = 0;
  let shipping = subtotal > 75 ? 0 : SHIP_FLAT;
  const c = code && coupons[String(code).trim().toUpperCase()];
  if (c) {
    if (c.type === 'percent') discount = subtotal * (c.value / 100);
    else if (c.type === 'flat') discount = c.value;
    else if (c.type === 'ship') shipping = 0;
  }
  discount = round2(Math.min(discount, subtotal));
  const total = round2(Math.max(subtotal - discount + shipping, 0));
  return { subtotal, discount, shipping: round2(shipping), total, items: line };
}

const STATUSES = ['Processing', 'Packed', 'Shipped', 'Out for delivery', 'Delivered'];

export function registerOrders(app) {
  app.post('/api/checkout/quote', (req, res) => {
    const { items = [], coupon = '' } = req.body || {};
    const { subtotal, discount, shipping, total } = priceOrder(items, coupon);
    res.json({ subtotal, discount, shipping, total });
  });

  app.post('/api/orders', (req, res) => {
    const { items = [], coupon = '', shipping: addr = {} } = req.body || {};
    const priced = priceOrder(items, coupon);
    if (!priced.items.length) return res.status(400).json({ error: 'Cart is empty' });
    const u = userFromReq(req);
    const { items: line, subtotal, discount, shipping, total } = priced;
    const order = {
      id: `o${(oid += 1)}`,
      orderNumber: nextOrderNumber(),
      userEmail: u ? u.email : null,
      items: line,
      subtotal,
      discount,
      shipping,
      total,
      status: 'Processing',
      address: addr,
      createdAt: new Date().toISOString()
    };
    orders.push(order);
    res.status(201).json({ order });
  });

  app.get('/api/orders', (req, res) => {
    const u = userFromReq(req);
    if (!u) return res.status(401).json({ error: 'Not authenticated' });
    res.json({ orders: orders.filter((o) => o.userEmail === u.email).reverse() });
  });

  app.get('/api/orders/track/:orderNumber', (req, res) => {
    const order = orders.find((o) => o.orderNumber === req.params.orderNumber);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    const idx = Math.min(STATUSES.indexOf(order.status), STATUSES.length - 1);
    res.json({ orderNumber: order.orderNumber, status: order.status, steps: STATUSES, currentStep: idx < 0 ? 0 : idx, total: order.total });
  });
}

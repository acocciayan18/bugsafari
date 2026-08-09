import { orders, coupons, nextOrderNumber } from '../data.mjs';
import { userFromReq } from './auth.mjs';

let oid = 0;
const SHIP_FLAT = 6.99;

function priceOrder(items, code) {
  const subtotal = items.reduce((s, i) => s + Number(i.price) * Number(i.qty), 0);
  let discount = 0;
  let shipping = subtotal > 75 ? 0 : SHIP_FLAT;
  const c = code && coupons[String(code).toUpperCase()];
  if (c) {
    if (c.type === 'percent') discount = subtotal * (c.value / 100);
    else if (c.type === 'flat') discount = c.value;
    else if (c.type === 'ship') shipping = 0;
  }
  const total = subtotal - discount + shipping;
  return { subtotal, discount, shipping, total };
}

const STATUSES = ['Processing', 'Packed', 'Shipped', 'Out for delivery', 'Delivered'];

export function registerOrders(app) {
  app.post('/api/checkout/quote', (req, res) => {
    const { items = [], coupon = '' } = req.body || {};
    res.json(priceOrder(items, coupon));
  });

  app.post('/api/orders', (req, res) => {
    const { items = [], coupon = '', shipping: addr = {} } = req.body || {};
    if (!items.length) return res.status(400).json({ error: 'Cart is empty' });
    const u = userFromReq(req);
    const totals = priceOrder(items, coupon);
    const order = {
      id: `o${(oid += 1)}`,
      orderNumber: nextOrderNumber(),
      userEmail: u ? u.email : null,
      items,
      ...totals,
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

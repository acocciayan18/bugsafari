import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';

interface Totals { subtotal: number; discount: number; shipping: number; total: number; }

export default function Checkout() {
  const { items, clear } = useCart();
  const { user } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', address: '', city: '', zip: '', phone: '', card: '' });
  const [coupon, setCoupon] = useState('');
  const [totals, setTotals] = useState<Totals>({ subtotal: 0, discount: 0, shipping: 0, total: 0 });
  const [error, setError] = useState('');
  const [placing, setPlacing] = useState(false);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!items.length) return;
    api<Totals>('/checkout/quote', { method: 'POST', body: JSON.stringify({ items, coupon }) })
      .then(setTotals)
      .catch(() => {});
  }, [items, coupon]);

  if (!items.length) {
    return <div className="empty"><h2>Nothing to check out</h2><Link to="/products" className="btn">Back to shop</Link></div>;
  }

  const validate = () => {
    if (!form.name || !form.address || !form.city || !form.zip || !form.phone || !form.card) return 'Please fill in all fields.';
    if (!form.email.includes('@')) return 'Please enter a valid email.';
    return '';
  };

  const placeOrder = async () => {
    const v = validate();
    if (v) { setError(v); return; }
    setError('');
    setPlacing(true);
    try {
      const r = await api<{ order: { orderNumber: string } }>('/orders', {
        method: 'POST',
        body: JSON.stringify({ items, coupon, shipping: form })
      });
      clear();
      nav(`/order/${r.order.orderNumber}`, { state: { order: r.order } });
    } catch (e: any) {
      setError(e.message || 'Could not place order.');
      setPlacing(false);
    }
  };

  return (
    <div className="checkout">
      <h1>Checkout</h1>
      <div className="checkout-grid">
        <section className="ck-form">
          <h3>Shipping details</h3>
          <div className="fields">
            <label>Full name<input value={form.name} onChange={(e) => set('name', e.target.value)} /></label>
            <label>Email<input value={form.email} onChange={(e) => set('email', e.target.value)} placeholder={user?.email || 'you@example.com'} /></label>
            <label>Address<input value={form.address} onChange={(e) => set('address', e.target.value)} /></label>
            <label>City<input value={form.city} onChange={(e) => set('city', e.target.value)} /></label>
            <label>ZIP code<input value={form.zip} onChange={(e) => set('zip', e.target.value)} /></label>
            <label>Phone<input value={form.phone} onChange={(e) => set('phone', e.target.value)} /></label>
          </div>
          <h3>Payment</h3>
          <div className="fields">
            <label className="wide">Card number<input value={form.card} onChange={(e) => set('card', e.target.value)} placeholder="4242 4242 4242 4242" /></label>
          </div>
          {error && <p className="error">{error}</p>}
        </section>

        <aside className="summary">
          <h3>Order summary</h3>
          {items.map((i) => (
            <div className="sum-row" key={i.id}><span>{i.name} × {i.qty}</span><span>${(i.price * i.qty).toFixed(2)}</span></div>
          ))}
          <div className="coupon">
            <input value={coupon} onChange={(e) => setCoupon(e.target.value)} placeholder="Coupon code" aria-label="Coupon" />
          </div>
          <div className="sum-row"><span>Subtotal</span><span>${totals.subtotal.toFixed(2)}</span></div>
          {totals.discount > 0 && <div className="sum-row ok"><span>Discount</span><span>−${totals.discount.toFixed(2)}</span></div>}
          <div className="sum-row muted"><span>Shipping</span><span>{totals.shipping ? `$${totals.shipping.toFixed(2)}` : 'Free'}</span></div>
          <div className="sum-row total"><span>Total</span><span>${totals.total.toFixed(2)}</span></div>
          <button className="btn btn-lg" onClick={placeOrder}>{placing ? 'Placing…' : 'Place order'}</button>
        </aside>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

interface Order { id: string; orderNumber: string; total: number; status: string; createdAt: string; items: { name: string; qty: number }[]; }

export default function Orders() {
  const { user, loading: authLoading } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { setLoading(false); return; }
    api<{ orders: Order[] }>('/orders')
      .then((r) => setOrders(Array.isArray(r.orders) ? r.orders : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user, authLoading]);

  if (authLoading || loading) return <div className="loader"><span className="spinner" /> Loading orders…</div>;
  if (!user) return <div className="empty"><h2>Sign in to see your orders</h2><Link to="/login" className="btn btn-lg">Sign in</Link></div>;
  if (!orders.length) return <div className="empty"><h2>No orders yet</h2><Link to="/products" className="btn btn-lg">Start shopping</Link></div>;

  return (
    <div className="orders">
      <h1>Your orders</h1>
      {orders.map((o) => (
        <div className="order-row" key={o.id}>
          <div>
            <div className="order-no">{o.orderNumber}</div>
            <div className="muted">{o.items.map((i) => `${i.name} ×${i.qty}`).join(', ')}</div>
          </div>
          <div className="order-status"><span className="pill">{o.status}</span></div>
          <div className="order-total">${o.total.toFixed(2)}</div>
          <Link to={`/track/${o.orderNumber}`} className="btn btn-sm">Track</Link>
        </div>
      ))}
    </div>
  );
}

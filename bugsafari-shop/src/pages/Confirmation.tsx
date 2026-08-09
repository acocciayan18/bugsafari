import { Link, useLocation, useParams } from 'react-router-dom';

export default function Confirmation() {
  const { orderNumber } = useParams();
  const { state } = useLocation() as { state?: { order?: any } };
  const order = state?.order;

  return (
    <div className="confirm">
      <div className="confirm-card">
        <div className="confirm-icon">✅</div>
        <h1>Thanks for your order!</h1>
        <p className="muted">Order <strong>{orderNumber}</strong> is confirmed. A receipt is on its way to your email.</p>
        {order && (
          <div className="confirm-total">
            <span>Total paid</span>
            <strong>${Number(order.total).toFixed(2)}</strong>
          </div>
        )}
        <div className="confirm-actions">
          <Link to={`/track/${order?.id || orderNumber}`} className="btn btn-lg">Track your order</Link>
          <Link to="/products" className="btn btn-lg btn-ghost">Keep shopping</Link>
        </div>
      </div>
    </div>
  );
}

import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import Thumb from '../components/Thumb';

export default function Cart() {
  const { items, subtotal, setQty, remove } = useCart();
  const nav = useNavigate();

  if (!items.length) {
    return (
      <div className="empty">
        <h2>Your cart is empty</h2>
        <p className="muted">Browse the shop and add something you love.</p>
        <Link to="/products" className="btn btn-lg">Start shopping</Link>
      </div>
    );
  }

  return (
    <div className="cart">
      <h1>Your cart</h1>
      <div className="cart-grid">
        <div className="cart-lines">
          {items.map((i) => (
            <div className="cart-line" key={i.id}>
              <Link to={`/products/${i.id}`}><Thumb image={i.image} size={72} /></Link>
              <div className="line-info">
                <Link to={`/products/${i.id}`} className="line-name">{i.name}</Link>
                <span className="muted">${i.price.toFixed(2)} each</span>
              </div>
              <div className="qty">
                <button onClick={() => setQty(i.id, i.qty - 1)} aria-label="Decrease">−</button>
                <input type="number" value={i.qty} onChange={(e) => setQty(i.id, Number(e.target.value))} aria-label={`Quantity of ${i.name}`} />
                <button onClick={() => setQty(i.id, i.qty + 1)} aria-label="Increase">+</button>
              </div>
              <div className="line-total">${(i.price * i.qty).toFixed(2)}</div>
              <button className="link-btn danger" onClick={() => remove(i.id)}>Remove</button>
            </div>
          ))}
        </div>
        <aside className="summary">
          <h3>Summary</h3>
          <div className="sum-row"><span>Subtotal</span><span>${subtotal.toFixed(2)}</span></div>
          <div className="sum-row muted"><span>Shipping</span><span>{subtotal > 75 ? 'Free' : '$6.99'}</span></div>
          <button className="btn btn-lg" onClick={() => nav('/checkout')}>Checkout</button>
          <Link to="/products" className="back">← Continue shopping</Link>
        </aside>
      </div>
    </div>
  );
}

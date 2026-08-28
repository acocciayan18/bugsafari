import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';

export default function Navbar() {
  const { count } = useCart();
  const { user, logout } = useAuth();
  const nav = useNavigate();

  const onLogout = () => { logout(); nav('/'); };

  return (
    <header className="nav">
      <div className="nav-inner">
        <Link to="/" className="logo">☁ Nimbus</Link>
        <nav className="nav-links">
          <NavLink to="/products">Shop</NavLink>
          <NavLink to="/orders">Orders</NavLink>
          <NavLink to="/track">Track</NavLink>
        </nav>
        <div className="nav-right">
          <Link to="/cart" className="cart-btn" aria-label="Cart">
            🛒<span className="badge">{count}</span>
          </Link>
          {user ? (
            <div className="acct">
              <Link to="/profile" className="acct-name">{user.name.split(' ')[0]}</Link>
              <button className="link-btn" onClick={onLogout}>Logout</button>
            </div>
          ) : (
            <Link to="/login" className="btn btn-sm">Sign in</Link>
          )}
        </div>
      </div>
    </header>
  );
}

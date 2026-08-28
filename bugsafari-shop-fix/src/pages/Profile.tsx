import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';

export default function Profile() {
  const { user, loading, logout } = useAuth();
  const { count } = useCart();

  if (loading) return <div className="loader"><span className="spinner" /> Loading…</div>;
  if (!user) {
    return (
      <div className="empty">
        <h2>You're not signed in</h2>
        <p className="muted">Sign in to view your profile and orders.</p>
        <Link to="/login" className="btn btn-lg">Sign in</Link>
      </div>
    );
  }

  return (
    <div className="profile">
      <div className="profile-card">
        <div className="avatar">{user.name[0]}</div>
        <div>
          <h1>{user.name}</h1>
          <p className="muted">{user.email}</p>
        </div>
      </div>
      <div className="profile-stats">
        <div className="stat"><span className="stat-num">{count}</span><span>Items in cart</span></div>
        <Link to="/orders" className="stat link"><span className="stat-num">📦</span><span>My orders</span></Link>
      </div>
      <button className="btn btn-ghost" onClick={logout}>Log out</button>
    </div>
  );
}

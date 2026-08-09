import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="empty">
      <div className="big-emoji">🧭</div>
      <h2>Page not found</h2>
      <p className="muted">The page you're looking for doesn't exist or has moved.</p>
      <Link to="/" className="btn btn-lg">Back home</Link>
    </div>
  );
}

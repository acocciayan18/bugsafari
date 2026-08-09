import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type Product } from '../api';
import { useCart } from '../context/CartContext';
import ErrorBoundary from '../components/ErrorBoundary';
import Thumb from '../components/Thumb';

interface Review { author: { name: string } | null; rating: number; text: string; }

function ReviewList({ reviews }: { reviews: Review[] }) {
  return (
    <ul className="reviews">
      {reviews.map((r, i) => (
        <li key={i}>
          <div className="rev-head">
            <span className="rev-author">{r.author!.name}</span>
            <span className="rating">★ {r.rating}</span>
          </div>
          <p>{r.text}</p>
        </li>
      ))}
    </ul>
  );
}

export default function ProductDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { add } = useCart();
  const [product, setProduct] = useState<Product | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [qty, setQty] = useState(1);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    setLoading(true);
    api<{ product: Product; reviews: Review[] }>(`/products/${id}`)
      .then((r) => { setProduct(r.product); setReviews(r.reviews); })
      .catch(() => setMissing(true))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="loader"><span className="spinner" /> Loading…</div>;
  if (missing || !product) return <div className="empty"><h2>Product not found</h2><Link to="/products" className="btn">Back to shop</Link></div>;

  const out = product.stock <= 0;
  const addToCart = () => add({ id: product.id, name: product.name, price: product.price, image: product.image, stock: product.stock }, qty);

  return (
    <div className="detail">
      <nav className="crumbs">
        <Link to="/products">Shop</Link> / <Link to={`/products?category=${product.category}`}>{product.category}</Link> / <span>{product.name}</span>
      </nav>

      <div className="detail-grid">
        <div className="detail-media"><Thumb image={product.image} size={280} /></div>
        <div className="detail-info">
          <h1>{product.name}</h1>
          <div className="detail-meta">
            <span className="rating">★ {product.rating.toFixed(1)}</span>
            <span className={out ? 'stock out' : 'stock'}>{out ? 'Out of stock' : `${product.stock} in stock`}</span>
          </div>
          <p className="desc">{product.description}</p>
          <div className="price-lg">${product.price.toFixed(2)}</div>
          <div className="buy">
            <input type="number" min={1} max={product.stock} value={qty} onChange={(e) => setQty(Number(e.target.value))} aria-label="Quantity" />
            <button className="btn btn-lg" disabled={out} onClick={addToCart}>{out ? 'Sold out' : 'Add to cart'}</button>
            <button className="btn btn-lg btn-ghost" disabled={out} onClick={() => { addToCart(); nav('/cart'); }}>Buy now</button>
          </div>
        </div>
      </div>

      <section className="detail-reviews">
        <h2>Customer reviews</h2>
        {reviews.length ? (
          <ErrorBoundary label="reviews" fallback={<p className="muted">Reviews are temporarily unavailable.</p>}>
            <ReviewList reviews={reviews} />
          </ErrorBoundary>
        ) : <p className="muted">No reviews yet.</p>}
      </section>
    </div>
  );
}

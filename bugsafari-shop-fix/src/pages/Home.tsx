import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Product } from '../api';
import ProductCard from '../components/ProductCard';

const CATS = [
  { key: 'electronics', label: 'Electronics', emoji: '🎧' },
  { key: 'apparel', label: 'Apparel', emoji: '👟' },
  { key: 'home', label: 'Home', emoji: '☕' },
  { key: 'books', label: 'Books', emoji: '📚' }
];

export default function Home() {
  const [featured, setFeatured] = useState<Product[]>([]);

  useEffect(() => {
    api<{ products: Product[] }>('/products?sort=rating')
      .then((r) => setFeatured(Array.isArray(r.products) ? r.products.slice(0, 4) : []))
      .catch(() => {});
  }, []);

  return (
    <div className="home">
      <section className="hero">
        <div className="hero-text">
          <h1>Everything you love, delivered.</h1>
          <p>Fresh tech, cozy apparel, and home essentials — curated by Nimbus.</p>
          <Link to="/products" className="btn btn-lg">Shop all products</Link>
        </div>
        <div className="hero-art">🛍️</div>
      </section>

      <section className="cats">
        {CATS.map((c) => (
          <Link key={c.key} to={`/products?category=${c.key}`} className="cat-tile">
            <span className="cat-emoji">{c.emoji}</span>
            <span>{c.label}</span>
          </Link>
        ))}
      </section>

      <section>
        <div className="row-head">
          <h2>Top rated</h2>
          <Link to="/products?sort=rating" className="see-all">See all →</Link>
        </div>
        <div className="grid">
          {featured.map((p) => <ProductCard key={p.id} p={p} />)}
        </div>
      </section>
    </div>
  );
}

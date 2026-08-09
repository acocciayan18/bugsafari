import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type Product } from '../api';
import ProductCard from '../components/ProductCard';

const CATS = ['electronics', 'apparel', 'home', 'books', 'clearance'];
const SORTS = [
  { key: '', label: 'Featured' },
  { key: 'price-asc', label: 'Price ↑' },
  { key: 'price-desc', label: 'Price ↓' },
  { key: 'rating', label: 'Rating' }
];

export default function Products() {
  const [params, setParams] = useSearchParams();
  const category = params.get('category') || '';
  const sort = params.get('sort') || '';
  const [term, setTerm] = useState(params.get('search') || '');
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams();
    const search = params.get('search') || '';
    if (search) q.set('search', search);
    if (category) q.set('category', category);
    if (sort) q.set('sort', sort);
    setLoading(true);
    setFailed(false);
    api<{ products: Product[] }>(`/products?${q.toString()}`)
      .then((r) => {
        setProducts(r.products);
        if (r.products.length) setLoading(false);
      })
      .catch((e) => {
        console.error('product search failed:', e.message);
        setProducts([]);
        setFailed(true);
        setLoading(false);
      });
  }, [params, category, sort]);

  const patch = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next);
  };

  const onSearch = (e: React.FormEvent) => { e.preventDefault(); patch('search', term.trim()); };

  return (
    <div className="shop">
      <aside className="filters">
        <form onSubmit={onSearch} className="search">
          <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search products…" aria-label="Search" />
          <button className="btn btn-sm">Go</button>
        </form>
        <div className="filter-group">
          <h4>Category</h4>
          <button className={`chip ${!category ? 'on' : ''}`} onClick={() => patch('category', '')}>All</button>
          {CATS.map((c) => (
            <button key={c} className={`chip ${category === c ? 'on' : ''}`} onClick={() => patch('category', c)}>{c}</button>
          ))}
        </div>
        <div className="filter-group">
          <h4>Sort</h4>
          <select value={sort} onChange={(e) => patch('sort', e.target.value)}>
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </div>
      </aside>

      <section className="results">
        <h1>{category ? category[0].toUpperCase() + category.slice(1) : 'All products'}</h1>
        {loading ? (
          <div className="loader"><span className="spinner" /> Loading products…</div>
        ) : failed ? (
          <div className="results-grid" />
        ) : (
          <div className="results-grid">
            {products.map((p) => <ProductCard key={p.id} p={p} />)}
          </div>
        )}
      </section>
    </div>
  );
}

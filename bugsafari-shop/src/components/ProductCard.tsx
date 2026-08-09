import { Link } from 'react-router-dom';
import type { Product } from '../api';
import { useCart } from '../context/CartContext';
import Thumb from './Thumb';

export default function ProductCard({ p }: { p: Product }) {
  const { add } = useCart();
  const out = p.stock <= 0;

  return (
    <div className="card">
      <Link to={`/products/${p.id}`} className="card-media">
        <Thumb image={p.image} />
      </Link>
      <div className="card-body">
        <Link to={`/products/${p.id}`} className="card-name">{p.name}</Link>
        <div className="card-meta">
          <span className="rating">★ {p.rating.toFixed(1)}</span>
          <span className="cat">{p.category}</span>
        </div>
        <div className="card-foot">
          <span className="price">${p.price.toFixed(2)}</span>
          <button
            className="btn btn-sm"
            disabled={out}
            onClick={() => add({ id: p.id, name: p.name, price: p.price, image: p.image, stock: p.stock })}
          >
            {out ? 'Sold out' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}

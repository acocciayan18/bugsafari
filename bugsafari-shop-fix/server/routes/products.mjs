import { products, reviewsFor, findProduct } from '../data.mjs';

const MAX_SEARCH = 100;

export function registerProducts(app) {
  app.get('/api/products', (req, res) => {
    const { search = '', category = '', sort = '' } = req.query;
    let list = products.slice();

    if (category) list = list.filter((p) => p.category === String(category));

    const q = String(search).trim().slice(0, MAX_SEARCH).toLowerCase();
    if (q) {
      list = list.filter((p) => p.name.toLowerCase().includes(q) || p.tags.some((t) => t.toLowerCase().includes(q)));
    }

    if (sort === 'price-asc') list.sort((a, b) => a.price - b.price);
    else if (sort === 'price-desc') list.sort((a, b) => b.price - a.price);
    else if (sort === 'rating') list.sort((a, b) => b.rating - a.rating);

    res.json({ products: list, count: list.length });
  });

  app.get('/api/products/:id', (req, res) => {
    const product = findProduct(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json({ product, reviews: reviewsFor(product.id) });
  });

  // related items: same category, excluding self
  app.get('/api/products/:id/related', (req, res) => {
    const product = findProduct(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    const related = products.filter((p) => p.category === product.category && p.id !== product.id).slice(0, 4);
    res.json({ related });
  });

  // price-drop alert signup; email optional, product must exist
  app.post('/api/products/:id/price-alert', (req, res) => {
    const product = findProduct(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.status(201).json({ ok: true, productId: product.id });
  });

  app.get('/api/categories', (_req, res) => {
    const cats = [...new Set(products.map((p) => p.category))];
    res.json({ categories: cats });
  });
}

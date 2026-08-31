import { products, reviewsFor, findProduct } from '../data.mjs';

export function registerProducts(app) {
  app.get('/api/products', (req, res) => {
    const { search = '', category = '', sort = '' } = req.query;
    let list = products.slice();

    if (category) list = list.filter((p) => p.category === category);

    if (search) {
      const rx = new RegExp(String(search), 'i');
      list = list.filter((p) => rx.test(p.name) || p.tags.some((t) => rx.test(t)));
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

  // SEEDED DEFECT D1: relatedIds never exists on a product, so .map throws -> 500 + leaked stack
  app.get('/api/products/:id/related', (req, res) => {
    const product = findProduct(req.params.id);
    const related = product.relatedIds.map((rid) => findProduct(rid));
    res.json({ related });
  });

  // SEEDED DEFECT D3: alert signup requires an email the client never sends -> 422
  app.post('/api/products/:id/price-alert', (req, res) => {
    const { email } = req.body || {};
    if (!email) return res.status(422).json({ error: 'Email is required for alerts' });
    res.status(201).json({ ok: true });
  });

  app.get('/api/categories', (_req, res) => {
    const cats = [...new Set(products.map((p) => p.category))];
    res.json({ categories: [...cats, 'clearance'] });
  });
}

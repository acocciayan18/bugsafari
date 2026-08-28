let orderSeq = 1000;

export const users = new Map();
export const orders = [];

users.set('demo@nimbus.test', { id: 'u1', name: 'Demo Shopper', email: 'demo@nimbus.test', password: 'password123' });
users.set('sam@nimbus.test', { id: 'u2', name: 'Sam Rivers', email: 'sam@nimbus.test', password: 'shopnow42' });

export const coupons = {
  SAVE10: { type: 'percent', value: 10, label: '10% off' },
  FREESHIP: { type: 'ship', value: 0, label: 'Free shipping' },
  WELCOME50: { type: 'flat', value: 50, label: '$50 off' }
};

const img = (bg, e) => `${bg}|${e}`;

export const products = [
  { id: 'p1', name: 'Aurora Wireless Headphones', category: 'electronics', price: 129.99, stock: 24, rating: 4.6, image: img('#6366f1', '🎧'), tags: ['audio', 'wireless'], description: 'Over-ear headphones with active noise cancelling and 30h battery.' },
  { id: 'p2', name: 'Nimbus Smart Watch 2', category: 'electronics', price: 199.0, stock: 12, rating: 4.4, image: img('#0ea5e9', '⌚'), tags: ['wearable'], description: 'Fitness tracking, heart-rate, and always-on display.' },
  { id: 'p3', name: 'Pebble Bluetooth Speaker', category: 'electronics', price: 49.5, stock: 40, rating: 4.2, image: img('#14b8a6', '🔊'), tags: ['audio'], description: 'Pocket speaker with deep bass and IPX7 water resistance.' },
  { id: 'p4', name: '4K Action Camera', category: 'electronics', price: 89.99, stock: 8, rating: 4.1, image: img('#f97316', '📷'), tags: ['camera'], description: 'Waterproof 4K action cam with stabilization.' },
  { id: 'p5', name: 'Merino Wool Sweater', category: 'apparel', price: 74.0, stock: 30, rating: 4.7, image: img('#a3623b', '🧥'), tags: ['winter'], description: 'Soft merino knit sweater, breathable and warm.' },
  { id: 'p6', name: 'Trailhead Running Shoes', category: 'apparel', price: 110.0, stock: 18, rating: 4.5, image: img('#22c55e', '👟'), tags: ['sport'], description: 'Lightweight trail runners with grippy outsole.' },
  { id: 'p7', name: 'Classic Denim Jacket', category: 'apparel', price: 68.0, stock: 22, rating: 4.3, image: img('#3b82f6', '🧥'), tags: ['casual'], description: 'Timeless denim jacket with a modern slim fit.' },
  { id: 'p8', name: 'Everyday Cotton Tee', category: 'apparel', price: 19.99, stock: 120, rating: 4.0, image: img('#ef4444', '👕'), tags: ['basics'], description: 'Breathable cotton tee, pack of essentials.' },
  { id: 'p9', name: 'Ceramic Pour-Over Kit', category: 'home', price: 42.0, stock: 16, rating: 4.8, image: img('#8b5cf6', '☕'), tags: ['kitchen'], description: 'Hand-glazed pour-over dripper with matching carafe.' },
  { id: 'p10', name: 'Linen Throw Blanket', category: 'home', price: 55.0, stock: 27, rating: 4.6, image: img('#ec4899', '🧶'), tags: ['decor'], description: 'Stonewashed linen throw for couch or bed.' },
  { id: 'p11', name: 'Aroma Diffuser', category: 'home', price: 33.5, stock: 35, rating: 4.2, image: img('#10b981', '🌿'), tags: ['wellness'], description: 'Ultrasonic diffuser with 7 ambient light modes.' },
  { id: 'p12', name: 'Cast Iron Skillet 12"', category: 'home', price: 39.0, stock: 0, rating: 4.9, image: img('#64748b', '🍳'), tags: ['kitchen'], description: 'Pre-seasoned cast iron skillet, oven safe.' },
  { id: 'p13', name: 'The Pragmatic Coder', category: 'books', price: 29.99, stock: 60, rating: 4.7, image: img('#f59e0b', '📘'), tags: ['tech'], description: 'A modern guide to shipping resilient software.' },
  { id: 'p14', name: 'Atlas of Small Places', category: 'books', price: 24.0, stock: 44, rating: 4.5, image: img('#06b6d4', '📗'), tags: ['travel'], description: 'Illustrated travel essays from forgotten towns.' },
  { id: 'p15', name: 'Cooking with Fire', category: 'books', price: 34.5, stock: 15, rating: 4.4, image: img('#dc2626', '📕'), tags: ['cooking'], description: 'Live-fire recipes for the home cook.' },
  { id: 'p16', name: 'Mindful Mornings Journal', category: 'books', price: 16.0, stock: 80, rating: 4.1, image: img('#84cc16', '📓'), tags: ['wellness'], description: 'Guided daily journal with prompts.' }
];

const reviews = {
  p1: [
    { author: { name: 'Jordan' }, rating: 5, text: 'Incredible sound, comfy for long sessions.' },
    { author: { name: 'Priya' }, rating: 4, text: 'Great value, ANC works well.' }
  ],
  p2: [{ author: { name: 'Chris' }, rating: 4, text: 'Battery could be better but solid.' }],
  p5: [{ author: { name: 'Dana' }, rating: 5, text: 'So warm and soft.' }],
  p9: [
    { author: { name: 'Lee' }, rating: 5, text: 'Best coffee at home.' },
    { author: null, rating: 5, text: 'Verified buyer — beautiful craftsmanship.' }
  ],
  p13: [{ author: { name: 'Morgan' }, rating: 5, text: 'Required reading for my team.' }]
};

export function reviewsFor(id) {
  return reviews[id] || [];
}

export function nextOrderNumber() {
  orderSeq += 1;
  return `NB-${orderSeq}`;
}

export function findProduct(id) {
  return products.find((p) => p.id === id);
}

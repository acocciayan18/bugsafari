import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export interface CartItem { id: string; name: string; price: number; image: string; stock: number; qty: number; }

interface CartValue {
  items: CartItem[];
  count: number;
  subtotal: number;
  add: (p: Omit<CartItem, 'qty'>, qty?: number) => void;
  setQty: (id: string, qty: number) => void;
  remove: (id: string) => void;
  clear: () => void;
}

const KEY = 'nimbus_cart';
const Ctx = createContext<CartValue | null>(null);

function load(): CartItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter((i) => i && typeof i.id === 'string').map((i) => ({ ...i, qty: clampQty(i.qty, i.stock) }));
  } catch { return []; }
}

function clampQty(qty: number, stock: number): number {
  const n = Math.floor(Number(qty));
  const max = Number.isFinite(stock) && stock > 0 ? stock : 1;
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, max);
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(load);

  useEffect(() => { localStorage.setItem(KEY, JSON.stringify(items)); }, [items]);

  const add: CartValue['add'] = (p, qty = 1) => {
    setItems((prev) => {
      const found = prev.find((i) => i.id === p.id);
      if (found) return prev.map((i) => (i.id === p.id ? { ...i, qty: clampQty(i.qty + qty, p.stock) } : i));
      return [...prev, { ...p, qty: clampQty(qty, p.stock) }];
    });
  };

  const setQty: CartValue['setQty'] = (id, qty) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, qty: clampQty(qty, i.stock) } : i)));
  };

  const remove: CartValue['remove'] = (id) => setItems((prev) => prev.filter((i) => i.id !== id));
  const clear = () => setItems([]);

  const count = items.reduce((s, i) => s + i.qty, 0);
  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);

  return <Ctx.Provider value={{ items, count, subtotal, add, setQty, remove, clear }}>{children}</Ctx.Provider>;
}

export function useCart() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCart outside provider');
  return v;
}

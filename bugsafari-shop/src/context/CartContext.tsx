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
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(load);

  useEffect(() => { localStorage.setItem(KEY, JSON.stringify(items)); }, [items]);

  const add: CartValue['add'] = (p, qty = 1) => {
    setItems((prev) => {
      const found = prev.find((i) => i.id === p.id);
      if (found) return prev.map((i) => (i.id === p.id ? { ...i, qty: i.qty + qty } : i));
      return [...prev, { ...p, qty }];
    });
  };

  const setQty: CartValue['setQty'] = (id, qty) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, qty } : i)));
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

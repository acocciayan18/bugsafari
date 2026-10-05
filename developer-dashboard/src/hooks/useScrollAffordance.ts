// Edge-fade affordance for a horizontally scrollable rail. Watches a ref's scroll
// position + size (rAF-batched, ResizeObserver) and reports whether content is
// clipped at each edge so a fade can cue more off-screen tabs.
import { useEffect, useRef, useState } from 'react';

const SLACK_PX = 2;

export function useScrollAffordance<T extends HTMLElement = HTMLDivElement>() {
  const scrollRef = useRef<T>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  const ticking = useRef(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      const max = el.scrollWidth - el.clientWidth;
      setEdges({ start: el.scrollLeft > SLACK_PX, end: el.scrollLeft < max - SLACK_PX });
    };
    const onScroll = () => {
      if (ticking.current) return;
      ticking.current = true;
      requestAnimationFrame(() => { ticking.current = false; measure(); });
    };
    measure();
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', onScroll); ro.disconnect(); };
  }, []);

  return { scrollRef, edges };
}

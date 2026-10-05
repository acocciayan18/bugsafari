// Hide-on-scroll-down / reveal-on-scroll-up for a mobile header. Observes a scroll
// container ref (rAF-batched, delta-thresholded) so the transition never flickers.
import { useEffect, useRef, useState } from 'react';

const DELTA_PX = 8;
const TOP_REVEAL_PX = 64;

export function useHideOnScroll<T extends HTMLElement = HTMLDivElement>(active: boolean) {
  const scrollRef = useRef<T>(null);
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);
  const ticking = useRef(false);

  useEffect(() => {
    const el = scrollRef.current;
    // Inactive (desktop) always shows the header and attaches no listener.
    if (!el || !active) {
      setHidden(false);
      return;
    }
    lastY.current = el.scrollTop;
    const onScroll = () => {
      if (ticking.current) return;
      ticking.current = true;
      requestAnimationFrame(() => {
        ticking.current = false;
        const y = el.scrollTop;
        const dy = y - lastY.current;
        if (Math.abs(dy) < DELTA_PX) return;
        if (y <= TOP_REVEAL_PX) setHidden(false);
        else setHidden(dy > 0);
        lastY.current = y;
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [active]);

  return { scrollRef, hidden };
}

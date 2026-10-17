// Hide-on-scroll-down / reveal-on-scroll-up for a sticky/fixed header. Observes a
// scroll container ref, or the window when no ref is attached (rAF-batched,
// delta-thresholded) so the transition never flickers.
import { useEffect, useRef, useState } from 'react';

const DELTA_PX = 8;
const TOP_REVEAL_PX = 64;

export function useHideOnScroll<T extends HTMLElement = HTMLDivElement>(active: boolean) {
  const scrollRef = useRef<T>(null);
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);
  const ticking = useRef(false);

  useEffect(() => {
    // Inactive always shows the header and attaches no listener.
    if (!active) {
      setHidden(false);
      return;
    }
    const el = scrollRef.current;
    const target: HTMLElement | Window = el ?? window;
    const readY = () => (el ? el.scrollTop : window.scrollY);
    lastY.current = readY();
    const onScroll = () => {
      if (ticking.current) return;
      ticking.current = true;
      requestAnimationFrame(() => {
        ticking.current = false;
        const y = readY();
        const dy = y - lastY.current;
        if (Math.abs(dy) < DELTA_PX) return;
        if (y <= TOP_REVEAL_PX) setHidden(false);
        else setHidden(dy > 0);
        lastY.current = y;
      });
    };
    target.addEventListener('scroll', onScroll, { passive: true });
    return () => target.removeEventListener('scroll', onScroll);
  }, [active]);

  return { scrollRef, hidden };
}

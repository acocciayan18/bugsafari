// Sticky scroll-lock for streaming log panels: auto-scrolls to the newest
// entry only while the user is already at the bottom; scrolling up disengages
// the lock so new entries don't yank the view until they jump back down.
import { useCallback, useEffect, useRef, useState } from 'react';

const BOTTOM_THRESHOLD_PX = 32;

export function useStickyScroll<T extends HTMLElement = HTMLDivElement>(contentSignal: number) {
  const containerRef = useRef<T>(null);
  const atBottomRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      const near = el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_THRESHOLD_PX;
      atBottomRef.current = near;
      setAtBottom(near);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Only re-pin to bottom when new content arrives and the lock is engaged
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !atBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [contentSignal]);

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    atBottomRef.current = true;
    setAtBottom(true);
  }, []);

  return { containerRef, atBottom, scrollToBottom };
}

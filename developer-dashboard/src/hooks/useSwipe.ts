import { useRef, type TouchEvent } from 'react';

interface SwipeHandlers {
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
}

// Min horizontal travel (px) to count as a swipe, and the max vertical drift allowed —
// a mostly-vertical gesture is a scroll, not a tab change, and must pass through.
const MIN_DISTANCE = 56;
const MAX_VERTICAL_RATIO = 0.75;

// Horizontal swipe detection for touch, returned as spreadable touch props. Vertical
// scrolls are left untouched so the log still scrolls normally under the finger.
export function useSwipe({ onSwipeLeft, onSwipeRight }: SwipeHandlers) {
  const start = useRef<{ x: number; y: number } | null>(null);

  return {
    onTouchStart: (e: TouchEvent) => {
      const t = e.touches[0];
      start.current = { x: t.clientX, y: t.clientY };
    },
    onTouchEnd: (e: TouchEvent) => {
      if (!start.current) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - start.current.x;
      const dy = t.clientY - start.current.y;
      start.current = null;
      if (Math.abs(dx) < MIN_DISTANCE) return;
      if (Math.abs(dy) > Math.abs(dx) * MAX_VERTICAL_RATIO) return;
      if (dx < 0) onSwipeLeft();
      else onSwipeRight();
    },
  };
}

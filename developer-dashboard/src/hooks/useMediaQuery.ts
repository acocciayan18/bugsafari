import { useSyncExternalStore } from 'react';

// Tailwind's default breakpoints, mirrored so TS callers and CSS agree.
export const BREAKPOINTS = { sm: 640, md: 768, lg: 1024, xl: 1280 } as const;

function subscribe(query: string) {
  return (onChange: () => void) => {
    const list = window.matchMedia(query);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  };
}

/** Reactive `matchMedia`. SSR-safe via a `false` server snapshot. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    subscribe(query),
    () => window.matchMedia(query).matches,
    () => false
  );
}

/** True below `lg` — the viewport where the sidebar becomes an overlay drawer. */
export function useIsCompact(): boolean {
  return useMediaQuery(`(max-width: ${BREAKPOINTS.lg - 1}px)`);
}

/** True below `md` — the viewport where split panes stack into a single column. */
export function useIsMobile(): boolean {
  return useMediaQuery(`(max-width: ${BREAKPOINTS.md - 1}px)`);
}

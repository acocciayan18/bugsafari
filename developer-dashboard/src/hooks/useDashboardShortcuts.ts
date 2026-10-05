import { useEffect, useRef } from 'react';

interface ShortcutHandlers {
  onFocusUrl: () => void;
  onToggleRun: () => void;
  onOpenConfig: () => void;
  // Zero-based telemetry tab index (0-3).
  onSelectTab: (index: number) => void;
  onToggleHelp: () => void;
  // Off while a run blocks config, during text entry, etc. — caller decides.
  enabled: boolean;
}

// True when focus is in a field, so a bare letter key types instead of firing a shortcut.
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

// Global dashboard keyboard shortcuts. Modifier combos are ignored so browser/OS
// chords (Ctrl+S, ⌘L) are never shadowed; Escape is left to the overlays themselves.
export function useDashboardShortcuts(handlers: ShortcutHandlers): void {
  // Handlers arrive as fresh closures every render (the dashboard re-renders on each
  // telemetry tick). Read them through a ref so the listener is bound ONCE, not re-added
  // and removed on every frame.
  const ref = useRef(handlers);
  // Capture the latest closures after each render (not during), so the one-time listener
  // below always calls current handlers without re-subscribing.
  useEffect(() => { ref.current = handlers; });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const h = ref.current;
      if (!h.enabled) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // `?` opens the cheat-sheet even from a field — it's a help request, not input.
      if (e.key === '?') { e.preventDefault(); h.onToggleHelp(); return; }

      if (isEditableTarget(e.target)) return;

      switch (e.key) {
        case '/':
        case 'u':
          e.preventDefault();
          h.onFocusUrl();
          return;
        case 's':
          e.preventDefault();
          h.onToggleRun();
          return;
        case 'c':
          e.preventDefault();
          h.onOpenConfig();
          return;
        case '1':
        case '2':
        case '3':
        case '4':
          e.preventDefault();
          h.onSelectTab(Number(e.key) - 1);
          return;
        default:
          return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}

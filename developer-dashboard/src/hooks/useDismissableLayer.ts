import { useEffect, useRef, type RefObject } from 'react';

interface UseDismissableLayerOptions {
  isOpen: boolean;
  onDismiss: () => void;
}

/**
 * Shared close-on-outside-click + close-on-Escape behavior for dropdowns and menus.
 * Attach the returned ref to the dropdown's outer container.
 */
export function useDismissableLayer<T extends HTMLElement>({
  isOpen,
  onDismiss,
}: UseDismissableLayerOptions): RefObject<T | null> {
  const containerRef = useRef<T>(null);

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onDismiss();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onDismiss();
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onDismiss]);

  return containerRef;
}

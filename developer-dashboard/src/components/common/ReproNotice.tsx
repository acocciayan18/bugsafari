// Info-icon notice shown beside every reproduction header. Hover, focus or click
// opens a body-portal popup clarifying the steps are what BugSafari did when the
// issue was detected, not a guaranteed exact/complete reproduction sequence.

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';

const GAP = 8;

const NOTICE =
  'These are the actions BugSafari performed when the issue was detected. Use them as a guide for investigating and reproducing the problem; they may not represent the exact or complete reproduction sequence.';

export default function ReproNotice() {
  const tipId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Measure trigger + tip against the viewport and flip above/below.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      const tip = tipRef.current?.getBoundingClientRect();
      if (!trigger || !tip) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const spaceBelow = vh - trigger.bottom;
      const below = spaceBelow >= tip.height + GAP || spaceBelow >= trigger.top;
      const rawTop = below ? trigger.bottom + GAP : trigger.top - tip.height - GAP;
      const top = Math.max(GAP, Math.min(rawTop, vh - tip.height - GAP));
      const left = Math.max(GAP, Math.min(trigger.left, vw - tip.width - GAP));
      setPos({ top, left });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  // A click pins the popup open; Escape or an outside click releases it.
  useEffect(() => {
    if (!pinned) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPinned(false);
        setOpen(false);
      }
    };
    const onDown = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node) || tipRef.current?.contains(e.target as Node)) return;
      setPinned(false);
      setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [pinned]);

  return (
    <span className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        aria-label="About these reproduction steps"
        aria-describedby={open ? tipId : undefined}
        aria-expanded={open}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => !pinned && setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => !pinned && setOpen(false)}
        onClick={() => {
          const next = !pinned;
          setPinned(next);
          setOpen(next);
        }}
        className="inline-flex cursor-help items-center rounded outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus)"
      >
        <Info className="h-3.5 w-3.5 text-(--text-tertiary)" aria-hidden="true" />
      </button>

      {open && createPortal(
        <span
          ref={tipRef}
          id={tipId}
          role="tooltip"
          style={{ position: 'fixed', top: pos?.top ?? 0, left: pos?.left ?? 0, opacity: pos ? 1 : 0 }}
          className="z-50 block w-72 max-w-[calc(100vw-1rem)] rounded-lg border border-(--border-hairline) bg-(--surface-raised) p-3 text-left shadow-lg transition-opacity duration-150"
        >
          <span className="block text-[13px] font-bold text-(--text-primary)">About these steps</span>
          <span className="mt-1 block text-xs leading-relaxed text-(--text-secondary)">{NOTICE}</span>
        </span>,
        document.body,
      )}
    </span>
  );
}

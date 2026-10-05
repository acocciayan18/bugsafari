import { cloneElement, useId, useRef, useState, type ReactElement } from 'react';

type TooltipSide = 'top' | 'bottom' | 'left' | 'right';

interface TooltipProps {
  // Visible hint text. Also wired to the trigger via aria-describedby.
  label: string;
  children: ReactElement;
  side?: TooltipSide;
}

const SIDE_CLASS: Record<TooltipSide, string> = {
  top: 'bottom-full left-1/2 mb-1.5 -translate-x-1/2',
  bottom: 'top-full left-1/2 mt-1.5 -translate-x-1/2',
  left: 'right-full top-1/2 mr-1.5 -translate-y-1/2',
  right: 'left-full top-1/2 ml-1.5 -translate-y-1/2',
};

// Accessible tooltip for icon-only controls — opens on hover, keyboard focus, AND touch
// (the native `title` attribute does none of the latter two). The trigger keeps its own
// aria-label; this adds a describedby hint and a visible bubble. One child only.
export function Tooltip({ label, children, side = 'top' }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  // Touch: first tap reveals the tip without also firing the control, so the hint is
  // reachable on phones; a second tap (or tapping elsewhere) proceeds as normal.
  const suppressedTap = useRef(false);

  const show = () => setOpen(true);
  const hide = () => setOpen(false);

  const trigger = cloneElement(children, { 'aria-describedby': open ? id : undefined } as Record<string, unknown>);

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onTouchStart={() => {
        if (!open) { setOpen(true); suppressedTap.current = true; }
      }}
      onClickCapture={(e) => {
        if (suppressedTap.current) { e.stopPropagation(); e.preventDefault(); suppressedTap.current = false; }
      }}
    >
      {trigger}
      <span
        role="tooltip"
        id={id}
        className={`pointer-events-none absolute z-50 whitespace-nowrap rounded-md border border-(--border-hairline) bg-(--surface-invert) px-2 py-1 text-[12px] font-medium text-(--text-oninvert) shadow-md transition-opacity duration-100 ${SIDE_CLASS[side]} ${open ? 'opacity-100' : 'opacity-0'}`}
      >
        {label}
      </span>
    </span>
  );
}

export default Tooltip;

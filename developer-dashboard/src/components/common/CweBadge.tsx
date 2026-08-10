// ═══════════════════════════════════════════════════════════════
// CweBadge - the CWE-XXX finding pill with a BugSafari-designed
// tooltip (not the browser title). Explains what CWE means plus the
// specific weakness in student-friendly plain English. Shared by the
// live Errors tab and the saved Forensic Report via FindingMetaBar so
// the affordance is identical across Findings and Forensic History.
// The tooltip renders in a body portal (the finding card clips
// overflow) and flips above/below based on available viewport space.
// ═══════════════════════════════════════════════════════════════

import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';

interface CweInfo {
  name: string;
  plain: string;
}

// Plain-English gloss for every CWE id the knowledge base can attribute (bugCatalog.ts).
const CWE_CATALOG: Record<string, CweInfo> = {
  'CWE-20': { name: 'Improper Input Validation', plain: 'The app uses what a user typed without properly checking it first.' },
  'CWE-79': { name: 'Cross-site Scripting (XSS)', plain: "User input is shown on the page without escaping, so it can run as the page's own code." },
  'CWE-89': { name: 'SQL Injection', plain: 'User input is dropped straight into a database query, letting a crafted value change the query.' },
  'CWE-200': { name: 'Exposure of Sensitive Information', plain: 'Private internal detail (errors, traces, secrets) is sent to the browser where anyone can read it.' },
  'CWE-248': { name: 'Uncaught Exception', plain: 'An error was thrown and never caught, leaving the page in an unstable state.' },
  'CWE-362': { name: 'Race Condition', plain: 'Two actions run at the same time and corrupt shared state that was not protected.' },
  'CWE-400': { name: 'Uncontrolled Resource Consumption', plain: 'The app can use unlimited time or memory, so it hangs or exhausts resources under load.' },
  'CWE-602': { name: 'Client-Side Enforcement of Server-Side Security', plain: 'A security rule is enforced only in the browser, where a user can simply remove it.' },
  'CWE-613': { name: 'Insufficient Session Expiration', plain: 'The login session is not kept or expired correctly, so it can be lost or reused unexpectedly.' },
  'CWE-754': { name: 'Improper Check for Unusual or Exceptional Conditions', plain: 'The app does not handle an unexpected reply or error condition, so it breaks instead of recovering.' },
  'CWE-835': { name: "Loop with Unreachable Exit Condition ('Infinite Loop')", plain: 'Code keeps looping or redrawing with no way out, so it never settles.' },
  'CWE-943': { name: 'Improper Neutralization of Data Query Logic (NoSQL Injection)', plain: 'Query operators from user input reach the database untouched and change what the query returns.' },
};

// Older records may carry an id outside the catalog above — fall back to the generic gloss.
const GENERIC = 'A standard weakness type from the CWE catalog.';

const GAP = 8;

interface TipPos {
  top: number;
  left: number;
}

export default function CweBadge({ cwe }: { cwe: string }) {
  const info = CWE_CATALOG[cwe.toUpperCase()];
  const tipId = useId();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<TipPos | null>(null);

  // Measure the trigger + tooltip against the viewport and flip above/below.
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
      const spaceAbove = trigger.top;
      const below = spaceBelow >= tip.height + GAP || spaceBelow >= spaceAbove;
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

  return (
    <span className="relative inline-flex">
      <span
        ref={triggerRef}
        tabIndex={0}
        aria-describedby={open ? tipId : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="inline-flex cursor-help items-center gap-1.5 rounded-md border border-(--border-hairline) bg-(--surface-inset) px-2 py-1 outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus)"
      >
        <span className="text-xs font-semibold uppercase text-(--text-tertiary)">CWE</span>
        <span className="text-xs font-semibold text-(--text-primary)">{cwe}</span>
        <Info className="h-3 w-3 text-(--text-tertiary)" aria-hidden="true" />
      </span>

      {/* Body portal escapes the card's overflow clipping; opacity holds until measured to avoid a flash */}
      {open && createPortal(
        <span
          ref={tipRef}
          id={tipId}
          role="tooltip"
          style={{ position: 'fixed', top: pos?.top ?? 0, left: pos?.left ?? 0, opacity: pos ? 1 : 0 }}
          className="pointer-events-none z-50 block w-64 max-w-[calc(100vw-1rem)] rounded-lg border border-(--border-hairline) bg-(--surface-raised) p-3 text-left shadow-lg transition-opacity duration-150"
        >
          <span className="block text-[13px] font-bold text-(--text-primary)">{cwe}{info ? ` · ${info.name}` : ''}</span>
          <span className="mt-1 block text-xs leading-relaxed text-(--text-secondary)">{info?.plain ?? GENERIC}</span>
          <span className="mt-2 block border-t border-(--border-hairline) pt-2 text-xs leading-relaxed text-(--text-tertiary)">
            CWE (Common Weakness Enumeration) is a shared catalog that names common software security weaknesses.
          </span>
        </span>,
        document.body,
      )}
    </span>
  );
}

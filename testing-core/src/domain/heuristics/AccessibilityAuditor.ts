import type { Page } from 'playwright';
import type { A11yImpact } from '../../../../shared/types.js';

export type { A11yImpact };

/** A single WCAG violation found on a live DOM state. */
export interface A11yViolation {
  /** Stable rule id, e.g. 'image-alt'. */
  rule: string;
  /** WCAG success criterion, e.g. '1.1.1'. */
  wcag: string;
  impact: A11yImpact;
  /** Best-effort CSS selector locating the offending element (empty for page-level rules). */
  selector: string;
  /** Human name of the offending element — what the operator sees instead of the selector. */
  elementName: string;
  /** What is wrong and why it matters for assistive tech. */
  description: string;
  /** Concrete remediation for this violation. */
  suggestedFix: string;
}

// Bound the per-run ledger so a pathological page (thousands of unlabeled cells)
// can't grow memory without limit — the first N distinct violations are enough
// to action, and coverage is what matters, not exhaustive duplicate counts.
const MAX_TRACKED_VIOLATIONS = 300;

/**
 * Static per-DOM-state accessibility (WCAG 2.1) auditor. Runs entirely in the
 * target page context via page.evaluate — read-only, no mutation of the app under
 * test. Deterministic (pure DOM inspection, no randomness/clock). Deduplicates by
 * (rule, selector) across the whole run and audits each structural shell at most
 * once, so it adds real coverage without re-reporting the same defect every step.
 *
 * Mirrors the existing domain/heuristics detectors (MemoryLeak / VisualRegression):
 * a pure analyzer the engine drives; it neither emits telemetry nor persists.
 */
export class AccessibilityAuditor {
  // (rule::selector) keys already reported this run — cross-state dedup.
  private readonly seenViolations = new Set<string>();
  // Structural shells already audited — skip re-scanning a page we've checked.
  private readonly auditedStructures = new Set<string>();

  /**
   * Audit the current DOM for the given structural shell. Returns only violations
   * not already reported this run (may be empty). No-ops if this shell was already
   * audited or the ledger is full. Never throws — a scan failure yields [].
   */
  public async audit(page: Page, structureHash: string): Promise<A11yViolation[]> {
    if (this.auditedStructures.has(structureHash)) return [];
    this.auditedStructures.add(structureHash);
    if (this.seenViolations.size >= MAX_TRACKED_VIOLATIONS) return [];

    let raw: A11yViolation[];
    try {
      raw = await this.scanDom(page);
    } catch {
      // Detached/closed/navigated page — handled by the engine's health gate.
      return [];
    }
    return this.recordNew(raw);
  }

  /**
   * Pure dedup: keep only first-seen (rule, selector) violations, respecting the
   * ledger cap. Extracted from audit() so the accounting is unit-testable without
   * a browser. Returns the newly-recorded subset.
   */
  public recordNew(violations: A11yViolation[]): A11yViolation[] {
    const fresh: A11yViolation[] = [];
    for (const v of violations) {
      if (this.seenViolations.size >= MAX_TRACKED_VIOLATIONS) break;
      const key = `${v.rule}::${v.selector}`;
      if (this.seenViolations.has(key)) continue;
      this.seenViolations.add(key);
      fresh.push(v);
    }
    return fresh;
  }

  /** Total distinct violations recorded this run (for run-summary telemetry). */
  public totalFound(): number {
    return this.seenViolations.size;
  }

  /**
   * Collect WCAG violations from the live DOM. Runs in the browser context; the
   * function body is serialized to the page, so it may only reference in-page
   * globals (document/window) — no closure over auditor state.
   */
  private scanDom(page: Page): Promise<A11yViolation[]> {
    return page.evaluate(() => {
      const out: A11yViolation[] = [];

      // Best-effort, stable-ish selector for an element (id > class chain > tag:nth).
      const selectorFor = (el: Element): string => {
        if (el.id) return `#${CSS.escape(el.id)}`;
        const tag = el.tagName.toLowerCase();
        const cls = (el.getAttribute('class') || '')
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((c) => `.${CSS.escape(c)}`)
          .join('');
        const parent = el.parentElement;
        if (parent) {
          const sameTag = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
          if (sameTag.length > 1) {
            const idx = sameTag.indexOf(el) + 1;
            return `${tag}${cls}:nth-of-type(${idx})`;
          }
        }
        return `${tag}${cls}`;
      };

      const accessibleName = (el: Element): string => {
        const aria = el.getAttribute('aria-label');
        if (aria && aria.trim()) return aria.trim();
        const labelledby = el.getAttribute('aria-labelledby');
        if (labelledby) {
          const ref = labelledby
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent || '')
            .join(' ')
            .trim();
          if (ref) return ref;
        }
        const title = el.getAttribute('title');
        if (title && title.trim()) return title.trim();
        return (el.textContent || '').trim();
      };

      // Operator-facing name: the element's own accessible text when it has one,
      // otherwise a semantic tag descriptor (`<input#email>`) — never a DOM path.
      const nameFor = (el: Element): string => {
        const named = accessibleName(el).replace(/\s+/g, ' ').trim();
        if (named) return named.length > 60 ? `${named.slice(0, 60)}…` : named;
        const tag = el.tagName.toLowerCase();
        if (el.id) return `<${tag}#${el.id}>`;
        const cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean)[0];
        const nameAttr = el.getAttribute('name');
        if (cls) return `<${tag}.${cls}>`;
        return nameAttr ? `<${tag}[${nameAttr}]>` : `<${tag}>`;
      };

      // 1.1.1 Non-text content: <img> missing an alt attribute entirely.
      // (alt="" is valid for decorative images and is intentionally NOT flagged.)
      document.querySelectorAll('img:not([alt])').forEach((el) => {
        out.push({
          rule: 'image-alt',
          wcag: '1.1.1',
          impact: 'serious',
          selector: selectorFor(el),
          elementName: nameFor(el),
          description: 'Image has no alt attribute — screen readers cannot describe it.',
          suggestedFix: 'Add alt text (or alt="" if the image is purely decorative).',
        });
      });

      // 4.1.2 / 3.3.2: form fields with no programmatic label.
      const labelableSel = 'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]),select,textarea';
      document.querySelectorAll(labelableSel).forEach((el) => {
        const id = el.getAttribute('id');
        const hasForLabel = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) !== null : false;
        const wrapped = el.closest('label') !== null;
        const hasName = accessibleName(el).length > 0;
        if (!hasForLabel && !wrapped && !hasName) {
          out.push({
            rule: 'form-label',
            wcag: '4.1.2',
            impact: 'critical',
            selector: selectorFor(el),
            elementName: nameFor(el),
            description: 'Form control has no associated label or accessible name.',
            suggestedFix: 'Add a <label for>, a wrapping <label>, or an aria-label.',
          });
        }
      });

      // 4.1.2: interactive controls with no accessible name.
      document.querySelectorAll('button,a[href],[role=button]').forEach((el) => {
        if (accessibleName(el).length === 0) {
          out.push({
            rule: 'control-name',
            wcag: '4.1.2',
            impact: 'serious',
            selector: selectorFor(el),
            elementName: nameFor(el),
            description: 'Interactive control has no accessible name (empty text, no aria-label/title) — screen-reader users hear only its role.',
            suggestedFix: 'Add visible text, an aria-label, or a title attribute.',
          });
        }
      });

      // 2.4.3: positive tabindex breaks natural focus order.
      document.querySelectorAll('[tabindex]').forEach((el) => {
        const ti = Number(el.getAttribute('tabindex'));
        if (Number.isFinite(ti) && ti > 0) {
          out.push({
            rule: 'tabindex-positive',
            wcag: '2.4.3',
            impact: 'moderate',
            selector: selectorFor(el),
            elementName: nameFor(el),
            description: `tabindex="${ti}" forces a manual focus order that diverges from the DOM.`,
            suggestedFix: 'Use tabindex="0" and restructure the DOM to reflect the intended order.',
          });
        }
      });

      // 4.1.1: duplicate id attributes (invalid; breaks label/aria references).
      const idCounts = new Map<string, number>();
      document.querySelectorAll('[id]').forEach((el) => {
        const id = el.getAttribute('id');
        if (id) idCounts.set(id, (idCounts.get(id) || 0) + 1);
      });
      idCounts.forEach((count, id) => {
        if (count > 1) {
          out.push({
            rule: 'duplicate-id',
            wcag: '4.1.1',
            impact: 'minor',
            selector: `#${CSS.escape(id)}`,
            elementName: `#${id}`,
            description: `id "${id}" is used ${count} times — duplicate ids break label[for]/aria-* references and are invalid HTML.`,
            suggestedFix: 'Make every id unique on the page.',
          });
        }
      });

      // 3.1.1: document language not declared.
      const lang = document.documentElement.getAttribute('lang');
      if (!lang || !lang.trim()) {
        out.push({
          rule: 'html-lang',
          wcag: '3.1.1',
          impact: 'serious',
          selector: 'html',
          elementName: 'the page',
          description: 'Document has no lang attribute — assistive tech cannot pick the right pronunciation.',
          suggestedFix: 'Add a language to the root element, e.g. <html lang="en">.',
        });
      }

      // 2.4.2: page has no title.
      if (!document.title || !document.title.trim()) {
        out.push({
          rule: 'document-title',
          wcag: '2.4.2',
          impact: 'serious',
          selector: '',
          elementName: 'the page',
          description: 'Document has no <title> — users cannot identify the page in tabs/history.',
          suggestedFix: 'Add a concise, descriptive <title>.',
        });
      }

      return out;
    });
  }
}

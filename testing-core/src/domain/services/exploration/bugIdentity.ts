import { createHash } from 'node:crypto';
import type { Page } from 'playwright';
import { normalizeRoutePath } from '../../../ml/domHasher.js';

/**
 * Deterministic finding identity — the single source of truth for `ConfirmedBug.bugId`.
 *
 * Derived from stable fault CONTENT only: never `Date.now()` and never `Math.random()`,
 * both of which bypass the engine's seeded RNG and made every finding's id differ
 * run-to-run. Since `registerConfirmedBug` dedups by id, that defeated "same seed →
 * same forensic bundle" and let a re-observed defect register twice.
 */
export function deriveStableBugId(prefix: string, parts: ReadonlyArray<string | undefined>): string {
  const digest = createHash('sha1')
    .update(parts.map((part) => part ?? '').join('|'))
    .digest('hex')
    .slice(0, 16);
  return `${prefix}-${digest}`;
}

/** Normalized route of a live page, or '' when the page is gone — never throws. */
export function safeRoutePath(page: Page): string {
  try {
    return page.isClosed() ? '' : normalizeRoutePath(page.url());
  } catch {
    return '';
  }
}

import type { Page } from 'playwright';
import type { ScoredElement } from '../heuristics/scorer.js';
import { generatePayloads } from '../payloads/chaosData.js';
import { stripConstraints } from './formBypasser.js';

export async function fuzzTextInput(page: Page, target: ScoredElement, seed: number): Promise<string> {
  const payload = generatePayloads({ element: target, seed })[0] ?? 'BugSafari';
  const locator = page.locator(target.selector).first();

  await stripConstraints(page, target.selector);
  await locator.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => undefined);
  await locator.click({ force: true, timeout: 2500 });
  await locator.fill(payload, { force: true, timeout: 2500 });
  await locator.press('Enter', { timeout: 1500 }).catch(() => undefined);

  return payload;
}

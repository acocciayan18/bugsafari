import type { Page } from 'playwright';
import type { BugFinder } from './types.js';
import type { ScoredElement } from '../heuristics/scorer.js';

import { fuzzTextInput } from '../scenarios/dataFuzzer.js';
import { stripConstraints } from '../scenarios/formBypasser.js';

export type FuzzAttackProfile = 'xss_sql_unicode';

export async function fuzzTextWithAttackSurface(
  page: Page,
  element: ScoredElement,
  step: number,
  options: { profile: FuzzAttackProfile },
): Promise<string> {
  void options;
  // Current engine uses chaosData token mutation. We will expand chaosData next.
  // For now, keep behavior consistent but allow bug finders to choose profiles.
  await stripConstraints(page, element.selector).catch(() => undefined);
  return fuzzTextInput(page, element, step);
}

export async function ensureConstraintsStripped(page: Page, elementSelector: string): Promise<void> {
  await stripConstraints(page, elementSelector).catch(() => undefined);
}

export async function fuzzAndReturnPayload(page: Page, element: ScoredElement, seed: number): Promise<string> {
  return fuzzTextInput(page, element, seed);
}


import type { Page } from 'playwright';
import type { BugFinder } from './types.js';
import type { ScoredElement } from '../domain/heuristics/scorer.js';
import type { InteractiveElement } from '../domain/entities/InteractiveElement.js';

import { fuzzTextInput } from '../domain/scenarios/dataFuzzer.js';
import { stripConstraints } from '../domain/scenarios/formBypasser.js';

export type FuzzAttackProfile = 'xss_sql_unicode';

/**
 * Converts a ScoredElement to InteractiveElement for compatibility with fuzzTextInput.
 */
function toInteractiveElement(element: ScoredElement): InteractiveElement {
  return {
    selector: element.selector,
    id: element.id,
    className: element.className,
    innerText: element.text,
    type: element.type,
    tagName: element.tagName,
    isVisible: element.isVisible,
    isPointer: false,
    featureVector: {},
    riskScore: element.score,
  };
}

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
  return fuzzTextInput(page, toInteractiveElement(element), step);
}

export async function ensureConstraintsStripped(page: Page, elementSelector: string): Promise<void> {
  await stripConstraints(page, elementSelector).catch(() => undefined);
}

export async function fuzzAndReturnPayload(page: Page, element: ScoredElement, seed: number): Promise<string> {
  return fuzzTextInput(page, toInteractiveElement(element), seed);
}


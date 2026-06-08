import type { Page } from 'playwright';
import type { ScoredElement } from '../domain/services/RiskScorer.js';
import type { InteractiveElement } from '../domain/entities/InteractiveElement.js';

import { fuzzTextInput } from '../domain/scenarios/fuzzing/dataFuzzer.js';
import { stripConstraints } from '../domain/scenarios/formBypasser.js';

/**
 * Attack profiles for fuzzing operations.
 * These profiles determine which types of payloads to generate.
 */
export type FuzzAttackProfile = 'xss_sql_unicode';

/** Default attack profile */
const DEFAULT_PROFILE: FuzzAttackProfile = 'xss_sql_unicode';

/**
 * Converts a ScoredElement to InteractiveElement for compatibility with fuzzing scenarios.
 * 
 * @param element - The scored element from RiskScorer
 * @returns InteractiveElement suitable for domain scenarios
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

/**
 * Strips form constraints and fuzzes the element with attack payloads.
 * 
 * @param page - Playwright Page object
 * @param element - Target scored element
 * @param step - Step identifier for payload generation
 * @param options - Attack profile options
 * @returns The injected payload string
 */
export async function fuzzTextWithAttackSurface(
  page: Page,
  element: ScoredElement,
  step: number,
  options: { profile: FuzzAttackProfile } = { profile: DEFAULT_PROFILE },
): Promise<string> {
  const { profile } = options;
  
  // Strip constraints before fuzzing - ignore errors (element may not exist)
  try {
    await stripConstraints(page, element.selector);
  } catch (err) {
    console.warn(`[scenarioAdapters] Failed to strip constraints for ${element.selector}:`, err);
  }
  
  console.log(`[scenarioAdapters] Fuzzing with profile "${profile}" on step ${step}`);
  return fuzzTextInput(page, toInteractiveElement(element), step);
}

/**
 * Strips form constraints from an element without fuzzing.
 * 
 * @param page - Playwright Page object
 * @param elementSelector - CSS selector target
 */
export async function ensureConstraintsStripped(page: Page, elementSelector: string): Promise<void> {
  try {
    await stripConstraints(page, elementSelector);
  } catch (err) {
    console.warn(`[scenarioAdapters] Failed to strip constraints for ${elementSelector}:`, err);
  }
}

/**
 * Fuzzes an element without stripping constraints first.
 * 
 * @param page - Playwright Page object
 * @param element - Target scored element
 * @param seed - Random seed for payload generation
 * @returns The generated payload string
 */
export async function fuzzAndReturnPayload(page: Page, element: ScoredElement, seed: number): Promise<string> {
  return fuzzTextInput(page, toInteractiveElement(element), seed);
}


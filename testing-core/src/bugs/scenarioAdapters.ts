import type { Page } from 'playwright';
import type { InteractiveElement } from '../domain/entities/InteractiveElement.js';

import { fuzzTextInput } from '../domain/scenarios/fuzzing/dataFuzzer.js';
import { stripConstraints } from '../domain/scenarios/formBypasser.js';

import { createLogger } from '../infrastructure/observability/logger.js';

const obsLog = createLogger('[scenarioAdapters]');

/**
 * Attack profiles for fuzzing operations.
 * These profiles determine which types of payloads to generate.
 */
export type FuzzAttackProfile = 'xss_sql_unicode';

/** Default attack profile */
const DEFAULT_PROFILE: FuzzAttackProfile = 'xss_sql_unicode';

/**
 * Strips form constraints and fuzzes the element with attack payloads.
 *
 * @param page - Playwright Page object
 * @param element - Target interactive element
 * @param step - Step identifier for payload generation; doubles as the corpus
 *   cursor so consecutive steps sweep vectors instead of re-firing one.
 * @param options - Attack profile options
 * @returns The injected payload string
 */
export async function fuzzTextWithAttackSurface(
  page: Page,
  element: InteractiveElement,
  step: number,
  options: { profile: FuzzAttackProfile } = { profile: DEFAULT_PROFILE },
): Promise<string> {
  const { profile } = options;

  // Strip constraints before fuzzing - ignore errors (element may not exist)
  try {
    await stripConstraints(page, element.selector);
  } catch (err) {
    obsLog.warn(`[scenarioAdapters] Failed to strip constraints for ${element.selector}:`, err);
  }

  obsLog.info(`[scenarioAdapters] Fuzzing with profile "${profile}" on step ${step}`);
  return fuzzTextInput(page, element, step, step);
}


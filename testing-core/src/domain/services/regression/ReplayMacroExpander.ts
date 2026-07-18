import type { Page } from 'playwright';
import type { ReplayMacro } from '../../../../../shared/types.js';
import { gridCoordinate } from '../../scenarios/rapidClicker/coordinateBombing.js';
import { executeConcurrentBurst } from '../../scenarios/rapidClicker/concurrentBurst.js';
import { rapidHistoryTraversal, safeNavigation } from '../../scenarios/routeTrasher/navigation.js';
import { wait } from '../../scenarios/rapidClicker/utils.js';

/**
 * Re-expands a recorded stress-scenario MACRO into its exact action sequence during
 * regression replay. The deterministic scenarios (CoordinateBombing, RouteTrasher)
 * regenerate literally from their params; ConcurrentSiblingBurst replays from the
 * resolved selectors stored on the macro. This is the single seam where the
 * regression layer reuses scenario primitives.
 */

const COORD_CADENCE_MS = 50;
const HISTORY_TIMEOUT_MS = 1200;

export interface MacroExpandOutcome {
  expanded: number;
  detail?: string;
}

export async function expandReplayMacro(page: Page, macro: ReplayMacro, targetUrl: string): Promise<MacroExpandOutcome> {
  switch (macro.scenario) {
    case 'CoordinateBombing':
      return expandCoordinateBombing(page, macro);
    case 'RouteTrasher':
      return expandRouteTrasher(page, macro, targetUrl);
    case 'ConcurrentSiblingBurst':
      return expandConcurrentBurst(page, macro);
    default:
      return { expanded: 0, detail: `unknown macro scenario "${(macro as ReplayMacro).scenario}"` };
  }
}

// Regenerate the exact deterministic grid from {count,width,height} and fire it.
async function expandCoordinateBombing(page: Page, macro: ReplayMacro): Promise<MacroExpandOutcome> {
  const count = macro.params.count ?? 0;
  const width = macro.params.width ?? page.viewportSize()?.width ?? 1280;
  const height = macro.params.height ?? page.viewportSize()?.height ?? 800;
  let fired = 0;
  for (let i = 0; i < count; i++) {
    const { x, y } = gridCoordinate(i, count, width, height);
    await page.mouse.click(x, y).catch(() => undefined);
    fired += 1;
    await wait(COORD_CADENCE_MS);
  }
  return { expanded: fired };
}

// Re-drive the deterministic history churn + back/forward loop from {repetitions}.
async function expandRouteTrasher(page: Page, macro: ReplayMacro, targetUrl: string): Promise<MacroExpandOutcome> {
  const repetitions = macro.params.repetitions ?? 0;
  let hops = await rapidHistoryTraversal(page, 2, targetUrl);
  for (let i = 0; i < repetitions; i++) {
    if (await safeNavigation(page, 'goBack', HISTORY_TIMEOUT_MS, targetUrl)) hops += 1;
    await wait(COORD_CADENCE_MS);
    if (await safeNavigation(page, 'goForward', HISTORY_TIMEOUT_MS, targetUrl)) hops += 1;
    await wait(COORD_CADENCE_MS);
  }
  return { expanded: hops };
}

// Re-fire the concurrent zero-wait burst across the stored resolved selectors.
async function expandConcurrentBurst(page: Page, macro: ReplayMacro): Promise<MacroExpandOutcome> {
  const selectors = macro.params.selectors ?? [];
  if (selectors.length === 0) return { expanded: 0, detail: 'no selectors recorded' };
  await executeConcurrentBurst(page, selectors);
  return { expanded: selectors.length };
}

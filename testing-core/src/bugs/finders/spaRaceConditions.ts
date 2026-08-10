import type { Page } from 'playwright';
import type { BugFinder, BugContext, BugFinding } from '../types.js';
import type { InteractiveElement } from '../../domain/entities/InteractiveElement.js';
import { FREEZE_SELECTORS, matchesCategory } from '../knowledgeBase/signalPatterns.js';
import { classifyInputElement, isSensitiveInputElement } from '../../domain/scenarios/fuzzing/elementClassifier.js';
import { synthesizeEscalatedPayload, deriveFuzzSeed } from '../../domain/scenarios/fuzzing/payloadEscalator.js';
import { ActionRecorder } from '../../infrastructure/monitoring/actionBuffer.js';
import { ReproductionPlaybookStore } from '../../infrastructure/monitoring/reproductionPlaybookStore.js';
import { nextBurstId } from '../../infrastructure/monitoring/burstCorrelation.js';
import { resolveElementLabel, elementNoun, narrateActionRecords } from '../../domain/services/forensics/narration.js';
import { safeRoutePath } from '../../domain/services/exploration/bugIdentity.js';

// Grace period for the burst's async work to resolve before judging the UI stuck.
const SETTLE_MS = 1500;

/**
 * Result of a concurrent stress test for SPA race conditions.
 */
export interface ConcurrentStressResult {
  attempted: number;
  completed: number;
  // Correlation id of the pre-recorded burst; absent when no target was actuable.
  burstId?: string;
}

/**
 * Fires concurrent UI events to detect race conditions in SPA state management.
 * Tests for race conditions by firing multiple UI events simultaneously.
 * 
 * @param page Playwright Page object
 * @param step Current testing step
 * @returns Promise resolving to ConcurrentStressResult with attempted/completed counts
 */
export async function burstConcurrentStress(
  page: Page,
  step: number,
  rankedTargets?: readonly InteractiveElement[],
): Promise<ConcurrentStressResult> {
  const maxConcurrent = 5;
  const maxInputs = 3;

  // Targets come from the loop's ranked set (audit P3-10). Re-querying the DOM
  // force-clicked whatever was first in the document — bypassing the session guard
  // that the loop uses to veto Sign-out on an authenticated run, and bypassing the
  // parser's overlay reasoning so occluded controls were actuated too.
  const candidates = (rankedTargets ?? []).filter((element) => element.selector);
  if (candidates.length === 0) {
    return { attempted: 0, completed: 0 };
  }

  const clickable = candidates.filter((element) => !isFillableInput(element)).slice(0, maxConcurrent);
  const fillable = candidates.filter(isFillableInput).slice(0, maxInputs);

  // One id ties every intended action of this burst together. Log the INTENT of each
  // action BEFORE firing so a crash mid-burst still leaves a reproduction trail — the
  // finding used to arrive with none because the burst was never recorded (audit).
  const burstId = nextBurstId();
  const url = page.url();
  const promises: Promise<boolean>[] = [];

  for (const element of clickable) {
    ActionRecorder.recordStep({
      actionType: 'CLICK',
      humanIdentifier: resolveElementLabel(element),
      elementKind: elementNoun(element.tagName, element.type),
      selector: element.selector,
      url,
      burstId,
    });
    promises.push(
      page
        .locator(element.selector)
        .first()
        .click({ force: true, noWaitAfter: true, timeout: 500 })
        .then(() => true)
        .catch(() => false),
    );
  }

  // Seeded, replayable values — Math.random() broke the seeded-run guarantee the
  // rest of the engine maintains (EdgeSelector.nextRandom / deriveFuzzSeed).
  for (const element of fillable) {
    const category = classifyInputElement(element);
    const value = synthesizeEscalatedPayload(
      category,
      0,
      deriveFuzzSeed(`race:${element.selector}:${step}`, category),
    ).value;
    ActionRecorder.recordStep({
      actionType: 'TYPE',
      humanIdentifier: resolveElementLabel(element),
      elementKind: elementNoun(element.tagName, element.type),
      selector: element.selector,
      url,
      value,
      redactValue: isSensitiveInputElement(element),
      burstId,
    });
    promises.push(
      page
        .locator(element.selector)
        .first()
        .fill(value, { timeout: 500 })
        .then(() => true)
        .catch(() => false),
    );
  }

  const results = await Promise.all(promises);

  return {
    attempted: promises.length,
    completed: results.filter(Boolean).length,
    burstId,
  };
}

/** Text-ish inputs the burst types into rather than clicks. */
function isFillableInput(element: InteractiveElement): boolean {
  const tag = element.tagName?.toLowerCase() ?? '';
  const type = element.type?.toLowerCase() ?? '';
  if (tag === 'textarea') return true;
  if (tag !== 'input') return false;
  return !['hidden', 'submit', 'button', 'checkbox', 'radio', 'file', 'image', 'reset'].includes(type);
}

/** Post-burst damage signals: a crash, a leaked error surface, or a stuck loader. */
interface BurstDamage {
  crashes: string[];
  stuckLoading: boolean;
}

async function isStuckLoading(page: Page): Promise<boolean> {
  try {
    return await page.evaluate(
      (selectors: string[]) => selectors.some((selector) => document.querySelector(selector) !== null),
      [...FREEZE_SELECTORS],
    );
  } catch {
    return false;
  }
}

export const spaRaceConditionsFinder: BugFinder = {
  bugClass: 'SPA_STATE_RACE_CONDITION',
  testingType: 'asyncRace',

  async isApplicable(_ctx: Omit<BugContext, 'crashHalted'>): Promise<boolean> {
    return true;
  },

  /**
   * Fires a concurrent event burst and reports ONLY when the app fails to absorb it:
   * a new client crash, or a loading state still stuck once the burst settles.
   * Clicks merely succeeding is the healthy case, not a race.
   */
  async run(ctx: BugContext): Promise<BugFinding[]> {
    const damage: BurstDamage = { crashes: [], stuckLoading: false };

    const onPageError = (err: Error): void => {
      if (damage.crashes.length < 3) damage.crashes.push(err.message.slice(0, 200));
    };
    const onConsole = (message: { type(): string; text(): string }): void => {
      if (message.type() !== 'error') return;
      const text = message.text();
      if (damage.crashes.length < 3 && matchesCategory('CLIENT_CRASH', text)) {
        damage.crashes.push(text.slice(0, 200));
      }
    };

    const wasStuckBefore = await isStuckLoading(ctx.page);
    // The burst can navigate the page away mid-step. Left uncorrected, the loop's
    // confirmed child hash and the next parse describe different places — graph
    // corruption attributable to this finder (audit P3-10).
    const urlBefore = ctx.page.url();
    ctx.page.on('pageerror', onPageError);
    ctx.page.on('console', onConsole);

    let result: ConcurrentStressResult;
    try {
      result = await burstConcurrentStress(ctx.page, ctx.step, ctx.rankedTargets);
      await ctx.page.waitForTimeout(SETTLE_MS);
      // Only a loader that appeared during the burst is evidence — a spinner that was
      // already there belongs to whatever was in flight before we touched anything.
      damage.stuckLoading = !wasStuckBefore && (await isStuckLoading(ctx.page));
    } finally {
      ctx.page.off('pageerror', onPageError);
      ctx.page.off('console', onConsole);
      if (ctx.page.url() !== urlBefore) {
        await ctx.page
          .goto(urlBefore, { waitUntil: 'domcontentloaded', timeout: 5000 })
          .catch(() => undefined);
      }
    }

    if (damage.crashes.length === 0 && !damage.stuckLoading) return [];

    const detail = damage.crashes.length > 0
      ? `The page crashed during the burst of events: ${damage.crashes.join(' | ')}`
      : 'The page stayed stuck in a loading or blocked state after the burst finished';

    // Reproduction from the burst's own pre-recorded intents (filtered by its id, so it
    // can never inherit an unrelated scenario's steps). The narrative and the replayable
    // actions describe the same sequence a developer must fire to reproduce the race.
    const burstActions = result.burstId
      ? ReproductionPlaybookStore.snapshot().filter((action) => action.burstId === result.burstId)
      : [];
    const reproductionPlaybook = burstActions.length > 0
      ? narrateActionRecords(burstActions)
      : [`Step 1. On ${safeRoutePath(ctx.page) || urlBefore}, fire ${result.attempted} overlapping UI events (rapid concurrent clicks/inputs) at once and observe the app fail to settle.`];

    return [
      {
        bugClass: 'SPA_STATE_RACE_CONDITION',
        title: 'Overlapping events left the page in a bad state',
        severity: damage.crashes.length > 0 ? 'HIGH' : 'MEDIUM',
        evidence: {
          message: `${detail}. ${result.completed} of ${result.attempted} overlapping events fired at once.`,
          actionExecuted: 'spa-race-concurrent-events',
          stateHash: ctx.stateHash,
          reproductionPlaybook,
          reproductionActions: burstActions.length > 0 ? burstActions : undefined,
        },
      },
    ];
  },
};


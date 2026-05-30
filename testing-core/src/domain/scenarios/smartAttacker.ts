import type { Page } from 'playwright';
import type { ScoredElement } from '../../domain/services/RiskScorer.js';
import type { ActionRecorder } from '../../infrastructure/monitoring/actionBuffer.js';
import type { InteractiveElement } from '../../domain/entities/InteractiveElement.js';
import { fuzzTextInput } from './dataFuzzer.js';
import { executeSpam } from './rapidClickerStress.js';

export interface SmartActionResult {
  actionExecuted: string;
  selector: string;
  payload?: string;
}

export async function smartActionChain(
  page: Page,
  targets: ScoredElement[],
  seed: number,
  actionRecorder?: ActionRecorder,
): Promise<SmartActionResult | null> {
  const inputTarget = targets.find((target) =>
    ['input', 'textarea', 'select'].includes(target.tagName) || target.semanticRole === 'INPUT',
  );

  if (inputTarget) {
    const payload = await fuzzTextInput(page, inputTarget as unknown as InteractiveElement, seed);
    actionRecorder?.record({
      type: 'INPUT',
      selector: inputTarget.selector,
      url: page.url(),
      payload,
      fallbackLabel: inputTarget.text || inputTarget.name || inputTarget.id,
    });
    return {
      actionExecuted: 'fuzz-input',
      selector: inputTarget.selector,
      payload,
    };
  }

  const clickableTarget = targets.find((target) => ['button', 'a'].includes(target.tagName) || target.role === 'button');

  if (clickableTarget) {
    await executeSpam(page, clickableTarget.selector);
    actionRecorder?.record({
      type: 'CLICK',
      selector: clickableTarget.selector,
      url: page.url(),
      fallbackLabel: clickableTarget.text || clickableTarget.name || clickableTarget.id,
    });
    return {
      actionExecuted: 'rapid-fire-click',
      selector: clickableTarget.selector,
    };
  }

  return null;
}

import type { Page } from 'playwright';
import { concurrentEventSpam } from '../../domain/scenarios/rapidClickerStress.js';
import { routeTrasher } from '../../domain/scenarios/routeTrasher.js';

export interface ConcurrentStressResult {
  attempted: number;
  completed: number;
}

export async function burstConcurrentStress(page: Page, step: number): Promise<ConcurrentStressResult> {
  void step;
  const a = await concurrentEventSpam(page, 12);
  const b = await routeTrasher.execute(page, 1);

  return {
    attempted: a.attempted + b.attempted,
    completed: a.completed + b.completed,
  };
}

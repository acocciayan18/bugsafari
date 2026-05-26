import type { Page } from 'playwright';

export interface StructuralProbeResult {
  detected: boolean;
  details: string;
}

export async function probeStructuralNavigation(page: Page, step: number): Promise<StructuralProbeResult> {
  void step;

  const beforeUrl = page.url();
  const beforeText = await page.evaluate(() => document.body?.innerText?.slice(0, 200) ?? '');

  // Simple probe: rapid back/forward/reload to shake navigation state.
  try {
    await page.goBack({ waitUntil: 'domcontentloaded', timeout: 1200 });
  } catch {
    // ignore
  }
  try {
    await page.goForward({ waitUntil: 'domcontentloaded', timeout: 1200 });
  } catch {
    // ignore
  }

  const afterUrl = page.url();
  const afterText = await page.evaluate(() => document.body?.innerText?.slice(0, 200) ?? '');

  const changed = beforeUrl !== afterUrl || beforeText !== afterText;

  return {
    detected: !changed,
    details: changed ? 'DOM/URL changed normally.' : 'Possible dead-end or loop-like behavior: no observable change after navigation probe.',
  };
}


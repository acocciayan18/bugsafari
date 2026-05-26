import type { Page } from 'playwright';

export interface BoundaryOverloadResult {
  unresponsive: boolean;
  durationMs: number;
  attempted: number;
}

function zalgoish(input: string): string {
  const combining = ['\u0300', '\u0301', '\u0302', '\u0303', '\u0304', '\u0305', '\u0306', '\u0307', '\u0308'];
  let out = '';
  for (let i = 0; i < input.length; i += 1) {
    out += input[i];
    const count = i % 3 === 0 ? 2 : 1;
    for (let j = 0; j < count; j += 1) {
      out += combining[(i + j) % combining.length];
    }
  }
  return out;
}

export async function boundaryOverloadProbe(page: Page, step: number): Promise<BoundaryOverloadResult> {
  const startedAt = Date.now();
  const longLen = step % 2 === 0 ? 8000 : 20000;
  const text = `${'B'.repeat(longLen)}${zalgoish('BUGSAFARI')}`;

  // Attempt to overload by targeting common input elements if present.
  const selector = 'input[type="text"], textarea, input:not([type="hidden"])';
  const locator = page.locator(selector).first();

  let attempted = 0;
  try {
    if (await locator.count()) {
      attempted = 1;
      await locator.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => undefined);
      await locator.click({ force: true, timeout: 2000 }).catch(() => undefined);
      await locator.fill(text.slice(0, 120000), { force: true, timeout: 5000 }).catch(() => undefined);
    }
  } catch {
    // ignore; probe is best-effort.
  }

  // Event-loop starvation proxy: check if we can still run a quick evaluation.
  const pingStarted = Date.now();
  try {
    await page.waitForFunction(() => document.readyState === 'complete' || document.readyState === 'interactive', {
      timeout: 1500,
    });
  } catch {
    // ignore
  }
  const pingDuration = Date.now() - pingStarted;

  const unresponsive = pingDuration > 1200;
  return {
    unresponsive,
    durationMs: Date.now() - startedAt,
    attempted,
  };
}


// Parser payload bounds on a pathological page: a huge-text control plus thousands of
// anchors otherwise serialize an unbounded, full-text element array across the CDP
// boundary each parse (re-run several times per step). scanInteractiveElements must cap
// per-element text (MAX_ELEMENT_TEXT=512) and the working set (MAX_SCAN_ELEMENTS=4000).
// Needs a real Chromium, so run inside the engine container (browsers at /ms-playwright):
//   podman exec bugsafari-api sh -c "cd /app/testing-core && npx tsx src/domain/heuristics/domParser.payloadCap.test.ts"

import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { scanInteractiveElements } from './domParser.js';

const MAX_ELEMENT_TEXT = 512; // must match domParser.ts
const MAX_SCAN_ELEMENTS = 4000; // must match domParser.ts
const ANCHORS = 5000; // enough that the survivors would exceed the cap without the slice
const LONG_TEXT_LEN = 5000; // > MAX_ELEMENT_TEXT so the text cap must engage

function pathologicalHtml(): string {
  const longText = 'x'.repeat(LONG_TEXT_LEN);
  const link = `<a id="longtext" href="#" style="display:block;width:120px;height:20px;overflow:hidden;white-space:nowrap">${longText}</a>`;
  let anchors = '';
  for (let i = 0; i < ANCHORS; i++) anchors += `<a href="#a${i}">link ${i}</a>`;
  return `<!doctype html><body>${link}${anchors}</body>`;
}

async function main(): Promise<void> {
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  } catch {
    console.log('⚠ skipped: no Chromium available — run inside the engine container (browsers at /ms-playwright)');
    return;
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.setContent(pathologicalHtml(), { waitUntil: 'domcontentloaded' });

  const result = await scanInteractiveElements(page);
  await browser.close();

  let passed = 0;
  const check = (name: string, cond: boolean, extra = ''): void => {
    assert.ok(cond, `${name} ${extra}`);
    passed += 1;
    console.log(`  ✓ ${name}`);
  };

  console.log('domParser — payload caps on a pathological page');

  check('the page really exceeds the element cap (so the cap must engage)',
    result.totalMatched > MAX_SCAN_ELEMENTS, `totalMatched=${result.totalMatched}`);

  check('returned element count is bounded by MAX_SCAN_ELEMENTS',
    result.elements.length <= MAX_SCAN_ELEMENTS, `got ${result.elements.length}`);

  const longest = result.elements.reduce((m, e) => Math.max(m, e.text.length), 0);
  check('no returned element carries text beyond MAX_ELEMENT_TEXT',
    longest <= MAX_ELEMENT_TEXT, `longest=${longest}`);

  const longEl = result.elements.find((e) => e.id === 'longtext');
  check('the huge-text control survived and its text was truncated to the cap',
    !!longEl && longEl.text.length === MAX_ELEMENT_TEXT, longEl ? `len=${longEl.text.length}` : 'not found');

  console.log(`\ndomParser payload caps: ${passed}/4 checks passed.`);
}

void main();

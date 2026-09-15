// domSnapshot — field-level DOM capture for volatility diffing. Complements DomHasher:
// the hasher normalizes structure and folds volatile content away, this keeps the visible
// text and dynamic-prone attributes so the volatility model can tell a real change from a
// clock/token/nonce. Keyed by a positional DFS path that is stable between two captures of
// the same DOM. Bounded and best-effort — a wedged/closed page yields an empty map.

import type { Page } from 'playwright';

const MAX_NODES = 1500;
const EVAL_TIMEOUT_MS = 2500;

// Capture visible text + dynamic-prone attributes as a path->value map.
export async function captureDomPaths(page: Page): Promise<Map<string, string>> {
  try {
    const entries = await withTimeout(page.evaluate(collectDomPaths, MAX_NODES), EVAL_TIMEOUT_MS);
    return new Map(entries);
  } catch {
    return new Map();
  }
}

// Runs in the page context; returns [path, value] pairs.
function collectDomPaths(maxNodes: number): [string, string][] {
  const out: [string, string][] = [];
  const attrs = ['value', 'title', 'datetime', 'aria-valuenow', 'aria-label'];
  const walk = (el: Element, path: string): void => {
    if (out.length >= maxNodes) return;
    let ownText = '';
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === 3) ownText += node.textContent ?? '';
    }
    ownText = ownText.replace(/\s+/g, ' ').trim();
    if (ownText) out.push([`${path}#t`, ownText]);
    for (const name of attrs) {
      const v = el.getAttribute(name);
      if (v) out.push([`${path}#${name}`, v]);
    }
    let i = 0;
    for (const child of Array.from(el.children)) {
      if (out.length >= maxNodes) return;
      walk(child, `${path}/${i}:${child.tagName}`);
      i += 1;
    }
  };
  if (document.body) walk(document.body, 'body');
  return out;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race<T>([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`domSnapshot timed out after ${timeoutMs}ms`)), timeoutMs)),
  ]);
}

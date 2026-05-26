import crypto from 'node:crypto';
import type { Page } from 'playwright';

export interface DomHashState {
  hash: string;
  visits: number;
}

export class DomHasher {
  private readonly visits = new Map<string, number>();

  public async capture(page: Page): Promise<DomHashState> {
    const normalizedDom = await page.evaluate(() => {
      const clone = document.body.cloneNode(true) as HTMLElement;

      const transientAttrs = [
        'style',
        'value',
        'data-reactroot',
        'data-reactid',
        'aria-busy',
        'data-testid',
      ];

      const walker = document.createTreeWalker(clone, NodeFilter.SHOW_ELEMENT);
      let node = walker.nextNode() as HTMLElement | null;

      while (node) {
        for (const attr of transientAttrs) {
          node.removeAttribute(attr);
        }

        const datasetKeys = Object.keys(node.dataset ?? {});
        for (const key of datasetKeys) {
          if (key.startsWith('react') || key.startsWith('v')) {
            delete node.dataset[key];
          }
        }

        node = walker.nextNode() as HTMLElement | null;
      }

      return clone.innerHTML.replace(/\s+/g, ' ').trim();
    });

    const hash = crypto.createHash('sha256').update(normalizedDom).digest('hex');
    const visits = (this.visits.get(hash) ?? 0) + 1;
    this.visits.set(hash, visits);

    return { hash, visits };
  }
}

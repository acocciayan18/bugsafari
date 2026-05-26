import type { Page } from 'playwright';
import type { InteractiveElement } from '../entities/InteractiveElement.js';

interface RawDomElement {
  selector: string;
  id: string;
  className: string;
  innerText: string;
  type: string;
  tagName: string;
  isVisible: boolean;
  isPointer: boolean;
}

export class RecursiveDomParser {
  public async parse(page: Page): Promise<InteractiveElement[]> {
    const rawElements: RawDomElement[] = await page.evaluate((): RawDomElement[] => {
      const interactive = new Set<Element>();
      const byTag = document.querySelectorAll('button, input, a, select');
      const allNodes = document.querySelectorAll('*');

      for (const node of byTag) {
        interactive.add(node);
      }

      for (const node of allNodes) {
        const style = window.getComputedStyle(node);
        if (style.cursor === 'pointer') {
          interactive.add(node);
        }
      }

      const results: RawDomElement[] = [];

      for (const element of interactive) {
        const html = element as HTMLElement;
        const style = window.getComputedStyle(html);
        const rect = html.getBoundingClientRect();

        const visible =
          rect.width > 3 &&
          rect.height > 3 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity) > 0;

        const clickableContainer = rect.width * rect.height <= 320000;
        if (!visible || !clickableContainer) {
          continue;
        }

        const selector = buildSelector(html);
        const text = (html.innerText ?? '').trim().slice(0, 180);
        results.push({
          selector,
          id: html.id ?? '',
          className: html.className ?? '',
          innerText: text,
          type: (html as HTMLInputElement).type ?? '',
          tagName: html.tagName.toLowerCase(),
          isVisible: visible,
          isPointer: style.cursor === 'pointer',
        });
      }

      return results;

      function buildSelector(element: HTMLElement): string {
        if (element.id) {
          return `#${CSS.escape(element.id)}`;
        }

        const dataTestId = element.getAttribute('data-testid');
        if (dataTestId) {
          return `[data-testid="${CSS.escape(dataTestId)}"]`;
        }

        const inputName = (element as HTMLInputElement).name;
        if (inputName) {
          return `${element.tagName.toLowerCase()}[name="${CSS.escape(inputName)}"]`;
        }

        const classList = [...element.classList].filter((value) => value && !value.includes(':'));
        if (classList.length > 0) {
          return `${element.tagName.toLowerCase()}.${CSS.escape(classList[0] ?? '')}`;
        }

        return element.tagName.toLowerCase();
      }
    });

    return rawElements.map((entry: RawDomElement) => ({
      ...entry,
      featureVector: {},
      riskScore: 0,
    }));
  }
}

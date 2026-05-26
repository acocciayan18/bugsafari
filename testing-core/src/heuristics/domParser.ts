import type { Page } from 'playwright';
import type { BoundingBox } from '../contracts.js';

export interface ParsedElement {
  tagName: string;
  id: string;
  className: string;
  type: string;
  name: string;
  text: string;
  selector: string;
  role: string;
  href: string;
  isDisabled: boolean;
  boundingBox: BoundingBox;
  featureSignature: string;
}

export async function scanInteractiveElements(page: Page): Promise<ParsedElement[]> {
  // We MUST use a string here so the 'tsx' compiler doesn't inject '__name' helpers 
  // that crash the headless browser context.
  // CHANGED: Upgraded to an async IIFE to support the new Visual Stability await
  return page.evaluate<ParsedElement[]>(`
    (async () => {
      // 4. THE "LOADING STATE" RACE CONDITION FIX (Visual Stability Check)
      // Waits until the DOM node count stops changing for at least 200ms before taking a snapshot
      await new Promise((resolve) => {
        let lastCount = -1;
        let stableTime = 0;
        const interval = setInterval(() => {
          const currentCount = document.querySelectorAll('*').length;
          if (currentCount === lastCount) {
            stableTime += 50;
            if (stableTime >= 200) {
              clearInterval(interval);
              resolve();
            }
          } else {
            lastCount = currentCount;
            stableTime = 0;
          }
        }, 50);
      });

      const query = [
        'button',
        'input:not([type="hidden"])',
        'textarea',
        'select',
        'a[href]',
        '[role="button"]',
        '[role="link"]',
        '[tabindex]:not([tabindex="-1"])'
      ].join(',');

      const escapeAttribute = (value) => value.replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"');

      const nthOfTypeSelector = (element) => {
        const parts = [];
        let current = element;

        while (current && current.tagName && current.tagName.toLowerCase() !== 'body') {
          const tag = current.tagName.toLowerCase();
          const parent = current.parentElement;
          if (!parent) break; // Break if we hit a shadow root or detached node

          const siblings = Array.from(parent.children).filter(
            (sibling) => sibling.tagName && sibling.tagName.toLowerCase() === tag
          );
          const index = siblings.indexOf(current) + 1;
          parts.unshift(tag + ':nth-of-type(' + index + ')');
          current = parent;
        }

        return 'body > ' + parts.join(' > ');
      };

      const buildSelector = (element) => {
        const id = element.getAttribute('id');
        const testId = element.getAttribute('data-testid');
        const name = element.getAttribute('name');
        if (id) return '#' + CSS.escape(id);
        if (testId) return '[data-testid="' + escapeAttribute(testId) + '"]';
        if (name) return element.tagName.toLowerCase() + '[name="' + escapeAttribute(name) + '"]';
        return nthOfTypeSelector(element);
      };

      const extractText = (element) => {
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
          return element.value || element.placeholder || element.getAttribute('aria-label') || '';
        }
        if (element instanceof HTMLSelectElement) {
          return (element.selectedOptions[0] && element.selectedOptions[0].textContent
            ? element.selectedOptions[0].textContent.trim()
            : element.getAttribute('aria-label')) || '';
        }
        return element.textContent ? element.textContent.replace(/\\s+/g, ' ').trim() : '';
      };

      const isDisabled = (element) => {
        if (
          element instanceof HTMLButtonElement ||
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement ||
          element instanceof HTMLSelectElement
        ) {
          return element.disabled;
        }
        return element.getAttribute('aria-disabled') === 'true' || element.hasAttribute('disabled');
      };

      // 1. THE SHADOW DOM TRAP & 3. THE IFRAME BLIND SPOT FIX
      // Recursively collect elements crossing shadow boundaries and cross-origin iframes
      const rawElementsSet = new Set();
      
      const collectElements = (root) => {
        // Collect matches in current root
        if (root.querySelectorAll) {
          Array.from(root.querySelectorAll(query)).forEach(el => rawElementsSet.add(el));
        }

        const children = root.children || root.childNodes || [];
        for (const child of children) {
          // Pierce Shadow DOM
          if (child.shadowRoot) {
            collectElements(child.shadowRoot);
          }
          
          // Pierce iFrames
          if (child.tagName === 'IFRAME' || child.tagName === 'FRAME') {
            try {
              if (child.contentDocument) {
                collectElements(child.contentDocument);
              }
            } catch (e) {
              // Ignore cross-origin frame blocking
            }
          }
          
          collectElements(child);
        }
      };

      collectElements(document);
      const rawElements = Array.from(rawElementsSet);
      
      // IMPROVED VISIBILITY & 2. THE HIDDEN OVERLAY (Z-INDEX) BLOCK FIX
      const candidates = rawElements.filter(el => {
        const rect = el.getBoundingClientRect();
        
        // Skip elements with no physical dimensions
        if (rect.width === 0 || rect.height === 0) return false;

        // Z-Index / Overlay Check: Grab the center point
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        
        // Get the actual document this element lives in (fixes iframe coordinates)
        const doc = el.ownerDocument || document;
        const topElement = doc.elementFromPoint(centerX, centerY);

        // If the top element isn't our target (or a parent/child), it is covered by an overlay!
        if (topElement && !el.contains(topElement) && !topElement.contains(el)) {
          return false; 
        }

        return true;
      });

      // Anti-Weight Expansion Filter
      const specificElements = candidates.filter(parent => {
        const hasInteractiveChild = candidates.some(child => 
          parent !== child && parent.contains(child)
        );
        return !hasInteractiveChild; 
      });

      return specificElements.map((element) => {
        const rect = element.getBoundingClientRect();
        const tagName = element.tagName.toLowerCase();
        const id = element.getAttribute('id') || '';
        const className = element.getAttribute('class') || '';
        const type = element.getAttribute('type') || '';
        const name = element.getAttribute('name') || '';
        const text = extractText(element).slice(0, 160);
        const role = element.getAttribute('role') || '';
        const href = element instanceof HTMLAnchorElement ? element.href : '';
        
        // Stable Hash Signature
        const featureSignature = [tagName, type, role, name, text, className]
          .join('|')
          .toLowerCase()
          .replace(/\\s+/g, '-')
          .slice(0, 240);

        return {
          tagName,
          id,
          className,
          type,
          name,
          text,
          selector: buildSelector(element),
          role,
          href,
          isDisabled: isDisabled(element),
          boundingBox: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height
          },
          featureSignature
        };
      });
    })();
  `);
}
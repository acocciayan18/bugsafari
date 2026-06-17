import type { Page } from 'playwright';
import type { BoundingBox } from '@bugsafari/shared';
import type { InteractiveElement } from '../entities/InteractiveElement.js';

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

/**
 * Backward-compatible wrapper class that provides the same interface as the removed RecursiveDomParser.
 * Uses the advanced scanInteractiveElements() which supports Shadow DOM, IFrames, and Z-index overlay checks.
 */
export class RecursiveDomParser {
  public async parse(page: Page): Promise<InteractiveElement[]> {
    const parsedElements = await scanInteractiveElements(page);
    
    return parsedElements.map((element) => ({
      selector: element.selector,
      id: element.id,
      className: element.className,
      innerText: element.text,
      type: element.type,
      tagName: element.tagName,
      isVisible: element.boundingBox.width > 0 && element.boundingBox.height > 0,
      isPointer: false, // Not computed in advanced parser, but can be added if needed
      featureVector: {},
      riskScore: 0,
      // Explicit spatial coordinates captured after layout stabilization
      boundingBox: element.boundingBox,
    }));
  }
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

      /**
       * Compute SHA-256 hash of text using Web Crypto API.
       * Returns a deterministic hex string of the hash.
       */
      const computeTextHash = async (text) => {
        const encoder = new TextEncoder();
        const data = encoder.encode(text);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
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

      /**
       * Check if element is clickable via computed CSS styles.
       * Uses window.getComputedStyle() to inspect actual layout properties.
       * Filters out elements with pointer-events: none, opacity <= 0.05, visibility: hidden, or display: none.
       */
      const isElementClickable = (element) => {
        const style = window.getComputedStyle(element);
        
        // Check pointer-events - if set to 'none', element ignores all mouse/pointer events
        if (style.pointerEvents === 'none') return false;
        
        // Check opacity (<= 0.05 threshold) - element is fully or nearly transparent/invisible
        const opacity = parseFloat(style.opacity);
        if (!isNaN(opacity) && opacity <= 0.05) return false;
        
        // Check visibility - hidden elements are not interactable
        if (style.visibility === 'hidden') return false;
        
        // Check display - removed from layout flow
        if (style.display === 'none') return false;
        
        // Check visibility: collapse - hidden and removed from layout
        if (style.visibility === 'collapse') return false;
        
        return true;
      };

      /**
       * Filter volatile, dynamic CSS utility classes that change on state (hover/focus/active).
       * This prevents state tracking corruption in ML perceptron loops when Tailwind-like
       * frameworks alter utility classes on layout hover/focus changes.
       */
      const filterVolatileClasses = (className) => {
        if (!className) return '';
        
        const classes = className.split(/\s+/);
        // Patterns that indicate volatile/state-dependent classes
        const volatilePrefixes = [
          'hover:', 'focus:', 'active:', 'focus-within:', 'focus-visible:',
          'group-hover:', 'group-focus:', 'group-active:',
          'dark:', // Dark mode
          'sm:', 'md:', 'lg:', 'xl:', '2xl:', // Responsive breakpoints
          'motion-reduce:', 'motion-safe:',
          'first:', 'last:', 'first-child:', 'last-child:', 'odd:', 'even:',
          'peer:', // Tailwind peer
        ];
        const volatilePatterns = [
          /^is-/, /^is[A-Z]/, // e.g., is-active, isSelected
          /^active$/, /^selected$/, // State class names
          /^disabled$/,
          /^readonly$/,
          /^checked$/,
        ];
        
        const stable = classes.filter(cls => {
          // Skip empty strings
          if (!cls) return false;
          
          // Check volatile prefixes
          for (const prefix of volatilePrefixes) {
            if (cls.startsWith(prefix)) return false;
          }
          
          // Check volatile patterns
          for (const pattern of volatilePatterns) {
            if (pattern.test(cls)) return false;
          }
          
          // Skip arbitrary values like [color:red] or [p-4]
          if (cls.startsWith('[') && cls.endsWith(']')) return false;
          
          return true;
        });
        
        // Limit to max 8 stable classes to keep signature compact
        return stable.slice(0, 8).join(' ');
      };

// Maximum traversal depth to prevent infinite recursion on pathological DOMs
      const MAX_TRAVERSE_DEPTH = 50;
      
      // Helper to access both open and closed shadow roots
      // Chrome exposes openOrClosedShadowRoot which returns shadow root regardless of mode
      const getShadowRoot = (element) => {
        try {
          // First try standard open shadow root
          if (element.shadowRoot) return element.shadowRoot;
          
          // Try to access closed shadow root via Chrome's internal property
          // This works within page.evaluate() context
          if (element.openOrClosedShadowRoot) return element.openOrClosedShadowRoot;
          
          return null;
        } catch (e) {
          return null;
        }
      };
      
      // Deep recursive traversal - treats shadow boundary crossing as PRIMARY operation
      // This is a pure recursive pattern, not iterative with recursion
      const deepTraverse = (root, depth = 0, path = 'document') => {
        const results = [];
        
        // Safety check: prevent infinite recursion
        if (depth > MAX_TRAVERSE_DEPTH) {
          console.warn('[domParser] Max traversal depth reached at:', path);
          return results;
        }
        
        // 1. Collect interactive elements from current context
        if (root.querySelectorAll) {
          try {
            const elements = Array.from(root.querySelectorAll(query));
            for (const el of elements) {
              results.push({ element: el, depth, path });
            }
          } catch (e) {
            // Ignore query errors in certain contexts
          }
        }
        
        // 2. Recursively traverse into boundaries (PRIMARY operation)
        const children = root.children || [];
        for (const child of children) {
          const tag = (child.tagName || '').toLowerCase();
          
          // Handle Shadow DOM - both open AND closed (PRIMARY boundary handling)
          const shadowRoot = getShadowRoot(child);
          if (shadowRoot) {
            try {
              results.push(...deepTraverse(shadowRoot, depth + 1, path + ' > shadow-root'));
            } catch (e) {
              // Error-isolate each shadow boundary crossing
            }
            continue;
          }
          
          // Handle iframes
          if (tag === 'iframe' || tag === 'frame') {
            try {
              if (child.contentDocument) {
                results.push(...deepTraverse(child.contentDocument, depth + 1, path + ' > iframe'));
              }
            } catch (e) {
              // Ignore cross-origin frame blocking
            }
            continue;
          }
          
          // Continue recursion for nested elements in light DOM
          if (depth < MAX_TRAVERSE_DEPTH) {
            try {
              results.push(...deepTraverse(child, depth, path));
            } catch (e) {
              // Error-isolate each element traversal
            }
          }
        }
        
        return results;
      };
      
      // Execute deep recursive traversal starting from document
      const rawElements = deepTraverse(document);
      
// IMPROVED VISIBILITY & 2. THE HIDDEN OVERLAY (Z-INDEX) BLOCK FIX
      const candidates = rawElements.filter(el => {
        const rect = el.getBoundingClientRect();
        
        // Skip elements with no physical dimensions
        if (rect.width === 0 || rect.height === 0) return false;

        // Check computed CSS style visibility properties using window.getComputedStyle()
        // Filters out pointer-events: none, opacity <= 0.05, visibility: hidden, display: none
        if (!isElementClickable(el)) return false;

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

      // First pass: collect elements with their extracted text (no slicing)
      const elementData = specificElements.map((element) => {
        const rect = element.getBoundingClientRect();
        const tagName = element.tagName.toLowerCase();
        const id = element.getAttribute('id') || '';
        const className = element.getAttribute('class') || '';
        const type = element.getAttribute('type') || '';
        const name = element.getAttribute('name') || '';
        // Use full text - no more slice(0, 160) truncation
        const fullText = extractText(element);
        const role = element.getAttribute('role') || '';
        const href = element instanceof HTMLAnchorElement ? element.href : '';
        
        return {
          element,
          tagName,
          id,
          className,
          type,
          name,
          fullText,
          role,
          href,
          isDisabled: isDisabled(element),
          boundingBox: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height
          }
        };
      });

      // Second pass: compute SHA-256 hashes in parallel
      const textHashes = await Promise.all(
        elementData.map(async (data) => {
          // Hash the full text content for unique signature
          return computeTextHash(data.fullText);
        })
      );

      // Third pass: build final results with hashes
      return elementData.map((data, index) => {
        const stableClassName = filterVolatileClasses(data.className);
        // Use the computed hash instead of truncated text
        const textHash = textHashes[index];
        const featureSignature = [data.tagName, data.type, data.role, data.name, textHash, stableClassName]
          .join('|')
          .toLowerCase()
          .replace(/\\s+/g, '-')
          .slice(0, 256);

        return {
          tagName: data.tagName,
          id: data.id,
          className: data.className,
          type: data.type,
          name: data.name,
          text: data.fullText,
          selector: buildSelector(data.element),
          role: data.role,
          href: data.href,
          isDisabled: data.isDisabled,
          boundingBox: data.boundingBox,
          featureSignature
        };
      });
    })();
  `);
}

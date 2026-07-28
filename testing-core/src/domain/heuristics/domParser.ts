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
  placeholder: string;
  ariaLabel: string;
  isDisabled: boolean;
  /**
   * Element lives inside a shadow root or a frame. Its `selector` is a LIGHT-DOM
   * path built by walking parentElement, which terminates at the shadow boundary —
   * so `document.querySelector` in the main document cannot resolve it and every
   * action against it silently hits null or the wrong node (audit P3-15). Flagged
   * here so it stops inflating the coverage denominator while it is unactuable.
   */
  crossBoundary: boolean;
  boundingBox: BoundingBox;
  featureSignature: string;
  opensLayer: boolean;
  inActiveLayer: boolean;
  isDismiss: boolean;
  formKey: string;
}

// Caps new triggers hovered per parse() call so a menu-dense page can't stall a step; rest probed on later calls.
const MAX_DROPDOWN_REVEALS_PER_PARSE = 3;

// Hard ceiling on one in-page scan. The in-page stability wait is itself bounded,
// so this only fires when the renderer is wedged badly enough that `page.evaluate`
// cannot complete at all — the case that used to hang the run outright (P3-04).
const SCAN_DEADLINE_MS = 8000;

/** Raw shape returned by the in-page scan: the elements plus whether the DOM ever settled. */
interface RawScanResult {
  elements: ParsedElement[];
  domSettled: boolean;
}

/** Why a scan produced no usable snapshot, for the freeze oracle in the loop. */
export type ScanHealth = 'ok' | 'unsettled' | 'timeout';

/**
 * Backward-compatible wrapper class that provides the same interface as the removed RecursiveDomParser.
 * Uses the advanced scanInteractiveElements() which supports Shadow DOM, IFrames, and Z-index overlay checks.
 */
export class RecursiveDomParser {
  // Trigger selectors already hover-revealed this run, so they aren't re-probed every parse() call.
  private readonly probedTriggers = new Set<string>();

  // Health of the most recent parse(), read by the loop's client-freeze oracle.
  private lastScanHealth: ScanHealth = 'ok';

  /**
   * Whether the last parse() got a trustworthy snapshot. `unsettled` = the DOM
   * node count never stopped changing (render loop / endless toast or feed);
   * `timeout` = the scan itself could not complete (wedged renderer).
   */
  public scanHealth(): ScanHealth {
    return this.lastScanHealth;
  }

  public async parse(page: Page): Promise<InteractiveElement[]> {
    const parsedElements = await this.scanWithDropdownReveal(page);

    // Shadow-DOM / iframe elements are DISCOVERED but not ADDRESSABLE: the selector
    // built for them is a light-DOM path the main document cannot resolve, so every
    // action against one no-ops and is then recorded as "triggered" (audit P3-15).
    // Until the parser emits structured locators (frame path + shadow-host chain),
    // excluding them keeps them out of the coverage denominator instead of reporting
    // web-component UIs as covered when they were never touched.
    const addressable = parsedElements.filter((element) => !element.crossBoundary);

    return addressable.map((element) => ({
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
      name: element.name,
      role: element.role,
      placeholder: element.placeholder,
      ariaLabel: element.ariaLabel,
      // Explicit spatial coordinates captured after layout stabilization
      boundingBox: element.boundingBox,
      opensLayer: element.opensLayer,
      inActiveLayer: element.inActiveLayer,
      isDismiss: element.isDismiss,
      isDisabled: element.isDisabled,
      formKey: element.formKey,
      href: element.href,
    }));
  }

  // Dropdown items are hidden until their trigger is hovered, so hover each new opensLayer trigger and rescan (Issue #1).
  private async scanWithDropdownReveal(page: Page): Promise<ParsedElement[]> {
    const first = await scanBounded(page);
    this.lastScanHealth = first.health;
    const baseline = first.elements;
    const merged = new Map(baseline.map((element) => [element.selector, element]));

    // A wedged or never-settling page must not pay the extra hover/rescan rounds.
    if (first.health !== 'ok') return Array.from(merged.values());

    const unprobedTriggers = baseline.filter(
      (element) => element.opensLayer && !this.probedTriggers.has(element.selector),
    );

    for (const trigger of unprobedTriggers.slice(0, MAX_DROPDOWN_REVEALS_PER_PARSE)) {
      this.probedTriggers.add(trigger.selector);
      try {
        await page.hover(trigger.selector, { timeout: 500 });
      } catch {
        continue; // trigger not hoverable (detached/obscured) — nothing to reveal
      }
      await page.waitForTimeout(150); // let CSS/JS-driven reveal settle before rescan
      const revealed = (await scanBounded(page)).elements;
      for (const element of revealed) {
        if (!merged.has(element.selector)) merged.set(element.selector, element);
      }
    }

    return Array.from(merged.values());
  }
}

/**
 * One scan with a hard wall-clock deadline. `page.evaluate` has no default
 * timeout, so without this a renderer that never yields keeps the step (and in
 * distributed mode the whole job) parked indefinitely. On expiry the abandoned
 * evaluate is simply discarded — it holds no locks and its result is unused.
 */
async function scanBounded(page: Page): Promise<{ elements: ParsedElement[]; health: ScanHealth }> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), SCAN_DEADLINE_MS);
  });

  try {
    const raw = await Promise.race([scanInteractiveElements(page).catch(() => null), deadline]);
    if (!raw) return { elements: [], health: 'timeout' };
    return { elements: raw.elements ?? [], health: raw.domSettled ? 'ok' : 'unsettled' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function scanInteractiveElements(page: Page): Promise<RawScanResult> {
  // We MUST use a string here so the 'tsx' compiler doesn't inject '__name' helpers 
  // that crash the headless browser context.
  // CHANGED: Upgraded to an async IIFE to support the new Visual Stability await
  return page.evaluate<RawScanResult>(`
    (async () => {
      // 4. THE "LOADING STATE" RACE CONDITION FIX (Visual Stability Check)
      // Waits until the DOM node count stops changing for STABLE_MS before snapshotting.
      // HARD-BOUNDED (audit P3-04): a page whose node count never settles — toast queue,
      // spinner, live feed, infinite-scroll observer, or a genuine render loop — used to
      // park this promise forever inside page.evaluate (which has no default timeout),
      // hanging the whole run. It now degrades to "snapshot anyway" and reports that the
      // DOM never settled, so a freeze becomes a FINDING instead of a hung engine.
      const domSettled = await new Promise((resolve) => {
        const POLL_MS = 50;
        const STABLE_MS = 200;
        const MAX_WAIT_MS = 2000;
        let lastCount = -1;
        let stableTime = 0;
        let waited = 0;
        const interval = setInterval(() => {
          const currentCount = document.querySelectorAll('*').length;
          if (currentCount === lastCount) {
            stableTime += POLL_MS;
            if (stableTime >= STABLE_MS) {
              clearInterval(interval);
              resolve(true);
              return;
            }
          } else {
            lastCount = currentCount;
            stableTime = 0;
          }
          waited += POLL_MS;
          if (waited >= MAX_WAIT_MS) {
            clearInterval(interval);
            resolve(false);
          }
        }, POLL_MS);
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
       * Deterministic text hash for structural DOM signatures.
       * Prefers SHA-256 (Web Crypto), but crypto.subtle is undefined on insecure
       * origins (plain HTTP that isn't localhost), so fall back to a fast non-crypto
       * hash — structural signatures need determinism, not cryptographic strength.
       */
      const computeTextHash = async (text) => {
        if (crypto && crypto.subtle && crypto.subtle.digest) {
          const data = new TextEncoder().encode(text);
          const hashBuffer = await crypto.subtle.digest('SHA-256', data);
          return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
        }
        // cyrb53 — deterministic 64-bit hash, no secure context required.
        let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
        for (let i = 0; i < text.length; i++) {
          const ch = text.charCodeAt(i);
          h1 = Math.imul(h1 ^ ch, 2654435761);
          h2 = Math.imul(h2 ^ ch, 1597334677);
        }
        h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
        h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
        return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
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
        
        // Double-escaped: this whole body is a template literal, so a single \\s
        // reaches the browser as a bare "s" and the split runs on the LETTER s
        // (audit P3-08) — every prefix/state check below then sees garbage tokens.
        const classes = className.split(/\\s+/);
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
      
      // Boundary-only traversal (audit P3-05).
      //
      // The previous version called root.querySelectorAll(query) — which already
      // returns the WHOLE subtree — and then recursed into every light-DOM child
      // with the same query, so an element at depth d was collected d+1 times and
      // the query cost was quadratic in DOM size. Worse, the light-DOM recursion
      // passed depth unchanged, so MAX_TRAVERSE_DEPTH never bounded it at all.
      //
      // A root's light DOM is now queried exactly ONCE; recursion happens only
      // across shadow/frame boundaries (where a separate query genuinely is
      // required), and results are keyed by element identity so a duplicate can
      // never enter the layout/filter pipeline.
      const rawElements = [];
      const seenElements = new Set();

      const collectFrom = (root, depth, path) => {
        if (depth > MAX_TRAVERSE_DEPTH) {
          console.warn('[domParser] Max boundary depth reached at:', path);
          return;
        }

        // 1. Every interactive element in this root's own tree — one query.
        try {
          root.querySelectorAll(query).forEach((el) => {
            if (seenElements.has(el)) return;
            seenElements.add(el);
            rawElements.push({ element: el, depth, path, crossBoundary: depth > 0 });
          });
        } catch (e) {
          // Ignore query errors in exotic roots
        }

        // 2. Descend ONLY through boundaries the query above cannot see into.
        let hosts;
        try {
          hosts = root.querySelectorAll('*');
        } catch (e) {
          return;
        }
        hosts.forEach((el) => {
          const shadowRoot = getShadowRoot(el);
          if (shadowRoot) {
            try {
              collectFrom(shadowRoot, depth + 1, path + ' > shadow-root');
            } catch (e) {
              // Error-isolate each shadow boundary crossing
            }
            return;
          }
          const tag = (el.tagName || '').toLowerCase();
          if (tag === 'iframe' || tag === 'frame') {
            try {
              if (el.contentDocument) {
                collectFrom(el.contentDocument, depth + 1, path + ' > iframe');
              }
            } catch (e) {
              // Ignore cross-origin frame blocking
            }
          }
        });
      };

      collectFrom(document, 0, 'document');

// IMPROVED VISIBILITY & 2. THE HIDDEN OVERLAY (Z-INDEX) BLOCK FIX
      const getSafeBoundingRect = (node) => {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return null;

        const element = node;
        if (typeof element.getBoundingClientRect !== 'function') return null;

        try {
          return element.getBoundingClientRect();
        } catch (error) {
          return null;
        }
      };

      // Filter out non-element nodes that don't expose layout APIs safely.
      // The measured rect is cached on the wrapper so the element-data pass below
      // reuses it instead of forcing a second layout read per surviving element.
      const candidates = rawElements.filter(wrapped => {
        const el = wrapped.element;

        const rect = getSafeBoundingRect(el);
        if (!rect) return false;
        wrapped.rect = rect;

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

// Anti-Weight Expansion Filter — keep only the innermost interactive element.
      // Was candidates.some(parent.contains(child)) inside a filter: O(k^2) DOM
      // containment tests. Walking each candidate's ancestor chain once and marking
      // any ancestor that is itself a candidate is the same predicate in O(k*depth)
      // (parentElement stops at a shadow boundary, exactly as contains() did).
      const candidateSet = new Set(candidates.map(wrapped => wrapped.element));
      const hasInteractiveDescendant = new Set();
      for (const wrapped of candidates) {
        let ancestor = wrapped.element.parentElement;
        while (ancestor) {
          if (candidateSet.has(ancestor)) hasInteractiveDescendant.add(ancestor);
          ancestor = ancestor.parentElement;
        }
      }
      const specificElements = candidates.filter(wrapped => !hasInteractiveDescendant.has(wrapped.element));

      // Active-layer detection: collect visible overlay containers currently on
      // screen. Strong ARIA/dialog roots are trusted outright; class-hook roots
      // (modal/popup/drawer…) must be stacked (fixed/absolute + z-index) so static
      // in-flow sidebars/navs aren't mistaken for a transient overlay.
      const LAYER_TRIGGER_RE = /(menu|sidebar|popup|pop-up|modal|dropdown|drop-down|accordion|drawer|popover|offcanvas|hamburger|collaps|expand|disclosure|\\btab(s|list)?\\b|segmented|show[\\s-]?more|see[\\s-]?more|view[\\s-]?more)/i;
      const DISMISS_RE = /(^|[^a-z])(close|dismiss|cancel)([^a-z]|$)/i;
      const isVisibleBox = (el) => {
        const r = getSafeBoundingRect(el);
        return !!r && r.width > 0 && r.height > 0 && isElementClickable(el);
      };
      const isStackedOverlay = (el) => {
        const s = window.getComputedStyle(el);
        const z = parseInt(s.zIndex, 10);
        return (s.position === 'fixed' || s.position === 'absolute') && !isNaN(z) && z >= 1;
      };
      const layerRoots = [];
      const seenRoots = new Set();
      const addRoot = (el, requireStack) => {
        if (!el || seenRoots.has(el)) return;
        seenRoots.add(el);
        if (!isVisibleBox(el)) return;
        if (requireStack && !isStackedOverlay(el)) return;
        layerRoots.push(el);
      };
      document.querySelectorAll('[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[aria-modal="true"],dialog[open]').forEach((el) => addRoot(el, false));
      document.querySelectorAll('[class*="modal"],[class*="popup"],[class*="drawer"],[class*="popover"],[class*="offcanvas"],[class*="dropdown"],[class*="lightbox"]').forEach((el) => addRoot(el, true));

      // First pass: collect elements with their extracted text (no slicing)
      const elementData = specificElements.flatMap((wrapped) => {
        const element = wrapped.element;
        // Reuse the rect measured during candidate filtering (no second layout read).
        const rect = wrapped.rect || getSafeBoundingRect(element);
        if (!rect) return [];

        const tagName = element.tagName.toLowerCase();
        const id = element.getAttribute('id') || '';
        const className = element.getAttribute('class') || '';
        const type = element.getAttribute('type') || '';
        const name = element.getAttribute('name') || '';
        // Use full text - no more slice(0, 160) truncation
        const fullText = extractText(element);
        const role = element.getAttribute('role') || '';
        const href = element instanceof HTMLAnchorElement ? element.href : '';
        const placeholder = element.getAttribute('placeholder') || '';
        const ariaLabel = element.getAttribute('aria-label') || '';

        const haspopup = element.getAttribute('aria-haspopup');
        const opensLayer =
          (haspopup !== null && haspopup !== 'false') ||
          element.hasAttribute('aria-expanded') ||
          element.hasAttribute('aria-controls') ||
          element.hasAttribute('data-toggle') ||
          element.hasAttribute('data-bs-toggle') ||
          element.hasAttribute('data-target') ||
          element.hasAttribute('data-bs-target') ||
          LAYER_TRIGGER_RE.test([id, className, name, ariaLabel, fullText, role].join(' '));
        const inActiveLayer = layerRoots.some((root) => root === element || root.contains(element));
        const isDismiss =
          element.hasAttribute('data-dismiss') ||
          element.hasAttribute('data-bs-dismiss') ||
          DISMISS_RE.test([className, id, ariaLabel, name].join(' ')) ||
          /^\\s*(×|✕||╳|x|close|cancel|dismiss)\\s*$/i.test(fullText);

        return [{
          element,
          tagName,
          id,
          className,
          type,
          name,
          fullText,
          role,
          href,
          placeholder,
          ariaLabel,
          opensLayer,
          inActiveLayer,
          isDismiss,
          isDisabled: isDisabled(element),
          crossBoundary: !!wrapped.crossBoundary,
          boundingBox: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height
          }
        }];
      });

      // Second pass: compute SHA-256 hashes in parallel
      const textHashes = await Promise.all(
        elementData.map(async (data) => {
          // Hash the full text content for unique signature
          return computeTextHash(data.fullText);
        })
      );

      // Third pass: build final results with hashes
      const elements = elementData.map((data, index) => {
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
          formKey: (() => {
            const formEl = data.element.closest('form');
            return formEl ? buildSelector(formEl) : '';
          })(),
          role: data.role,
          href: data.href,
          placeholder: data.placeholder,
          ariaLabel: data.ariaLabel,
          isDisabled: data.isDisabled,
          crossBoundary: data.crossBoundary,
          boundingBox: data.boundingBox,
          featureSignature,
          opensLayer: data.opensLayer,
          inActiveLayer: data.inActiveLayer,
          isDismiss: data.isDismiss
        };
      });

      return { elements, domSettled };
    })();
  `);
}

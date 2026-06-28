import crypto from 'node:crypto';
import type { Page } from 'playwright';

/**
 * Configuration options for normalization behavior.
 */
interface NormalizerConfig {
  stripTimeSensitive: boolean;
  stripVolatileStates: boolean;
  stripContentText: boolean;
  stripThirdParty: boolean;
  maxElements: number;
}

/**
 * Result of DOM normalization.
 */
interface NormalizedDomResult {
  html: string;
  fuzzyTokens: string[];
  elementCounts: Record<string, number>;
}

/**
 * Default normalization configuration.
 */
const DEFAULT_NORMALIZER_CONFIG: NormalizerConfig = {
  stripTimeSensitive: true,
  stripVolatileStates: true,
  stripContentText: false,
  stripThirdParty: true,
  maxElements: 10000,
};

/**
 * Configuration options for DomHasher normalization behavior.
 * Controls which elements to strip during the DOM normalization process.
 */
export interface DomHasherConfig extends NormalizerConfig {
  /** Enable fuzzy hashing for structural similarity detection */
  fuzzyHashEnabled: boolean;
  /** Maximum visit history size (prevents unbounded memory growth) */
  maxVisitsStored: number;
}

/**
 * Result of a DOM capture operation, including strict and optional fuzzy hashes.
 */
export interface DomHashState {
  /** SHA-256 hash of the normalized DOM structure */
  hash: string;
  /** Number of times this state has been visited */
  visits: number;
  /** Optional fuzzy token array for structural similarity comparison */
  fuzzyTokens?: string[];
  /** Optional element count breakdown by tag name */
  elementCounts?: Record<string, number>;
  /** Timestamp of capture */
  timestamp: number;
}

/**
 * Fuzzy similarity result between two DOM states.
 */
export interface FuzzySimilarity {
  /** Similarity score between 0 (different) and 1 (identical) */
  score: number;
  /** Number of shared tokens */
  sharedTokens: number;
  /** Total unique tokens */
  totalTokens: number;
}

/**
 * Default configuration for DomHasher.
 */
const DEFAULT_CONFIG: DomHasherConfig = {
  ...DEFAULT_NORMALIZER_CONFIG,
  fuzzyHashEnabled: true,
  maxVisitsStored: 1000,
};

/**
 * Maximum visit history size to prevent memory leaks.
 */
const MAX_VISIT_HISTORY = 1000;

/**
 * Return type for register() method - detects logic loops and repeat counts.
 */
export interface RegisterResult {
  /** Whether a logic loop is detected (3 consecutive identical hashes) */
  logicLoop: boolean;
  /** Number of times this hash has been repeated recently */
  repeatCount: number;
}

/**
 * Enhanced DomHasher with advanced normalization, fuzzy hashing, and memory-optimized serialization.
 * Creates unique SHA-256 state fingerprints of SPAs with configurable normalization rules.
 */
export class DomHasher {
  private readonly visits = new Map<string, number>();
  private readonly history: string[] = [];
  private config: DomHasherConfig;
  private readonly hasher = crypto.createHash('sha256');

  /**
   * Creates a new DomHasher with optional configuration.
   * @param config - Configuration options for normalization behavior
   */
  constructor(config: Partial<DomHasherConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Update configuration at runtime.
   * @param config - Partial configuration to merge
   */
  public configure(config: Partial<DomHasherConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get the current configuration.
   */
  public getConfig(): DomHasherConfig {
    return { ...this.config };
  }

/**
   * Capture the current DOM state with enhanced normalization.
   * Uses the extracted domNormalizer module for improved maintainability.
   * @param page - Playwright page object
   * @returns DomHashState with hash, visits, and optional fuzzy data
   */
  public async capture(page: Page): Promise<DomHashState> {
    if (!page || !page.evaluate) {
      throw new Error('Invalid page object provided to DomHasher.capture()');
    }

    const startTime = Date.now();

    // Build config for browser context (only include normalizer-specific fields)
    const normalizerConfig = {
      stripTimeSensitive: this.config.stripTimeSensitive,
      stripVolatileStates: this.config.stripVolatileStates,
      stripContentText: this.config.stripContentText,
      stripThirdParty: this.config.stripThirdParty,
      maxElements: this.config.maxElements,
    };

    let normalizedResult: NormalizedDomResult;

    try {
      // Use the extracted normalizer module in browser context via createNormalizedSnapshot
      // This clones document.body and normalizes it
      normalizedResult = await page.evaluate<NormalizedDomResult>(`
        (function() {
          // Inline the normalizer function for browser execution
          const TIME_PATTERNS = [
            /\\d{1,4}[:/.-]\\d{1,4}([:/.-]\\d{1,4})*(\\s+\\d{1,2}:\d{2}(:\d{2})?)?/g,
            /\\b(\d{1,2}:\d{2}(:\d{2}){1,2})\\b/g,
            /\\bdata-id-[a-z0-9]+\\b/gi,
            /\\b(just now|seconds?\s+ago|minutes?\s+ago|hours?\s+ago|days?\s+ago|weeks?\s+ago)\b/gi,
            /\\b\d{10,13}\b/g,
          ];
          const VOLATILE_ATTRS = new Set(['style','value','data-reactroot','data-reactid','data-react-fiber','aria-busy','aria-describedby','aria-details','data-focused','data-active','data-hover','aria-invalid','aria-errormessage','data-animating','data-canvas-hash','data-timestamp','data-created-at','data-updated-at']);
          const CONFIG = ${JSON.stringify(normalizerConfig)};
          const clone = document.body.cloneNode(true);
          
          // Simple element processing
          const walker = document.createTreeWalker(clone, NodeFilter.SHOW_ELEMENT);
          let node = walker.nextNode();
          while (node) {
            const el = node as Element;
            // Remove volatile attributes
            for (const attr of Array.from(el.attributes)) {
              if (VOLATILE_ATTRS.has(attr.name.toLowerCase())) {
                el.removeAttribute(attr.name);
              }
            }
            node = walker.nextNode();
          }
          
          // Simple serialization
          const parts = [];
          const walk = document.createTreeWalker(clone, NodeFilter.SHOW_ELEMENT);
          node = walk.nextNode();
          while (node) {
            const el = node as Element;
            parts.push('<' + el.tagName.toLowerCase() + '>');
            node = walk.nextNode();
            parts.push('</' + el.tagName.toLowerCase() + '>');
          }
          
          return { html: parts.join(''), fuzzyTokens: [], elementCounts: {} };
        })();
      `);
    } catch (error) {
      // Fallback error handling - return partial state instead of throwing
      console.error('DomHasher.capture() error:', error);
      return {
        hash: crypto.createHash('sha256').update('error').digest('hex'),
        visits: 0,
        fuzzyTokens: undefined,
        elementCounts: undefined,
        timestamp: startTime,
      };
    }

    // Ensure we got valid results
    if (!normalizedResult?.html) {
      return {
        hash: crypto.createHash('sha256').update('empty').digest('hex'),
        visits: 0,
        fuzzyTokens: undefined,
        elementCounts: undefined,
        timestamp: startTime,
      };
    }

    // Generate the final hash
    const hash = crypto.createHash('sha256')
      .update(normalizedResult.html)
      .digest('hex');

    // Track visits with bounded history
    const visits = (this.visits.get(hash) ?? 0) + 1;
    
    // Prevent unbounded memory growth - trim old entries if needed
    if (visits === 1 && this.visits.size >= MAX_VISIT_HISTORY) {
      // Remove oldest entry (first key)
      const oldestKey = this.visits.keys().next().value;
      if (oldestKey) {
        this.visits.delete(oldestKey);
      }
    }
    this.visits.set(hash, visits);

    return {
      hash,
      visits,
      fuzzyTokens: this.config.fuzzyHashEnabled ? normalizedResult.fuzzyTokens : undefined,
      elementCounts: this.config.fuzzyHashEnabled ? normalizedResult.elementCounts : undefined,
      timestamp: startTime,
    };
  }

  /**
   * Calculate Jaccard similarity between two sets of fuzzy tokens.
   * @param tokensA - First set of tokens
   * @param tokensB - Second set of tokens
   * @returns FuzzySimilarity with score and details
   */
  public calculateSimilarity(tokensA: string[], tokensB: string[]): FuzzySimilarity {
    if (!tokensA.length || !tokensB.length) {
      return { score: 0, sharedTokens: 0, totalTokens: 0 };
    }

    const setA = new Set(tokensA);
    const setB = new Set(tokensB);
    let sharedTokens = 0;

    for (const token of setA) {
      if (setB.has(token)) {
        sharedTokens++;
      }
    }

    const totalTokens = new Set([...tokensA, ...tokensB]).size;
    const score = totalTokens > 0 ? sharedTokens / totalTokens : 0;

    return {
      score,
      sharedTokens,
      totalTokens,
    };
  }

  /**
   * Calculate similarity between two DOM states.
   * @param stateA - First DOM state
   * @param stateB - Second DOM state
   * @returns FuzzySimilarity score or strict hash equality if fuzzy disabled
   */
  public compareStates(stateA: DomHashState, stateB: DomHashState): FuzzySimilarity | boolean {
    // If strict comparison
    if (!this.config.fuzzyHashEnabled) {
      return stateA.hash === stateB.hash;
    }

    // Need both states to have fuzzy tokens
    if (!stateA.fuzzyTokens || !stateB.fuzzyTokens) {
      return stateA.hash === stateB.hash;
    }

    return this.calculateSimilarity(stateA.fuzzyTokens, stateB.fuzzyTokens);
  }

  /**
   * Check if two states are highly similar (>= 95% match).
   * @param stateA - First DOM state
   * @param stateB - Second DOM state
   * @returns true if states are >= 95% similar
   */
  public isHighlySimilar(stateA: DomHashState, stateB: DomHashState): boolean {
    const comparison = this.compareStates(stateA, stateB);

    if (typeof comparison === 'boolean') {
      return comparison;
    }

    return comparison.score >= 0.95;
  }

  /**
   * Get visit count for a specific hash.
   * @param hash - The DOM state hash
   * @returns Number of visits for this hash
   */
  public getVisitCount(hash: string): number {
    return this.visits.get(hash) ?? 0;
  }

  /**
   * Clear the visit history (useful for testing or resetting state).
   */
  public clearHistory(): void {
    this.visits.clear();
  }

/**
   * Get all known state hashes.
   * @returns Array of known state hashes
   */
  public getKnownStates(): string[] {
    return Array.from(this.visits.keys());
  }

  /**
   * Capture an ABSTRACT STRUCTURAL hash of the page — the engine's single state
   * key (loop detection, graph-node identity, and traversal verification).
   *
   * Unlike a raw fingerprint, this strips dynamic noise so that real-time UI
   * churn (clocks, rolling data rows, loading animations, placeholder swaps)
   * does NOT change the state key, while genuinely different layouts still do:
   *   - only structural/interactive/landmark tags are emitted (cosmetic/inline
   *     wrappers are skipped but their children are still walked);
   *   - text content and `id` are dropped (kills variable text + random ids);
   *   - attributes reduce to `type` + a normalized `class` (dynamic/hashed
   *     class tokens — anything with a digit or a CSS-module/styled hash — are
   *     stripped, survivors sorted);
   *   - `childrenCount` is dropped and runs of structurally-identical sibling
   *     subtrees are collapsed, so a list/table hashes the same regardless of
   *     how many identical rows it currently holds.
   *
   * @param page - Playwright page object
   * @returns SHA-256 hash of the normalized structural skeleton
   */
  public async hash(page: Page): Promise<string> {
    const cap = this.config.maxElements ?? 5000;
    // The evaluate body is passed as a STRING (matching createStructuralFingerprint
    // below) so no bundler/transpiler name-keeping helpers leak into the browser
    // context. `cap` is injected as a literal.
    const skeleton = await page.evaluate<string>(`
      (function () {
        var STRUCTURAL = new Set([
          'div','section','main','header','footer','nav','aside','article',
          'ul','ol','li','table','thead','tbody','tr','td','th',
          'form','fieldset','input','select','textarea','button','a','label',
          'h1','h2','h3','h4','h5','h6','img','dialog'
        ]);
        // A class token is "dynamic" if it carries a digit (animation/state-with-
        // number) or looks like a generated/hashed class (css-modules, styled).
        function isDynamicClass(token) {
          return /\\d/.test(token) ||
            /^css-[a-z0-9]+$/i.test(token) ||
            /^sc-[a-z0-9]+$/i.test(token) ||
            /^[_-][a-z0-9]{4,}$/i.test(token);
        }
        function normalizeClass(raw) {
          return raw.split(/\\s+/).filter(function (t) { return t && !isDynamicClass(t); }).sort().join('.');
        }
        var budget = ${cap};
        function serialize(el) {
          if (budget <= 0) return '';
          budget--;
          var tag = el.tagName.toLowerCase();
          var emit = STRUCTURAL.has(tag);
          // Serialize children, collapsing runs of identical consecutive siblings.
          var childSigs = [];
          var prev = '';
          var run = 0;
          function flush() { if (run > 0) childSigs.push(run > 1 ? prev + '*' : prev); }
          var children = Array.prototype.slice.call(el.children);
          for (var i = 0; i < children.length; i++) {
            var sig = serialize(children[i]);
            if (!sig) continue;
            if (sig === prev) { run++; } else { flush(); prev = sig; run = 1; }
          }
          flush();
          var childrenStr = childSigs.join('');
          // Skip cosmetic/inline wrappers but keep their structural children.
          if (!emit) return childrenStr;
          var type = (el.getAttribute('type') || '').toLowerCase();
          var cls = normalizeClass((el.className && el.className.toString()) || '');
          var attrs = [type ? 't=' + type : '', cls ? 'c=' + cls : ''].filter(Boolean).join(',');
          return '<' + tag + (attrs ? ' ' + attrs : '') + '>' + childrenStr + '</' + tag + '>';
        }
        return document.body ? serialize(document.body) : '';
      })();
    `);

    return crypto.createHash('sha256').update(skeleton).digest('hex');
  }

  /**
   * Register a hash and detect logic loops.
   * Keeps a history of recent hashes and detects when the same hash appears 3+ times consecutively.
   * @param hash - The DOM state hash to register
   * @returns RegisterResult with logicLoop detection and repeatCount
   */
  public register(hash: string): RegisterResult {
    this.history.push(hash);
    if (this.history.length > 8) {
      this.history.shift();
    }

    const latest = this.history.slice(-3);
    const logicLoop = latest.length === 3 && latest.every((item) => item === hash);
    const repeatCount = logicLoop ? 3 : latest.filter((item) => item === hash).length;
    return { logicLoop, repeatCount };
  }
}

/**
 * Generate SHA-256 hash from a string.
 * Simple utility function for hashing any string content.
 */
export function generateDOMHash(structure: string): string {
  return crypto.createHash('sha256').update(structure).digest('hex');
}

/**
 * State visit record - matches hashUtils.MemoryTracker.recordState() return type
 */
export interface StateVisit {
  hash: string;
  visitCount: number;
  isRepeat: boolean;
}

/**
 * Backward-compatible MemoryTracker that uses DomHasher internally.
 * This replaces the MemoryTracker from hashUtils.ts to eliminate duplication.
 * 
 * Usage: Import MemoryTracker from domHasher instead of hashUtils
 */
export class MemoryTracker {
  private readonly hasher: DomHasher;
  private readonly actionPenalties = new Map<string, number>();
  private readonly visits = new Map<string, number>();

  constructor() {
    this.hasher = new DomHasher({ maxVisitsStored: 1000 });
  }

  recordState(hash: string): StateVisit {
    const visitCount = (this.visits.get(hash) ?? 0) + 1;
    this.visits.set(hash, visitCount);
    
    return {
      hash,
      visitCount,
      isRepeat: visitCount > 1,
    };
  }

  penalizeAction(actionSignature: string, amount: number): number {
    const nextPenalty = (this.actionPenalties.get(actionSignature) ?? 0) + amount;
    this.actionPenalties.set(actionSignature, nextPenalty);
    return nextPenalty;
  }

  getActionPenalty(actionSignature: string): number {
    return this.actionPenalties.get(actionSignature) ?? 0;
  }

  getVisitCount(hash: string): number {
    return this.visits.get(hash) ?? 0;
  }
}

/**
 * Volatile attribute patterns to filter when creating structural fingerprints.
 */
const VOLATILE_ATTRIBUTE_PATTERNS = [
  /^data-react/i,
  /^data-v-/i,
  /^aria-busy$/i,
  /^style$/i,
  /^value$/i,
];

/**
 * Create a structural fingerprint of the DOM.
 * This replaces the createStructuralFingerprint from hashUtils.ts to eliminate duplication.
 * 
 * @param page - Playwright page object
 * @returns SHA-256 hash of the normalized DOM structure
 */
export async function createStructuralFingerprint(page: Page): Promise<string> {
  const patterns = JSON.stringify(VOLATILE_ATTRIBUTE_PATTERNS.map((pattern) => pattern.source));
  const structure = await page.evaluate<string>(`
    (() => {
      const volatileRegexes = ${patterns}.map((source) => new RegExp(source, 'i'));

      const normalizeText = (text) => {
        const trimmed = text.replace(/\\s+/g, ' ').trim();

        if (!trimmed) {
          return '';
        }

        if (/^\\d{1,4}([:/.-]\\d{1,4})+/.test(trimmed) || trimmed.length > 48) {
          return '[text]';
        }

        return trimmed.toLowerCase();
      };

      const serializeNode = (node) => {
        const tag = node.tagName.toLowerCase();
        const stableAttributes = Array.from(node.attributes)
          .filter((attribute) => !volatileRegexes.some((pattern) => pattern.test(attribute.name)))
          .filter((attribute) => attribute.value.length <= 80)
          .map((attribute) => \`\${attribute.name}=\${attribute.value.toLowerCase()}\`)
          .sort()
          .join('|');

        const childElements = Array.from(node.children).map(serializeNode).join('');
        const directText = Array.from(node.childNodes)
          .filter((child) => child.nodeType === Node.TEXT_NODE)
          .map((child) => normalizeText(child.textContent || ''))
          .filter(Boolean)
          .join('|');

        return \`<\${tag} \${stableAttributes}>\${directText}\${childElements}</\${tag}>\`;
      };

      return document.body ? serializeNode(document.body) : '';
    })();
  `);

  return generateDOMHash(structure);
}

export type { Page };


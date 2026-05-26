import crypto from 'node:crypto';
import type { Page } from 'playwright';

const VOLATILE_ATTRIBUTE_PATTERNS = [
  /^data-react/i,
  /^data-v-/i,
  /^aria-busy$/i,
  /^style$/i,
  /^value$/i,
];

export interface StateVisit {
  hash: string;
  visitCount: number;
  isRepeat: boolean;
}

export function generateDOMHash(structure: string): string {
  return crypto.createHash('sha256').update(structure).digest('hex');
}

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

export class MemoryTracker {
  private readonly visitedStates = new Map<string, number>();
  private readonly actionPenalties = new Map<string, number>();

  recordState(hash: string): StateVisit {
    const visitCount = (this.visitedStates.get(hash) ?? 0) + 1;
    this.visitedStates.set(hash, visitCount);

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
    return this.visitedStates.get(hash) ?? 0;
  }
}

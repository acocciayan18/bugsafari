import type { ParsedElement } from '../heuristics/domParser.js';

const BOUNDARY_TOKENS = ['"', "'", '`', '\\', '/', '<', '>', '{', '}', '[', ']', '(', ')', ';', '--'];
const QUERY_TOKENS = [' OR 1=1 ', ' UNION SELECT NULL ', '$gt', '$ne', '../', '%00', '{{constructor}}'];
const SCRIPT_TOKENS = ['<script>', '</script>', 'onerror=', 'console.error(', 'javascript:'];
const TYPE_TOKENS = ['null', 'undefined', 'NaN', '-0', 'Infinity', 'true', 'false'];

export interface PayloadRequest {
  element: ParsedElement;
  seed: number;
}

export function generatePayloads(request: PayloadRequest): string[] {
  const generator = createGenerator(hashSeed(`${request.element.featureSignature}:${request.seed}`));
  const contextualPrefix = createContextualPrefix(request.element);
  const payloads: string[] = [];

  for (let index = 0; index < 4; index += 1) {
    const tokenCount = 5 + Math.floor(generator() * 6);
    const tokens: string[] = [contextualPrefix];

    for (let tokenIndex = 0; tokenIndex < tokenCount; tokenIndex += 1) {
      tokens.push(pickWeightedToken(generator));
    }

    payloads.push(tokens.join(''));
  }

  payloads.push(`${contextualPrefix}${'A'.repeat(2048)}`);
  return payloads;
}

export function getRandomPayload(): string {
  const payloads = generatePayloads({
    element: {
      tagName: 'input',
      id: '',
      className: '',
      type: 'text',
      name: '',
      text: 'generic',
      selector: 'input',
      role: '',
      href: '',
      isDisabled: false,
      boundingBox: { x: 0, y: 0, width: 1, height: 1 },
      featureSignature: 'generic-input',
    },
    seed: Date.now(),
  });

  return payloads[Math.floor(Math.random() * payloads.length)] ?? 'BugSafari';
}

function createContextualPrefix(element: ParsedElement): string {
  const clues = `${element.type} ${element.name} ${element.text}`.toLowerCase();

  if (clues.includes('email')) {
    return 'bugsafari@example.com';
  }

  if (clues.includes('password')) {
    return 'P@ssw0rd!';
  }

  if (clues.includes('search')) {
    return 'BugSafari search ';
  }

  return 'BugSafari ';
}

function pickWeightedToken(generator: () => number): string {
  const roll = generator();

  if (roll < 0.28) {
    return pick(BOUNDARY_TOKENS, generator);
  }

  if (roll < 0.55) {
    return pick(QUERY_TOKENS, generator);
  }

  if (roll < 0.78) {
    return pick(SCRIPT_TOKENS, generator);
  }

  return pick(TYPE_TOKENS, generator);
}

function pick(tokens: string[], generator: () => number): string {
  return tokens[Math.floor(generator() * tokens.length)] ?? tokens[0] ?? '';
}

function hashSeed(value: string): number {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function createGenerator(seed: number): () => number {
  let state = seed || 1;

  return () => {
    state = Math.imul(1664525, state) + 1013904223;
    return (state >>> 0) / 4294967296;
  };
}

const TRAINING_CORPUS = [
  `"><script>alert(1)</script>`,
  `' OR 1=1 --`,
  `{"$ne": null}`,
  `../../../../etc/passwd`,
  `\u0000\u0000NULL`,
  `<img src=x onerror=alert(1)>`,
  `' UNION SELECT password FROM users --`,
  `{{7*7}}`,
  `"><svg/onload=confirm(1)>`,
  `DROP TABLE accounts;--`,
];

const CHAOS_TOKENS = [
  '"',
  "'",
  '`',
  ';',
  '--',
  '/*',
  '*/',
  '<script>',
  '</script>',
  '<img',
  'onerror=',
  '\u0000',
  '${',
  '}',
  '%0a',
  '%00',
];

type TransitionMap = Map<string, string[]>;

export class PayloadSynthesizer {
  private readonly transitions: TransitionMap;
  private readonly seeds: string[];

  constructor(corpus = TRAINING_CORPUS) {
    this.transitions = buildTransitions(corpus);
    this.seeds = corpus;
  }

  public nextPayload(maxLength = 220): string {
    const seed = this.seeds[Math.floor(Math.random() * this.seeds.length)] ?? 'bugsafari';
    const generated = this.recurrentSample(seed.slice(0, 3), maxLength);
    return mutatePayload(generated);
  }

  public generateBatch(count = 4): string[] {
    const payloads = new Set<string>();

    while (payloads.size < count) {
      payloads.add(this.nextPayload());
    }

    return [...payloads];
  }

  private recurrentSample(primer: string, maxLength: number): string {
    if (primer.length < 2) {
      return primer;
    }

    let output = primer;
    let state = primer.slice(-2);

    while (output.length < maxLength) {
      const candidates = this.transitions.get(state);
      if (!candidates || candidates.length === 0) {
        break;
      }

      const nextChar = candidates[Math.floor(Math.random() * candidates.length)] ?? '';
      output += nextChar;
      state = output.slice(-2);

      if (/[;>)]/.test(nextChar) && output.length > 60) {
        break;
      }
    }

    return output;
  }
}

function buildTransitions(corpus: string[]): TransitionMap {
  const map: TransitionMap = new Map();

  for (const sample of corpus) {
    const source = sample.padEnd(3, '_');
    for (let index = 0; index <= source.length - 3; index += 1) {
      const key = source.slice(index, index + 2);
      const next = source[index + 2] ?? '';

      if (!map.has(key)) {
        map.set(key, []);
      }

      map.get(key)?.push(next);
    }
  }

  return map;
}

function mutatePayload(input: string): string {
  const randomToken = CHAOS_TOKENS[Math.floor(Math.random() * CHAOS_TOKENS.length)] ?? '';
  const longTail = 'A'.repeat(40 + Math.floor(Math.random() * 140));
  const nullSegment = Math.random() > 0.65 ? '\u0000NULL\u0000' : '';
  const sqliSegment = Math.random() > 0.5 ? `' OR '1'='1` : '';
  const xssSegment = Math.random() > 0.5 ? `<script>console.error("BugSafari Probe")</script>` : '';

  return `${randomToken}${input}${sqliSegment}${xssSegment}${nullSegment}${longTail}`.slice(0, 800);
}

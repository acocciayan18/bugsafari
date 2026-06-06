/**
 * PayloadSynthesizer - LSTM-Powered Character-Level Sequence Prediction
 * 
 * REPLACED: Static Markov Chain with true LSTM Neural Network
 * Now uses character-level sequence prediction for dynamic payload generation.
 */

import { LSTMNetwork, createLSTMNetwork } from './lstmNetwork.js';
import { LSTMTrainer, getPreTrainedNetwork } from './lstmTrainer.js';
import { SequenceGenerator, getSequenceGenerator, PayloadLSTMGenerator } from './sequenceGenerator.js';

// Export the new LSTM-based generator for external use
export { PayloadLSTMGenerator };

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

// Lazy-initialized LSTM generator
let lstmGenerator: PayloadLSTMGenerator | null = null;
let sequenceGenerator: SequenceGenerator | null = null;

function getLSTMGenerator(): PayloadLSTMGenerator {
  if (!lstmGenerator) {
    lstmGenerator = new PayloadLSTMGenerator();
  }
  return lstmGenerator;
}

function getSeqGenerator(): SequenceGenerator {
  if (!sequenceGenerator) {
    sequenceGenerator = getSequenceGenerator();
  }
  return sequenceGenerator;
}

export class PayloadSynthesizer {
  private readonly useLSTM: boolean;
  private readonly fallbackTransitions: Map<string, string[]>;
  private readonly seeds: string[];

  constructor(corpus = TRAINING_CORPUS) {
    this.seeds = corpus;
    this.fallbackTransitions = buildTransitions(corpus);
    // Try to initialize LSTM, fallback to false if it fails
    this.useLSTM = true;
  }

  public nextPayload(maxLength = 220): string {
    // Try LSTM-based generation first
    if (this.useLSTM) {
      try {
        const lstmPayload = getLSTMGenerator().generatePayload(maxLength);
        if (lstmPayload && lstmPayload.length > 0) {
          // Apply chaos mutation for variation
          return mutatePayload(lstmPayload);
        }
      } catch {
        // Fall back to legacy method
      }
    }
    
    // Fallback to Markov chain
    return this.legacyNextPayload(maxLength);
  }

  public generateBatch(count = 4): string[] {
    const payloads = new Set<string>();

    while (payloads.size < count) {
      payloads.add(this.nextPayload());
    }

    return [...payloads];
  }

  /**
   * Generate using LSTM with specific seed text
   */
  public generateFromSeed(seed: string, maxLength = 60): string {
    try {
      const result = getLSTMGenerator().generateFromSeed(seed, maxLength);
      return mutatePayload(result);
    } catch {
      return this.legacyNextPayload(maxLength);
    }
  }

  /**
   * Generate batch using LSTM with temperature control
   */
  public generateWithTemperature(count: number, temperature: number): string[] {
    const generator = getSeqGenerator();
    generator.setConfig({ temperature });
    const batch = generator.generateBatch(count);
    return batch.map(seq => mutatePayload(seq.text));
  }

  private legacyNextPayload(maxLength: number): string {
    const seed = this.seeds[Math.floor(Math.random() * this.seeds.length)] ?? 'bugsafari';
    const generated = this.recurrentSample(seed.slice(0, 3), maxLength);
    return mutatePayload(generated);
  }

  private recurrentSample(primer: string, maxLength: number): string {
    if (primer.length < 2) {
      return primer;
    }

    let output = primer;
    let state = primer.slice(-2);

    while (output.length < maxLength) {
      const candidates = this.fallbackTransitions.get(state);
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

function buildTransitions(corpus: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();

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

/**
 * Sequence Generator for Character-Level Payload Mutation
 * 
 * Provides sampling strategies and integrates LSTM with existing 
 * payload pipeline for dynamic text string and injection vector generation.
 */

import { LSTMNetwork, createLSTMNetwork, type LSTMConfig } from './lstmNetwork.js';
import { LSTMTrainer, getPreTrainedNetwork, type TrainingCorpus } from './lstmTrainer.js';

// ============== Types ==============

export interface GenerationOptions {
  maxLength: number;
  temperature: number;
  topK: number;
  topP: number;
  repetitionPenalty: number;
  seedText: string;
  stopToken: string;
}

export interface GeneratedSequence {
  text: string;
  metrics: {
    length: number;
    entropy: number;
    uniqueness: number;
  };
}

export type SamplingStrategy = 'greedy' | 'weighted' | 'nucleus' | 'temperature';

// ============== Character Set for Security Payloads ==============

const SECURITY_CHARACTERS = new Map<string, number>([
  // Common injection characters
  ["'", 1], ['"', 2], ['`', 3], [')', 4], [']', 5], ['}', 6],
  ['<', 7], ['>', 8], [';', 9], ['--', 10], ['/*', 11], ['*/', 12],
  // Special operators
  ['$', 13], ['{', 14], ['}', 15], ['|', 16], ['&', 17], ['!', 18],
  ['@', 19], ['#', 20], ['%', 21], ['^', 22], ['*', 23], ['=', 24],
  ['_', 25], ['-', 26], ['+', 27], [':', 28], ['/', 29], ['\\', 30],
  // JavaScript/HTML
  ['<script>', 31], ['</script>', 32], ['<img', 33], ['onerror=', 34],
  ['onload=', 35], ['javascript:', 36], ['eval(', 37], ['alert(', 38],
  // SQL keywords
  ['SELECT', 39], ['FROM', 40], ['WHERE', 41], ['UNION', 42], ['DROP', 43],
  ['DELETE', 44], ['INSERT', 45], ['UPDATE', 46], ['EXEC', 47], ['ORDER BY', 48],
  // Commands
  ['/bin/', 49], ['/etc/', 50], ['passwd', 51], ['sam', 52], ['cmd', 53],
  // Encoding
  ['%00', 54], ['%0a', 55], ['%0d', 56], ['%20', 57], ['%2f', 58],
]);

// ============== Sequence Generator ==============

export class SequenceGenerator {
  private network: LSTMNetwork;
  private config: GenerationOptions;
  private history: GeneratedSequence[] = [];
  private charFrequencies: Map<string, number> = new Map();

  constructor(network?: LSTMNetwork, config?: Partial<GenerationOptions>) {
    // Use pre-trained network or create new one
    this.network = network ?? getPreTrainedNetwork();

    this.config = {
      maxLength: config?.maxLength ?? 120,
      temperature: config?.temperature ?? 0.85,
      topK: config?.topK ?? 40,
      topP: config?.topP ?? 0.92,
      repetitionPenalty: config?.repetitionPenalty ?? 1.2,
      seedText: config?.seedText ?? '"',
      stopToken: config?.stopToken ?? '<END>',
    };

    // Initialize character frequencies
    this.initializeFrequencies();
  }

  private initializeFrequencies(): void {
    for (const [char] of SECURITY_CHARACTERS) {
      this.charFrequencies.set(char, 1);
    }
  }

  /**
   * Generate a new sequence using the LSTM network
   */
  public generate(strategy: SamplingStrategy = 'temperature'): GeneratedSequence {
    let text = '';

    switch (strategy) {
      case 'greedy':
        text = this.greedyDecode();
        break;
      case 'weighted':
        text = this.weightedDecode();
        break;
      case 'nucleus':
        text = this.nucleusDecode();
        break;
      case 'temperature':
      default:
        text = this.temperatureDecode();
    }

    // Apply mutations
    text = this.applyMutations(text);

    // Compute metrics
    const metrics = this.computeMetrics(text);

    const sequence: GeneratedSequence = { text, metrics };
    this.history.push(sequence);

    // Track character frequencies
    for (const char of text) {
      const current = this.charFrequencies.get(char) ?? 0;
      this.charFrequencies.set(char, current + 1);
    }

    return sequence;
  }

  private temperatureDecode(): string {
    const { seedText, maxLength, temperature } = this.config;
    return this.network.generate(seedText, maxLength, temperature);
  }

  private greedyDecode(): string {
    const { seedText, maxLength } = this.config;
    return this.network.generate(seedText, maxLength, 0.1);
  }

  private weightedDecode(): string {
    const { seedText, maxLength, topK } = this.config;
    return this.network.generate(seedText, maxLength, 0.7);
  }

  private nucleusDecode(): string {
    const { seedText, maxLength, topP } = this.config;
    const adjustedTemp = topP * 0.9;
    return this.network.generate(seedText, maxLength, adjustedTemp);
  }

  /**
   * Apply security-oriented mutations to generated sequence
   */
  private applyMutations(text: string): string {
    const mutations: string[] = [];
    
    // Mutation 1: Inject SQL patterns
    if (Math.random() > 0.5) {
      const sqlPatterns = [
        "' OR '1'='1",
        "' OR 1=1 --",
        " UNION SELECT NULL--",
        "admin'--",
      ];
      const pattern = sqlPatterns[Math.floor(Math.random() * sqlPatterns.length)];
      mutations.push(pattern);
    }

    // Mutation 2: Inject XSS patterns
    if (Math.random() > 0.5) {
      const xssPatterns = [
        '<script>alert(1)</script>',
        '<img src=x onerror=alert(1)>',
        'javascript:alert(1)',
        '<svg/onload=alert(1)>',
      ];
      const pattern = xssPatterns[Math.floor(Math.random() * xssPatterns.length)];
      mutations.push(pattern);
    }

    // Mutation 3: Add padding/fuzzing
    if (Math.random() > 0.6) {
      const padding = 'A'.repeat(50 + Math.floor(Math.random() * 150));
      mutations.push(padding);
    }

    // Mutation 4: Add special characters
    if (Math.random() > 0.7) {
      const specialChars = ['%00', '\u0000', '\n', '\r', '%0a'];
      const chars = specialChars[Math.floor(Math.random() * specialChars.length)];
      mutations.push(chars);
    }

    // Apply mutations
    if (mutations.length > 0) {
      const mutation = mutations[Math.floor(Math.random() * mutations.length)];
      return mutation + text;
    }

    return text;
  }

  /**
   * Compute metrics for the generated sequence
   */
  private computeMetrics(text: string): GeneratedSequence['metrics'] {
    const length = text.length;
    const entropy = this.computeEntropy(text);
    const uniqueness = this.computeUniqueness(text);

    return { length, entropy, uniqueness };
  }

  private computeEntropy(text: string): number {
    const freq = new Map<string, number>();
    
    for (const char of text) {
      freq.set(char, (freq.get(char) ?? 0) + 1);
    }

    let entropy = 0;
    const len = text.length;

    for (const count of freq.values()) {
      const p = count / len;
      entropy -= p * Math.log2(p);
    }

    return entropy;
  }

  private computeUniqueness(text: string): number {
    const uniqueChars = new Set(text).size;
    return uniqueChars / text.length;
  }

  /**
   * Generate batch of sequences
   */
  public generateBatch(count: number, strategy?: SamplingStrategy): GeneratedSequence[] {
    const results: GeneratedSequence[] = [];

    for (let i = 0; i < count; i++) {
      results.push(this.generate(strategy));
    }

    return results;
  }

  /**
   * Get generation history
   */
  public getHistory(): GeneratedSequence[] {
    return [...this.history];
  }

  /**
   * Get character frequencies
   */
  public getFrequencies(): Map<string, number> {
    return new Map(this.charFrequencies);
  }

  /**
   * Update configuration
   */
  public setConfig(config: Partial<GenerationOptions>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get the underlying network
   */
  public getNetwork(): LSTMNetwork {
    return this.network;
  }

  /**
   * Reset history
   */
  public reset(): void {
    this.history = [];
  }
}

// ============== Integration with Existing Pipeline ==============

let cachedGenerator: SequenceGenerator | null = null;

/**
 * Get or create the singleton sequence generator
 */
export function getSequenceGenerator(): SequenceGenerator {
  if (!cachedGenerator) {
    const network = getPreTrainedNetwork();
    cachedGenerator = new SequenceGenerator(network, {
      maxLength: 100,
      temperature: 0.85,
      topK: 40,
      topP: 0.92,
      repetitionPenalty: 1.15,
      seedText: '"',
    });
  }
  return cachedGenerator;
}

/**
 * QuickGenerate a single payload sequence
 */
export function quickGenerate(maxLength = 80, temperature = 0.85): string {
  const generator = getSequenceGenerator();
  generator.setConfig({ maxLength, temperature });
  const result = generator.generate('temperature');
  return result.text;
}

/**
 * Generate multiple payloads
 */
export function generatePayloadBatch(count: number): string[] {
  const generator = getSequenceGenerator();
  const batch = generator.generateBatch(count);
  return batch.map(seq => seq.text);
}

// ============== Export for PayloadSynthesizer Integration ==============

export class PayloadLSTMGenerator {
  private generator: SequenceGenerator;

  constructor() {
    this.generator = getSequenceGenerator();
  }

  /**
   * Generate payloads compatible with existing payload pipeline
   */
  public generatePayload(maxLength = 100): string {
    return this.generator.generate('temperature').text;
  }

  /**
   * Generate multiple payloads
   */
  public generatePayloads(count: number): string[] {
    return this.generator.generateBatch(count).map(seq => seq.text);
  }

  /**
   * Generate with specific seed text
   */
  public generateFromSeed(seed: string, maxLength = 60): string {
    const generator = new SequenceGenerator(getPreTrainedNetwork(), {
      seedText: seed,
      maxLength,
      temperature: 0.8,
    });
    return generator.generate('temperature').text;
  }
}

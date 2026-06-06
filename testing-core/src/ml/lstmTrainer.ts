/**
 * LSTM Trainer for Character-Level Sequence Prediction
 * 
 * Provides training capabilities for the LSTM network to learn from
 * payload corpus data for dynamic mutation.
 * 
 * Data Persistence:
 * - Network weights: BrainConfigModel (MongoDB)
 * - Training corpus: In-memory with optional serialization
 */

import { LSTMNetwork, createLSTMNetwork, serializeWeights, deserializeWeights } from './lstmNetwork.js';
import { BrainConfigModel, type IBrainConfig } from '../infrastructure/database/models/BrainConfigModel.js';
import { Types } from 'mongoose';

// ============== Training Types ==============

export interface TrainingConfig {
  learningRate: number;
  epochs: number;
  batchSize: number;
  sequenceLength: number;
  temperature: number;
}

export interface TrainingResult {
  finalLoss: number;
  epochsCompleted: number;
  averageLoss: number;
}

export type TrainingCorpus = string[];

// ============== Default Corpus ==============

const DEFAULT_PAYLOAD_CORPUS: string[] = [
  // XSS payloads
  `"><script>alert(1)</script>`,
  `<img src=x onerror=alert(1)>`,
  `"><svg/onload=confirm(1)>`,
  `<script>console.error("xss")</script>`,
  `javascript:alert(1)`,
  `<body onload=alert(1)>`,
  `<iframe src=javascript:alert(1)>`,
  `<input onfocus=alert(1) autofocus>`,
  
  // SQL Injection payloads
  `' OR 1=1 --`,
  `' UNION SELECT password FROM users --`,
  `" OR "1"="1`,
  `1=1; DROP TABLE users`,
  `' OR 'x'='x`,
  `admin'--`,
  `' OR 1=1#`,
  `' OR '1'='1' --`,
  
  // NoSQL Injection
  `{"$ne": null}`,
  `{"$gt": ""}`,
  `{"$regex": ".*"}`,
  `{"$where": "this.password.length > 0"}`,
  
  // Path Traversal
  `../../../../etc/passwd`,
  `..\\..\\..\\..\\windows\\system32\\config\\sam`,
  `....//....//....//etc/passwd`,
  `/etc/passwd`,
  `C:\\Windows\\System32\\drivers\\etc\\hosts`,
  
  // Command Injection
  `; ls -la`,
  `| cat /etc/passwd`,
  `&& whoami`,
  `|| id`,
  `$(${`whoami`})`,
  
  // Template Injection
  `{{7*7}}`,
  `${7*7}`,
  `<%= 7*7 %>`,
  `#{7*7}`,
  
  // Deserialization
  `{"rce": "__import__('os').system('ls')}"}`,
  `O:14:"VulnerableClass":1:{s:4:"data";s:8:"malicious";}`,
  
  // Null/Empty bypass
  `\u0000\u0000NULL\u0000`,
  `%00`,
  `%00%00`,
  `undefined`,
  `null`,
  
  // Buffer Overflow probes
  `A`.repeat(1000),
  `A`.repeat(5000),
  
  // Format String
  `%s%s%s%s`,
  `{.0..2047}`,
  
  // Various injectors
  `"><iframe src=x>`,
  `'-->`,
  `]]>`,
  `</script><script>alert(1)</script>`,
];

// ============== Cached Network ==============

let cachedNetwork: LSTMNetwork | null = null;

// ============== Loss Functions ==============

function crossEntropyLoss(predictions: number[], targets: number[]): number {
  let loss = 0;
  for (let i = 0; i < predictions.length; i++) {
    const p = Math.max(1e-10, Math.min(1 - 1e-10, predictions[i]));
    loss -= targets[i] * Math.log(p);
  }
  return loss / predictions.length;
}

// ============== Optimizer Interfaces ==============

interface OptimizerState {
  learningRate: number;
}

interface WeightGradients {
  dWix: number[][]; dWih: number[][]; dWic: number[][]; dBi: number[];
  dWfx: number[][]; dWfh: number[][]; dWfc: number[][]; dBf: number[];
  dWcx: number[][]; dWch: number[][]; dBc: number[];
  dWox: number[][]; dWoh: number[][]; dWoc: number[][]; dBo: number[];
  dWhy: number[][]; dBy: number[];
}

// ============== Optimizer Classes ==============

/**
 * SGD Optimizer with optional momentum and weight decay
 */
export class SGDOptimizer {
  private readonly learningRate: number;
  private readonly momentum: number;
  private readonly weightDecay: number;
  private velocity: Map<string, number[][]> = new Map();

  constructor(options: { learningRate: number; momentum?: number; weightDecay?: number } = { learningRate: 0.1 }) {
    this.learningRate = options.learningRate;
    this.momentum = options.momentum ?? 0;
    this.weightDecay = options.weightDecay ?? 0;
  }

  public step(grads: WeightGradients): void {
    // For SGD with momentum, we'd need to store velocity
    // This is a simple SGD implementation for now
  }

  public getLearningRate(): number {
    return this.learningRate;
  }

  public apply(grads: WeightGradients, scale: number = 1.0): WeightGradients {
    const lr = this.learningRate * scale;
    
    // Apply weight decay first
    if (this.weightDecay > 0) {
      return this.applyWithDecay(grads, lr);
    }
    
    return this.scaleGradients(grads, lr);
  }

  private scaleGradients(grads: WeightGradients, scale: number): WeightGradients {
    return {
      dWix: this.scaleMatrix(grads.dWix, scale),
      dWih: this.scaleMatrix(grads.dWih, scale),
      dWic: this.scaleMatrix(grads.dWic, scale),
      dBi: this.scaleVector(grads.dBi, scale),
      dWfx: this.scaleMatrix(grads.dWfx, scale),
      dWfh: this.scaleMatrix(grads.dWfh, scale),
      dWfc: this.scaleMatrix(grads.dWfc, scale),
      dBf: this.scaleVector(grads.dBf, scale),
      dWcx: this.scaleMatrix(grads.dWcx, scale),
      dWch: this.scaleMatrix(grads.dWch, scale),
      dBc: this.scaleVector(grads.dBc, scale),
      dWox: this.scaleMatrix(grads.dWox, scale),
      dWoh: this.scaleMatrix(grads.dWoh, scale),
      dWoc: this.scaleMatrix(grads.dWoc, scale),
      dBo: this.scaleVector(grads.dBo, scale),
      dWhy: this.scaleMatrix(grads.dWhy, scale),
      dBy: this.scaleVector(grads.dBy, scale),
    };
  }

  private applyWithDecay(grads: WeightGradients, lr: number): WeightGradients {
    const wd = this.weightDecay;
    return {
      dWix: this.scaleMatrix(grads.dWix, lr).map((row, i) => row.map((v, j) => v + wd * grads.dWix[i][j])),
      dWih: this.scaleMatrix(grads.dWih, lr).map((row, i) => row.map((v, j) => v + wd * grads.dWih[i][j])),
      dWic: this.scaleMatrix(grads.dWic, lr).map((row, i) => row.map((v, j) => v + wd * grads.dWic[i][j])),
      dBi: this.scaleVector(grads.dBi, lr).map((v, i) => v + wd * grads.dBi[i]),
      dWfx: this.scaleMatrix(grads.dWfx, lr).map((row, i) => row.map((v, j) => v + wd * grads.dWfx[i][j])),
      dWfh: this.scaleMatrix(grads.dWfh, lr).map((row, i) => row.map((v, j) => v + wd * grads.dWfh[i][j])),
      dWfc: this.scaleMatrix(grads.dWfc, lr).map((row, i) => row.map((v, j) => v + wd * grads.dWfc[i][j])),
      dBf: this.scaleVector(grads.dBf, lr).map((v, i) => v + wd * grads.dBf[i]),
      dWcx: this.scaleMatrix(grads.dWcx, lr).map((row, i) => row.map((v, j) => v + wd * grads.dWcx[i][j])),
      dWch: this.scaleMatrix(grads.dWch, lr).map((row, i) => row.map((v, j) => v + wd * grads.dWch[i][j])),
      dBc: this.scaleVector(grads.dBc, lr).map((v, i) => v + wd * grads.dBc[i]),
      dWox: this.scaleMatrix(grads.dWox, lr).map((row, i) => row.map((v, j) => v + wd * grads.dWox[i][j])),
      dWoh: this.scaleMatrix(grads.dWoh, lr).map((row, i) => row.map((v, j) => v + wd * grads.dWoh[i][j])),
      dWoc: this.scaleMatrix(grads.dWoc, lr).map((row, i) => row.map((v, j) => v + wd * grads.dWoc[i][j])),
      dBo: this.scaleVector(grads.dBo, lr).map((v, i) => v + wd * grads.dBo[i]),
      dWhy: this.scaleMatrix(grads.dWhy, lr).map((row, i) => row.map((v, j) => v + wd * grads.dWhy[i][j])),
      dBy: this.scaleVector(grads.dBy, lr).map((v, i) => v + wd * grads.dBy[i]),
    };
  }

  private scaleMatrix(m: number[][], scale: number): number[][] {
    return m.map(row => row.map(v => v * scale));
  }

  private scaleVector(v: number[], scale: number): number[] {
    return v.map(val => val * scale);
  }
}

/**
 * Adam Optimizer with adaptive learning rates
 */
export class AdamOptimizer {
  private readonly learningRate: number;
  private readonly beta1: number;
  private readonly beta2: number;
  private readonly epsilon: number;
  private m: Map<string, number[][] | number[]> = new Map();
  private v: Map<string, number[][] | number[]> = new Map();
  private t: number = 0;

  constructor(options: { learningRate?: number; beta1?: number; beta2?: number; epsilon?: number } = {}) {
    this.learningRate = options.learningRate ?? 0.001;
    this.beta1 = options.beta1 ?? 0.9;
    this.beta2 = options.beta2 ?? 0.999;
    this.epsilon = options.epsilon ?? 1e-8;
  }

  public step(grads: WeightGradients): void {
    this.t++;
  }

  public getLearningRate(): number {
    return this.learningRate;
  }

public apply(grads: WeightGradients): WeightGradients {
    this.t++;
    // Compute bias-corrected learning rate with numerical stability guards
    const beta1PowT = Math.pow(this.beta1, this.t);
    const beta2PowT = Math.pow(this.beta2, this.t);
    const denom1 = 1 - beta1PowT;
    const denom2 = 1 - beta2PowT;
    
    // Guard against division by near-zero (when t is very large, beta^t approaches 0)
    const safeDenom1 = Math.max(denom1, 1e-10);
    const safeDenom2 = Math.max(denom2, 1e-10);
    
    const lr = this.learningRate * Math.sqrt(safeDenom2) / safeDenom1;
    
    return {
      dWix: this.applyAdam(grads.dWix, 'dWix', lr),
      dWih: this.applyAdam(grads.dWih, 'dWih', lr),
      dWic: this.applyAdam(grads.dWic, 'dWic', lr),
      dBi: this.applyAdamVec(grads.dBi, 'dBi', lr),
      dWfx: this.applyAdam(grads.dWfx, 'dWfx', lr),
      dWfh: this.applyAdam(grads.dWfh, 'dWfh', lr),
      dWfc: this.applyAdam(grads.dWfc, 'dWfc', lr),
      dBf: this.applyAdamVec(grads.dBf, 'dBf', lr),
      dWcx: this.applyAdam(grads.dWcx, 'dWcx', lr),
      dWch: this.applyAdam(grads.dWch, 'dWch', lr),
      dBc: this.applyAdamVec(grads.dBc, 'dBc', lr),
      dWox: this.applyAdam(grads.dWox, 'dWox', lr),
      dWoh: this.applyAdam(grads.dWoh, 'dWoh', lr),
      dWoc: this.applyAdam(grads.dWoc, 'dWoc', lr),
      dBo: this.applyAdamVec(grads.dBo, 'dBo', lr),
      dWhy: this.applyAdam(grads.dWhy, 'dWhy', lr),
      dBy: this.applyAdamVec(grads.dBy, 'dBy', lr),
    };
  }

private applyAdam(grads: number[][], key: string, lr: number): number[][] {
    // Get existing or create new matrices - must explicitly check to get reference
    // Cast to handle both matrix and vector storage in same map
    let m = this.m.get(key) as number[][] | undefined;
    let v = this.v.get(key) as number[][] | undefined;
    if (!m) {
      m = this.zeroMatrix(grads.length, grads[0].length);
      this.m.set(key, m);
    }
    if (!v) {
      v = this.zeroMatrix(grads.length, grads[0].length);
      this.v.set(key, v);
    }
    
    // Pre-compute bias correction denominators with numerical stability
    const beta1PowT = Math.pow(this.beta1, this.t);
    const beta2PowT = Math.pow(this.beta2, this.t);
    const mDenom = Math.max(1 - beta1PowT, 1e-10);
    const vDenom = Math.max(1 - beta2PowT, 1e-10);
    
    const result: number[][] = [];
    for (let i = 0; i < grads.length; i++) {
      result[i] = [];
      for (let j = 0; j < grads[i].length; j++) {
        // Update biased first moment estimate in-place (mutates stored reference)
        m[i][j] = this.beta1 * m[i][j] + (1 - this.beta1) * grads[i][j];
        // Update biased second moment estimate in-place (mutates stored reference)
        v[i][j] = this.beta2 * v[i][j] + (1 - this.beta2) * grads[i][j] * grads[i][j];
        
        // Compute bias-corrected estimates
        const mHat = m[i][j] / mDenom;
        const vHat = v[i][j] / vDenom;
        
        // Compute update with numerical stability
        const sqrtVHat = Math.sqrt(vHat);
        const denom = sqrtVHat + this.epsilon;
        const update = lr * mHat / denom;
        
        // Handle NaN/infinite values
        result[i][j] = (isFinite(update) ? update : 0);
      }
    }
    
    return result;
  }

private applyAdamVec(grads: number[], key: string, lr: number): number[] {
    // Get existing or create new vectors - must explicitly check to get reference
    // Cast to handle both matrix and vector storage in same map
    let m = this.m.get(key) as number[] | undefined;
    let v = this.v.get(key) as number[] | undefined;
    if (!m) {
      m = this.zeroVector(grads.length);
      this.m.set(key, m);
    }
    if (!v) {
      v = this.zeroVector(grads.length);
      this.v.set(key, v);
    }
    
    // Pre-compute bias correction denominators with numerical stability
    const beta1PowT = Math.pow(this.beta1, this.t);
    const beta2PowT = Math.pow(this.beta2, this.t);
    const mDenom = Math.max(1 - beta1PowT, 1e-10);
    const vDenom = Math.max(1 - beta2PowT, 1e-10);
    
    const result: number[] = [];
    for (let i = 0; i < grads.length; i++) {
      // Update biased first moment estimate in-place (mutates stored reference)
      m[i] = this.beta1 * m[i] + (1 - this.beta1) * grads[i];
      // Update biased second moment estimate in-place (mutates stored reference)
      v[i] = this.beta2 * v[i] + (1 - this.beta2) * grads[i] * grads[i];
      
      // Compute bias-corrected estimates
      const mHat = m[i] / mDenom;
      const vHat = v[i] / vDenom;
      
      // Compute update with numerical stability
      const sqrtVHat = Math.sqrt(vHat);
      const denom = sqrtVHat + this.epsilon;
      const update = lr * mHat / denom;
      
      // Handle NaN/infinite values
      result[i] = (isFinite(update) ? update : 0);
    }
    
    return result;
  }

  private zeroMatrix(rows: number, cols: number): number[][] {
    return Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0));
  }

  private zeroVector(size: number): number[] {
    return Array.from({ length: size }, () => 0);
  }
}

function meanSquaredError(predictions: number[], targets: number[]): number {
  let sum = 0;
  for (let i = 0; i < predictions.length; i++) {
    const diff = predictions[i] - targets[i];
    sum += diff * diff;
  }
  return sum / predictions.length;
}

// ============== Trainer Class ==============

export class LSTMTrainer {
  private readonly network: LSTMNetwork;
  private readonly corpus: string[];
  private readonly config: TrainingConfig;
  private optimizer: SGDOptimizer | AdamOptimizer;
  private readonly gradientClipThreshold: number = 5.0;
  private readonly teacherForcingRatio: number = 0.5;
  private useAdam: boolean = false;

  constructor(
    network: LSTMNetwork,
    corpus: string[] = DEFAULT_PAYLOAD_CORPUS,
    config?: Partial<TrainingConfig> & { useAdam?: boolean; teacherForcingRatio?: number }
  ) {
    this.network = network;
    this.corpus = corpus;
    this.config = {
      learningRate: config?.learningRate ?? 0.1,
      epochs: config?.epochs ?? 50,
      batchSize: config?.batchSize ?? 32,
      sequenceLength: config?.sequenceLength ?? 50,
      temperature: config?.temperature ?? 1.0,
    };
    this.useAdam = config?.useAdam ?? false;
    this.teacherForcingRatio = config?.teacherForcingRatio ?? 0.5;
    
    // Initialize optimizer
    this.optimizer = this.useAdam 
      ? new AdamOptimizer({ learningRate: this.config.learningRate })
      : new SGDOptimizer({ learningRate: this.config.learningRate });
  }

  /**
   * Main training method with proper BPTT
   */
  public async train(
    onProgress?: (epoch: number, loss: number) => void
  ): Promise<TrainingResult> {
    const { epochs, batchSize, sequenceLength, learningRate } = this.config;
    let totalLoss = 0;
    let epochsCompleted = 0;

    console.log(`[LSTMTrainer] Starting training for ${epochs} epochs (useAdam: ${this.useAdam})...`);

    for (let epoch = 0; epoch < epochs; epoch++) {
      let epochLoss = 0;
      let batchCount = 0;

      // Shuffle corpus for this epoch
      const shuffled = this.shuffleArray([...this.corpus]);

      for (let batchIdx = 0; batchIdx < shuffled.length; batchIdx += batchSize) {
        const batch = shuffled.slice(batchIdx, batchIdx + batchSize);
        
        // Accumulate gradients over batch
        const accumulatedGrads = this.createEmptyGrads();
        let batchLoss = 0;

        for (const sample of batch) {
          const result = this.trainOnSampleWithBPTT(sample, sequenceLength);
          if (result.loss > 0) {
            batchLoss += result.loss;
            // Accumulate gradients
            this.accumulateGrads(accumulatedGrads, result.grads);
          }
        }

        if (batchLoss > 0) {
          epochLoss += batchLoss / batch.length;
          batchCount++;
          
          // Apply gradient clipping
          this.clipGradients(accumulatedGrads);
          
          // Apply optimizer and update weights
          const scaledGrads = this.useAdam 
            ? (this.optimizer as AdamOptimizer).apply(accumulatedGrads)
            : (this.optimizer as SGDOptimizer).apply(accumulatedGrads);
          
          // Access the cell directly and apply gradients  
          this.applyGradsToNetwork(scaledGrads);
        }
      }

// Guard against division by zero when no valid batches in epoch
      if (batchCount > 0) {
        totalLoss += epochLoss / batchCount;
      }
      epochsCompleted = epoch + 1;

      if (onProgress) {
        onProgress(epoch + 1, epochLoss / batchCount);
      }

      if ((epoch + 1) % 10 === 0) {
        console.log(
          `[LSTMTrainer] Epoch ${epoch + 1}/${epochs}, Loss: ${(epochLoss / batchCount).toFixed(4)}`
        );
      }

      // Allow event loop to process
      if (epoch % 5 === 0) {
        await this.sleep(0);
      }
    }

    const averageLoss = totalLoss / epochs;

    console.log(`[LSTMTrainer] Training complete. Average Loss: ${averageLoss.toFixed(4)}`);

    return {
      finalLoss: totalLoss,
      epochsCompleted,
      averageLoss,
    };
  }

/**
   * Create empty gradients object for accumulation
   */
  private createEmptyGrads(): WeightGradients {
    const { hiddenSize, inputSize, outputSize } = this.getNetworkConfig();
    return {
      dWix: this.zeroMatrix(hiddenSize, inputSize),
      dWih: this.zeroMatrix(hiddenSize, hiddenSize),
      dWic: this.zeroMatrix(hiddenSize, hiddenSize),
      dBi: this.zeroVector(hiddenSize),
      dWfx: this.zeroMatrix(hiddenSize, inputSize),
      dWfh: this.zeroMatrix(hiddenSize, hiddenSize),
      dWfc: this.zeroMatrix(hiddenSize, hiddenSize),
      dBf: this.zeroVector(hiddenSize),
      dWcx: this.zeroMatrix(hiddenSize, inputSize),
      dWch: this.zeroMatrix(hiddenSize, hiddenSize),
      dBc: this.zeroVector(hiddenSize),
      dWox: this.zeroMatrix(hiddenSize, inputSize),
      dWoh: this.zeroMatrix(hiddenSize, hiddenSize),
      dWoc: this.zeroMatrix(hiddenSize, hiddenSize),
      dBo: this.zeroVector(hiddenSize),
      dWhy: this.zeroMatrix(outputSize, hiddenSize),
      dBy: this.zeroVector(outputSize),
    };
  }

  private getNetworkConfig() {
    const config = (this.network as any).config;
    return { 
      hiddenSize: config?.hiddenSize ?? 128, 
      inputSize: config?.inputSize ?? 90, 
      outputSize: config?.outputSize ?? 90 
    };
  }

  private zeroMatrix(rows: number, cols: number): number[][] {
    return Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0));
  }

  private zeroVector(size: number): number[] {
    return Array.from({ length: size }, () => 0);
  }

/**
   * Accumulate gradients into accumulator - explicit field handling
   */
  private accumulateGrads(accum: WeightGradients, grads: WeightGradients): void {
    // Matrices
    this.addMatrixInPlace(accum.dWix, grads.dWix);
    this.addMatrixInPlace(accum.dWih, grads.dWih);
    this.addMatrixInPlace(accum.dWic, grads.dWic);
    this.addMatrixInPlace(accum.dWfx, grads.dWfx);
    this.addMatrixInPlace(accum.dWfh, grads.dWfh);
    this.addMatrixInPlace(accum.dWfc, grads.dWfc);
    this.addMatrixInPlace(accum.dWcx, grads.dWcx);
    this.addMatrixInPlace(accum.dWch, grads.dWch);
    this.addMatrixInPlace(accum.dWox, grads.dWox);
    this.addMatrixInPlace(accum.dWoh, grads.dWoh);
    this.addMatrixInPlace(accum.dWoc, grads.dWoc);
    this.addMatrixInPlace(accum.dWhy, grads.dWhy);
    // Vectors
    this.addVectorInPlace(accum.dBi, grads.dBi);
    this.addVectorInPlace(accum.dBf, grads.dBf);
    this.addVectorInPlace(accum.dBc, grads.dBc);
    this.addVectorInPlace(accum.dBo, grads.dBo);
    this.addVectorInPlace(accum.dBy, grads.dBy);
  }

  private addMatrixInPlace(target: number[][], source: number[][]): void {
    for (let i = 0; i < target.length; i++) {
      for (let j = 0; j < target[i].length; j++) {
        target[i][j] += source[i][j];
      }
    }
  }

  private addVectorInPlace(target: number[], source: number[]): void {
    for (let i = 0; i < target.length; i++) {
      target[i] += source[i];
    }
  }

/**
   * Clip gradients to prevent exploding gradients
   */
  private clipGradients(grads: WeightGradients): void {
    let maxNorm = 0;
    
    // Calculate total gradient norm
    for (const key of Object.keys(grads) as (keyof WeightGradients)[]) {
      const g = (grads as any)[key];
      if (Array.isArray(g) && g.length > 0) {
        if (Array.isArray(g[0])) {
          // Matrix
          for (const row of g as number[][]) {
            for (const val of row) {
              maxNorm += val * val;
            }
          }
        } else {
          // Vector
          for (const val of g as number[]) {
            maxNorm += val * val;
          }
        }
      }
    }
    
    maxNorm = Math.sqrt(maxNorm);
    
    // Clip if needed
    if (maxNorm > this.gradientClipThreshold) {
      const scale = this.gradientClipThreshold / maxNorm;
      for (const key of Object.keys(grads) as (keyof WeightGradients)[]) {
        const g = (grads as any)[key];
        if (Array.isArray(g) && g.length > 0) {
          if (Array.isArray(g[0])) {
            // Matrix
            for (let i = 0; i < g.length; i++) {
              for (let j = 0; j < g[i].length; j++) {
                g[i][j] *= scale;
              }
            }
          } else {
            // Vector
            for (let i = 0; i < g.length; i++) {
              g[i] *= scale;
            }
          }
        }
      }
    }
  }

  /**
   * Apply gradients to network weights
   */
  private applyGradsToNetwork(grads: WeightGradients): void {
    // Use reflection to access the internal cell
    const cell = (this.network as any).cells?.[0];
    if (cell && typeof cell.applyGradients === 'function') {
      cell.applyGradients(this.config.learningRate, grads);
    }
  }

  /**
   * Training with BPTT - computes forward pass, loss, and gradients
   */
  private trainOnSampleWithBPTT(
    sample: string,
    sequenceLength: number
  ): { loss: number; grads: WeightGradients } {
    const encoded = this.network.encode(sample);
    
    if (encoded.length < 2) {
      return { loss: 0, grads: this.createEmptyGrads() };
    }

    const truncated = encoded.slice(0, Math.min(sequenceLength + 1, encoded.length));
    const { hiddenSize, inputSize, outputSize } = this.getNetworkConfig();
    
    // Initialize states
    let hidden: number[] = this.zeroVector(hiddenSize);
    let cell: number[] = this.zeroVector(hiddenSize);
    let totalLoss = 0;
    
    // Accumulate weight gradients
    const accumGrads = this.createEmptyGrads();
    
    // Forward pass through sequence with teacher forcing option
    const useTeacherForcing = Math.random() < this.teacherForcingRatio;
    
    for (let t = 0; t < truncated.length - 1; t++) {
      // Input: one-hot encode character
      const inputVec = this.zeroVector(inputSize);
      const charIdx = truncated[t];
      if (charIdx < inputSize) {
        inputVec[charIdx] = 1;
      }
      
      // Target
      const targetIdx = truncated[t + 1];
      
      // Forward pass with caching
      const forwardResult = (this.network as any).cells?.[0]?.forwardWithCache?.(inputVec, hidden, cell);
      
      if (!forwardResult) {
        // Fallback: use simple forward if cache not available
        const simpleResult = (this.network as any).cells?.[0]?.forward?.(inputVec, hidden, cell);
        if (!simpleResult) break;
        hidden = simpleResult.hidden;
        cell = simpleResult.cell;
        continue;
      }
      
      const { output, hidden: newHidden, cell: newCell, cache } = forwardResult;
      hidden = newHidden;
      cell = newCell;
      
      // Compute softmax and cross-entropy loss
      const probs = this.softmax(output);
      const targetProbs = this.zeroVector(outputSize);
      targetProbs[targetIdx] = 1;
      
      const loss = this.computeCrossEntropy(probs, targetProbs);
      totalLoss += loss;
      
      // Compute output gradient: dL/dy = probs - target
      const gradOutput = probs.map((p, i) => p - targetProbs[i]);
      
      // Backprop through the cell
      const gradHidden = this.zeroVector(hiddenSize);
      const gradCell = this.zeroVector(hiddenSize);
      
      const backpropResult = (this.network as any).cells?.[0]?.backprop?.(cache, gradOutput, gradHidden, gradCell);
      
      if (backpropResult) {
        const weightGrads = (this.network as any).cells?.[0]?.getWeightGrads?.();
        if (weightGrads) {
          this.accumulateGrads(accumGrads, weightGrads);
        }
      }
    }
    
    return {
      loss: totalLoss / Math.max(1, truncated.length - 1),
      grads: accumGrads,
    };
  }

  private softmax(arr: number[]): number[] {
    const max = Math.max(...arr);
    const exps = arr.map(x => Math.exp(x - max));
    const sum = exps.reduce((a, b) => a + b, 0);
    return exps.map(x => x / sum);
  }

private computeCrossEntropy(probs: number[], targets: number[]): number {
    let loss = 0;
    let count = 0;
    for (let i = 0; i < probs.length; i++) {
      // Guard against NaN values FIRST before any computation
      if (!isFinite(probs[i]) || !isFinite(targets[i])) {
        continue;
      }
      // Clamp probability to avoid log(0)
      const p = Math.max(1e-10, probs[i]);
      loss -= targets[i] * Math.log(p);
      count++;
    }
    // Guard against division by zero (no valid elements)
    if (count === 0) {
      return 0;
    }
    const avgLoss = loss / count;
    // Guard against NaN or infinite loss
    return isFinite(avgLoss) ? avgLoss : 0;
  }

  /**
   * Legacy trainOnSample for backward compatibility 
   */
  private trainOnSample(
    sample: string,
    sequenceLength: number,
    learningRate: number
  ): number {
    const result = this.trainOnSampleWithBPTT(sample, sequenceLength);
    return result.loss;
  }

  private shuffleArray<T>(array: T[]): T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  public getNetwork(): LSTMNetwork {
    return this.network;
  }

  public getCorpus(): string[] {
    return [...this.corpus];
  }

  public addToCorpus(payloads: string[]): void {
    for (const payload of payloads) {
      if (!this.corpus.includes(payload)) {
        this.corpus.push(payload);
      }
    }
  }
}

// ============== Pre-trained Network ==============

/**
 * Get a pre-trained LSTM network (singleton)
 */
export function getPreTrainedNetwork(): LSTMNetwork {
  if (!cachedNetwork) {
    cachedNetwork = createLSTMNetwork(128);
    
    const trainer = new LSTMTrainer(
      cachedNetwork,
      DEFAULT_PAYLOAD_CORPUS,
      { learningRate: 0.1, epochs: 30, batchSize: 32, sequenceLength: 50, temperature: 1.0 }
    );
    trainer.train();
  }
  return cachedNetwork;
}

// ============== Factory Functions ==============

export function createTrainedNetwork(
  hiddenSize = 128,
  corpus?: string[],
  config?: Partial<TrainingConfig>
): LSTMNetwork {
  const network = createLSTMNetwork(hiddenSize);

  const trainer = new LSTMTrainer(
    network,
    corpus ?? DEFAULT_PAYLOAD_CORPUS,
    config ?? { learningRate: 0.1, epochs: 50, batchSize: 32, sequenceLength: 50, temperature: 1.0 }
  );
  trainer.train();

  return network;
}

// ============== Persistence Functions ==============

/**
 * Save LSTM network weights to MongoDB
 */
export async function saveNetworkWeights(
  sessionId: string,
  network: LSTMNetwork
): Promise<void> {
  try {
    const weights = network.exportWeights();
    // Serialize weights to flat arrays for storage
    const weightsMap = serializeWeights(weights);

    await BrainConfigModel.create({
      sessionId: new Types.ObjectId(sessionId),
      source: 'runtime',
      bias: 0,
      weights: weightsMap,
    });

    console.log(`[LSTMTrainer] Saved network weights for session ${sessionId}`);
  } catch (error) {
    console.error(`[LSTMTrainer] Failed to save network weights:`, error);
  }
}

/**
 * Load LSTM network weights from MongoDB
 */
export async function loadNetworkWeights(
  sessionId: string,
  network: LSTMNetwork
): Promise<boolean> {
  try {
    const config = await BrainConfigModel.findOne({ sessionId: new Types.ObjectId(sessionId) }).sort({ capturedAt: -1 });

    if (!config) {
      console.log(`[LSTMTrainer] No saved weights found for session ${sessionId}`);
      return false;
    }

    // Get the weights Map from the database
    const dbWeights = config.weights;

    // Get the config dimensions from the network
    const netConfig = (network as any).config;

    // Deserialize back to LSTMWeights structure
    const weights = deserializeWeights(dbWeights, netConfig);

    // Import the weights into the network
    network.importWeights(weights);

    console.log(`[LSTMTrainer] Loaded network weights for session ${sessionId}`);
    return true;
  } catch (error) {
    console.error(`[LSTMTrainer] Failed to load network weights:`, error);
    return false;
  }
}

export { DEFAULT_PAYLOAD_CORPUS };

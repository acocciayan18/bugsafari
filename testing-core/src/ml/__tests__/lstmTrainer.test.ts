/**
 * Unit tests for LSTM Trainer
 * Tests optimizers, loss functions, training loop
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LSTMTrainer, SGDOptimizer, AdamOptimizer, DEFAULT_PAYLOAD_CORPUS } from '../lstmTrainer.js';
import { LSTMNetwork, createLSTMNetwork } from '../lstmNetwork.js';

describe('SGDOptimizer', () => {
  let optimizer: SGDOptimizer;
  
  beforeEach(() => {
    optimizer = new SGDOptimizer({ learningRate: 0.1 });
  });

  it('should have default learning rate', () => {
    expect(optimizer.getLearningRate()).toBe(0.1);
  });

  it('should apply gradients with scaling', () => {
    const grads = {
      dWix: [[0.1]], dWih: [[0.1]], dWic: [[0.1]], dBi: [0.1],
      dWfx: [[0.1]], dWfh: [[0.1]], dWfc: [[0.1]], dBf: [0.1],
      dWcx: [[0.1]], dWch: [[0.1]], dBc: [0.1],
      dWox: [[0.1]], dWoh: [[0.1]], dWoc: [[0.1]], dBo: [0.1],
      dWhy: [[0.1]], dBy: [0.1],
    };
    
    const scaled = optimizer.apply(grads, 1.0);
    
    // Should scale gradients by learning rate
    expect(scaled.dWix[0][0]).toBeCloseTo(0.01);
  });
});

describe('AdamOptimizer', () => {
  let optimizer: AdamOptimizer;
  
  beforeEach(() => {
    optimizer = new AdamOptimizer({ learningRate: 0.001 });
  });

  it('should have default learning rate', () => {
    expect(optimizer.getLearningRate()).toBe(0.001);
  });

  it('should apply adaptive gradients', () => {
    const grads = {
      dWix: [[0.1]], dWih: [[0.1]], dWic: [[0.1]], dBi: [0.1],
      dWfx: [[0.1]], dWfh: [[0.1]], dWfc: [[0.1]], dBf: [0.1],
      dWcx: [[0.1]], dWch: [[0.1]], dBc: [0.1],
      dWox: [[0.1]], dWoh: [[0.1]], dWoc: [[0.1]], dBo: [0.1],
      dWhy: [[0.1]], dBy: [0.1],
    };
    
    // First call initializes momentum
    const scaled1 = optimizer.apply(grads);
    expect(scaled1.dWix).toBeDefined();
    
    // Second call should use momentum
    const scaled2 = optimizer.apply(grads);
    expect(scaled2.dWix[0][0]).not.toBe(scaled1.dWix[0][0]);
  });
});

describe('LSTMTrainer', () => {
  let network: LSTMNetwork;
  let trainer: LSTMTrainer;
  
  beforeEach(() => {
    network = createLSTMNetwork(32);
    trainer = new LSTMTrainer(network, DEFAULT_PAYLOAD_CORPUS.slice(0, 5), {
      learningRate: 0.1,
      epochs: 2,
      batchSize: 2,
      sequenceLength: 20,
    });
  });

  it('should create trainer with corpus', () => {
    expect(trainer.getCorpus().length).toBe(5);
  });

  it('should add payloads to corpus', () => {
    trainer.addToCorpus(['new payload']);
    expect(trainer.getCorpus().length).toBe(6);
  });

  it('should deduplicate payloads', () => {
    trainer.addToCorpus(['new payload', 'new payload']);
    expect(trainer.getCorpus().length).toBe(6);
  });

  it('should train without NaN loss', async () => {
    const result = await trainer.train();
    
    // Loss should be finite number
    expect(Number.isFinite(result.finalLoss)).toBe(true);
    expect(Number.isFinite(result.averageLoss)).toBe(true);
    expect(result.epochsCompleted).toBe(2);
  });
});

describe('LSTMTrainer with custom config', () => {
  it('should use Adam optimizer when configured', async () => {
    const network = createLSTMNetwork(16);
    const trainer = new LSTMTrainer(network, DEFAULT_PAYLOAD_CORPUS.slice(0, 3), {
      learningRate: 0.001,
      epochs: 1,
      batchSize: 1,
      sequenceLength: 10,
      useAdam: true,
    });
    
    const result = await trainer.train();
    
    expect(Number.isFinite(result.finalLoss)).toBe(true);
  });
});

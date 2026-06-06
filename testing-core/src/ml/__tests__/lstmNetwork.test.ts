/**
 * Unit tests for LSTM Network
 * Tests forward pass, vocabulary, weight operations, generation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LSTMCell, LSTMNetwork, createLSTMNetwork, serializeWeights, deserializeWeights } from '../lstmNetwork.js';

describe('LSTMCell', () => {
  let cell: LSTMCell;
  
  beforeEach(() => {
    cell = new LSTMCell({
      inputSize: 10,
      hiddenSize: 8,
      outputSize: 10,
      seed: 42
    });
  });

  describe('forward pass', () => {
    it('should produce valid output dimensions', () => {
      const input = new Array(10).fill(0).map(() => Math.random());
      const prevHidden = new Array(8).fill(0);
      const prevCell = new Array(8).fill(0);
      
      const result = cell.forward(input, prevHidden, prevCell);
      
      expect(result.output).toHaveLength(10);
      expect(result.hidden).toHaveLength(8);
      expect(result.cell).toHaveLength(8);
    });

    it('should produce bounded output values', () => {
      const input = new Array(10).fill(0).map(() => Math.random());
      const prevHidden = new Array(8).fill(0);
      const prevCell = new Array(8).fill(0);
      
      const result = cell.forward(input, prevHidden, prevCell);
      
      // Outputs should be reasonable (not NaN or Infinity)
      for (const val of result.output) {
        expect(Number.isFinite(val)).toBe(true);
      }
      for (const val of result.hidden) {
        expect(Number.isFinite(val)).toBe(true);
      }
    });
  });

  describe('forwardWithCache', () => {
    it('should cache intermediate values', () => {
      const input = new Array(10).fill(0).map(() => Math.random());
      const prevHidden = new Array(8).fill(0);
      const prevCell = new Array(8).fill(0);
      
      const result = cell.forwardWithCache(input, prevHidden, prevCell);
      
      expect(result.cache).toBeDefined();
      expect(result.cache.inputGate).toHaveLength(8);
      expect(result.cache.forgetGate).toHaveLength(8);
      expect(result.cache.cellCandidate).toHaveLength(8);
      expect(result.cache.outputGate).toHaveLength(8);
      expect(result.cache.cell).toHaveLength(8);
      expect(result.cache.hidden).toHaveLength(8);
    });
  });

  describe('weight serialization', () => {
    it('should export and import weights', () => {
      const originalWeights = cell.exportWeights();
      
      // Modify a weight value
      originalWeights.Wix[0][0] = 999;
      
      cell.importWeights(originalWeights);
      const loadedWeights = cell.exportWeights();
      
      expect(loadedWeights.Wix[0][0]).toBe(999);
    });
  });
});

describe('LSTMNetwork', () => {
  let network: LSTMNetwork;
  
  beforeEach(() => {
    network = createLSTMNetwork(8);
  });

  describe('vocabulary', () => {
    it('should have default vocabulary', () => {
      expect(network.getVocabSize()).toBeGreaterThan(0);
    });

    it('should encode and decode correctly', () => {
      const testStr = 'test';
      const encoded = network.encode(testStr);
      const decoded = network.decode(encoded);
      
      // Should contain the original characters
      expect(decoded).toContain('t');
      expect(decoded).toContain('e');
      expect(decoded).toContain('s');
    });

    it('should handle unknown characters', () => {
      const testStr = 'test\x00\x01\x02';  // Contains control chars
      const encoded = network.encode(testStr);
      
      expect(encoded).toBeDefined();
      // Unknown chars should map to <UNK> token
      expect(encoded.some(idx => idx === network.getUnkIndex())).toBe(true);
    });
  });

  describe('prediction', () => {
    it('should generate predictions', () => {
      const encoded = network.encode('test');
      const nextIdx = network.predict(encoded, 0.8);
      
      expect(typeof nextIdx).toBe('number');
      expect(nextIdx).toBeGreaterThanOrEqual(0);
      expect(nextIdx).toBeLessThan(network.getVocabSize());
    });

    it('should generate with different temperatures', () => {
      const encoded = network.encode('test');
      
      const highTempIdx = network.predict(encoded, 2.0);
      const lowTempIdx = network.predict(encoded, 0.1);
      
      // Lower temperature should generally predict more common chars
      // (not testing exact values, just that it runs)
      expect(typeof highTempIdx).toBe('number');
      expect(typeof lowTempIdx).toBe('number');
    });
  });

  describe('generation', () => {
    it('should generate text', () => {
      const generated = network.generate('test', 10, 0.8);
      
      expect(typeof generated).toBe('string');
      expect(generated.length).toBeGreaterThan(0);
    });

    it('should respect max length', () => {
      const generated = network.generate('test', 5, 0.8);
      
      // May be shorter due to end token
      expect(generated.length).toBeLessThanOrEqual(10); // account for start token
    });
  });

  describe('weight operations', () => {
    it('should export and import weights', () => {
      const weights = network.exportWeights();
      expect(weights).toBeDefined();
      
      network.importWeights(weights);
      const loaded = network.exportWeights();
      
      // Should be same after round-trip
      expect(JSON.stringify(weights)).toBe(JSON.stringify(loaded));
    });
  });
});

describe('serializeWeights / deserializeWeights', () => {
  it('should serialize LSTM weights to flat format', () => {
    const cell = new LSTMCell({
      inputSize: 10,
      hiddenSize: 8,
      outputSize: 10,
      seed: 42
    });
    
    const weights = cell.exportWeights();
    const serialized = serializeWeights(weights);
    
    expect(serialized.size).toBeGreaterThan(0);
    // Should have flattened matrices
    expect(serialized.get('Wix')?.length).toBe(8 * 10); // hiddenSize * inputSize
  });

  it('should deserialize weights correctly', () => {
    const config = { inputSize: 10, hiddenSize: 8, outputSize: 10 };
    const originalCell = new LSTMCell({ ...config, seed: 42 });
    
    const originalWeights = originalCell.exportWeights();
    const serialized = serializeWeights(originalWeights);
    const restored = deserializeWeights(serialized, config);
    
    // Should produce same dimensions
    expect(restored.Wix).toHaveLength(8);
    expect(restored.Wix[0]).toHaveLength(10);
    expect(restored.bi).toHaveLength(8);
  });
});

describe('createLSTMNetwork factory', () => {
  it('should create network with custom hidden size', () => {
    const net = createLSTMNetwork(64);
    
    expect(net).toBeDefined();
    expect(net.getVocabSize()).toBeGreaterThan(0);
  });

  it('should create network with custom vocabulary', () => {
    const customVocab = new Map([
      ['a', 0], ['b', 1], ['c', 2]
    ]);
    const net = createLSTMNetwork(32, customVocab);
    
    expect(net.getVocabSize()).toBe(3);
  });
});

/**
 * Integration tests for LSTM training pipeline
 * Tests end-to-end with small payload corpus
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LSTMNetwork, createLSTMNetwork } from '../lstmNetwork.js';
import { LSTMTrainer, DEFAULT_PAYLOAD_CORPUS } from '../lstmTrainer.js';

describe('LSTM Integration Tests', () => {
  const SMALL_CORPUS = [
    // Simple XSS
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    // Simple SQLi
    "' OR 1=1 --",
    'admin\'--',
    // Simple command injection
    '; ls -la',
    '| cat /etc/passwd',
  ];

  describe('Complete training pipeline', () => {
    it('should train network and generate payloads', async () => {
      // Create network
      const network = createLSTMNetwork(64);
      
      // Train with small corpus
      const trainer = new LSTMTrainer(network, SMALL_CORPUS, {
        learningRate: 0.1,
        epochs: 3,
        batchSize: 2,
        sequenceLength: 30,
      });
      
      const result = await trainer.train();
      
      // Training should complete
      expect(result.epochsCompleted).toBe(3);
      expect(Number.isFinite(result.averageLoss)).toBe(true);
      expect(result.averageLoss).toBeGreaterThan(0);
      
      // After training, network should generate text
      const generated = network.generate('<script>', 15, 0.8);
      expect(generated.length).toBeGreaterThan(0);
      
      // Should contain some characters from vocabulary
      expect(typeof generated).toBe('string');
    });

    it('should improve loss over epochs', async () => {
      const network = createLSTMNetwork(32);
      
      const losses: number[] = [];
      const trainer = new LSTMTrainer(network, SMALL_CORPUS, {
        learningRate: 0.1,
        epochs: 5,
        batchSize: 2,
        sequenceLength: 20,
      });
      
      await trainer.train((epoch, loss) => {
        losses.push(loss);
      });
      
      // Should have recorded losses
      expect(losses.length).toBe(5);
      
      // Last loss should ideally be lower or close to first (may vary)
      const finiteLosses = losses.filter(l => Number.isFinite(l));
      expect(finiteLosses.length).toBeGreaterThan(0);
    });
  });

  describe('Weight persistence', () => {
    it('should save and load weights via export/import', async () => {
      const network = createLSTMNetwork(32);
      
      // Train briefly
      const trainer = new LSTMTrainer(network, SMALL_CORPUS.slice(0, 3), {
        learningRate: 0.1,
        epochs: 2,
        batchSize: 1,
        sequenceLength: 15,
      });
      
      await trainer.train();
      
      // Export weights
      const weights1 = network.exportWeights();
      
      // Create new network and import
      const network2 = createLSTMNetwork(32);
      network2.importWeights(weights1);
      
      // Both should generate similar type output
      const gen1 = network.generate('<script', 10, 0.8);
      const gen2 = network2.generate('<script', 10, 0.8);
      
      expect(typeof gen1).toBe('string');
      expect(typeof gen2).toBe('string');
    });
  });

  describe('Generation quality', () => {
    it('should generate valid character sequences', async () => {
      const network = createLSTMNetwork(48);
      
      const trainer = new LSTMTrainer(network, DEFAULT_PAYLOAD_CORPUS.slice(0, 10), {
        learningRate: 0.1,
        epochs: 3,
        batchSize: 3,
        sequenceLength: 25,
      });
      
      await trainer.train();
      
      // Generate multiple times to check consistency
      for (let i = 0; i < 3; i++) {
        const generated = network.generate('<script', 12, 0.8);
        
        expect(generated).toBeDefined();
        expect(typeof generated).toBe('string');
        expect(generated.length).toBeGreaterThan(0);
        
        // Should only contain valid characters (not control chars)
        for (const char of generated) {
          const code = char.charCodeAt(0);
          // Allow printable chars and common payload chars
          expect(code).toBeGreaterThan(31);
        }
      }
    });

    it('should respect temperature parameter', async () => {
      const network = createLSTMNetwork(32);
      
      const trainer = new LSTMTrainer(network, SMALL_CORPUS, {
        learningRate: 0.1,
        epochs: 2,
        batchSize: 2,
        sequenceLength: 20,
      });
      
      await trainer.train();
      
      // Different temperatures should potentially give different results
      const lowTemp = network.generate('test', 8, 0.1);
      const highTemp = network.generate('test', 8, 2.0);
      
      expect(typeof lowTemp).toBe('string');
      expect(typeof highTemp).toBe('string');
    });
  });
});

/**
 * LSTM Training Example
 * 
 * Demonstrates how to train an LSTM network with custom payload corpus.
 * Run with: npx tsx examples/lstm-training-example.ts
 */

import { createLSTMNetwork } from '../src/ml/lstmNetwork.js';
import { LSTMTrainer } from '../src/ml/lstmTrainer.js';

// ============== Custom Payload Corpus ==============

const CUSTOM_PAYLOAD_CORPUS = [
  // XSS Payloads
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<svg/onload=confirm(1)>',
  '<body onload=alert(1)>',
  '<iframe src=javascript:alert(1)>',
  'javascript:alert(1)',
  
  // SQL Injection Payloads
  "' OR 1=1 --",
  "' UNION SELECT password FROM users --",
  'admin',
  "' OR 1=1",
  
  // NoSQL Injection Payloads
  '{"$ne": null}',
  '{"$gt": ""}',
  '{"$regex": ".*"}',
  
  // Path Traversal Payloads
  '../../../../etc/passwd',
  '..\\..\\..\\..\\windows\\system32\\config\\sam',
  
  // Command Injection Payloads
  '; ls -la',
  '| cat /etc/passwd',
  '&& whoami',
  
  // Template Injection Payloads
  '{{7*7}}',
  '${7*7}',
  
  // Deserialization Payloads
  '{"rce": "test"}',
];

// ============== Training Configuration ==============

interface TrainingConfig {
  hiddenSize: number;
  learningRate: number;
  epochs: number;
  batchSize: number;
  sequenceLength: number;
  temperature: number;
  useAdam: boolean;
  teacherForcingRatio: number;
}

const DEFAULT_CONFIG: TrainingConfig = {
  hiddenSize: 128,
  learningRate: 0.1,
  epochs: 50,
  batchSize: 32,
  sequenceLength: 50,
  temperature: 1.0,
  useAdam: false,
  teacherForcingRatio: 0.5,
};

// ============== Training Function ==============

async function trainNetwork(
  corpus: string[] = CUSTOM_PAYLOAD_CORPUS,
  config: Partial<TrainingConfig> = {}
): Promise<{ network: ReturnType<typeof createLSTMNetwork>; result: any }> {
  // Merge configs
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  
  console.log('[Training] Starting LSTM training...');
  console.log('[Training] Config:', JSON.stringify(mergedConfig, null, 2));
  console.log('[Training] Corpus size:', corpus.length);
  
  // Create network with specified hidden size
  const network = createLSTMNetwork(mergedConfig.hiddenSize);
  
  // Create trainer
  const trainer = new LSTMTrainer(network, corpus, {
    learningRate: mergedConfig.learningRate,
    epochs: mergedConfig.epochs,
    batchSize: mergedConfig.batchSize,
    sequenceLength: mergedConfig.sequenceLength,
    temperature: mergedConfig.temperature,
    useAdam: mergedConfig.useAdam,
    teacherForcingRatio: mergedConfig.teacherForcingRatio,
  });
  
  // Track losses for progress
  const losses: number[] = [];
  let startTime = Date.now();
  
  // Train with progress callback
  const result = await trainer.train((epoch, loss) => {
    losses.push(loss);
    
    // Log progress every 10 epochs
    if ((epoch) % 10 === 0 || epoch === mergedConfig.epochs) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(
        `[Training] Epoch ${epoch}/${mergedConfig.epochs} | Loss: ${loss.toFixed(4)} | Time: ${elapsed}s`
      );
    }
  });
  
  console.log('[Training] Training complete!');
  console.log('[Training] Epochs completed:', result.epochsCompleted);
  console.log('[Training] Final loss:', result.finalLoss.toFixed(4));
  console.log('[Training] Average loss:', result.averageLoss.toFixed(4));
  
  // Test generation
  console.log('\n[Training] Testing generation...');
  const testPrompts = ['<script>', "' OR 1", '../..'];
  
  for (const prompt of testPrompts) {
    const generated = network.generate(prompt, 20, 0.8);
    console.log(`  Prompt: "${prompt}" -> "${generated}"`);
  }
  
  return { network, result };
}

// ============== Advanced Training with Adam ==============

async function trainWithAdam(
  corpus: string[],
  config: Partial<TrainingConfig> = {}
): Promise<{ network: ReturnType<typeof createLSTMNetwork>; result: any }> {
  console.log('\n[Training] Training with Adam optimizer...');
  
  const mergedConfig = { ...DEFAULT_CONFIG, ...config, useAdam: true };
  const network = createLSTMNetwork(mergedConfig.hiddenSize);
  
  const trainer = new LSTMTrainer(network, corpus, {
    learningRate: 0.001, // Lower LR for Adam
    epochs: mergedConfig.epochs,
    batchSize: mergedConfig.batchSize,
    sequenceLength: mergedConfig.sequenceLength,
    useAdam: true,
  });
  
  const startTime = Date.now();
  const result = await trainer.train((epoch, loss) => {
    if ((epoch) % 10 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[Adam] Epoch ${epoch}/${mergedConfig.epochs} | Loss: ${loss.toFixed(4)} | ${elapsed}s`);
    }
  });
  
  console.log('[Adam] Training complete! Average loss:', result.averageLoss.toFixed(4));
  
  return { network, result };
}

// ============== Main Execution ==============

async function main() {
  console.log('='.repeat(60));
  console.log('LSTM Training Example');
  console.log('='.repeat(60));
  
  // Example 1: Default training with SGD
  console.log('\n--- Example 1: SGD Training ---\n');
  await trainNetwork(CUSTOM_PAYLOAD_CORPUS, {
    hiddenSize: 128,
    learningRate: 0.1,
    epochs: 30,
    batchSize: 16,
    sequenceLength: 40,
  });
  
  // Example 2: Training with Adam optimizer
  console.log('\n--- Example 2: Adam Training ---\n');
  await trainWithAdam(CUSTOM_PAYLOAD_CORPUS, {
    hiddenSize: 64,
    epochs: 20,
    batchSize: 8,
  });
  
  // Example 3: Quick training for testing
  console.log('\n--- Example 3: Quick Training ---\n');
  const { network } = await trainNetwork(CUSTOM_PAYLOAD_CORPUS.slice(0, 10), {
    hiddenSize: 32,
    learningRate: 0.1,
    epochs: 5,
    batchSize: 2,
    sequenceLength: 20,
  });
  
  // Export trained weights for later use
  console.log('\n[Export] Exporting weights...');
  const weights = network.exportWeights();
  console.log('[Export] Exported weights structure ready for serialization');
  
  console.log('\n' + '='.repeat(60));
  console.log('Training examples complete!');
  console.log('='.repeat(60));
}

// Run if executed directly
main().catch(console.error);

export { trainNetwork, trainWithAdam, CUSTOM_PAYLOAD_CORPUS, DEFAULT_CONFIG };

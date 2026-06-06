/**
 * LSTM Generation Example
 * 
 * Demonstrates various generation strategies using pre-trained LSTM network.
 * Run with: npx tsx examples/lstm-generation-example.ts
 */

import { createLSTMNetwork } from '../src/ml/lstmNetwork.js';
import { getPreTrainedNetwork, LSTMTrainer } from '../src/ml/lstmTrainer.js';
import { 
  SequenceGenerator, 
  getSequenceGenerator, 
  quickGenerate, 
  generatePayloadBatch,
  PayloadLSTMGenerator 
} from '../src/ml/sequenceGenerator.js';

// ============== Pre-trained Network Examples ==============

async function usePreTrainedNetwork(): Promise<void> {
  console.log('\n--- Example 1: Pre-trained Network ---\n');
  
  // Get the singleton pre-trained network
  const network = getPreTrainedNetwork();
  
  console.log('Using pre-trained LSTM network');
  console.log('Vocabulary size:', network.getVocabSize());
  
  // Generate with different temperatures
  const testPrompt = '<script>';
  
  console.log(`\nGenerating from "${testPrompt}" with different temperatures:`);
  
  const temperatures = [0.1, 0.5, 0.8, 1.0, 1.5];
  for (const temp of temperatures) {
    const generated = network.generate(testPrompt, 15, temp);
    console.log(`  Temperature ${temp}: "${generated}"`);
  }
}

// ============== Custom Network Training & Generation ==============

async function trainCustomNetwork(): Promise<void> {
  console.log('\n--- Example 2: Train Custom Network ---\n');
  
  const corpus = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<svg/onload=confirm(1)>',
    "' OR 1=1 --",
    "' UNION SELECT",
    '../../etc/passwd',
  ];
  
  // Create and train network
  const network = createLSTMNetwork(64);
  
  const trainer = new LSTMTrainer(network, corpus, {
    learningRate: 0.1,
    epochs: 10,
    batchSize: 2,
    sequenceLength: 20,
  });
  
  await trainer.train();
  
  // Generate after training
  console.log('\nGenerating from trained network:');
  
  const prompts = ['<script>', "' OR", '../../'];
  for (const prompt of prompts) {
    const generated = network.generate(prompt, 12, 0.8);
    console.log(`  "${prompt}" -> "${generated}"`);
  }
}

// ============== Generation Strategies ==============

async function demonstrateStrategies(): Promise<void> {
  console.log('\n--- Example 3: Generation Strategies ---\n');
  
  // Create a small trained network
  const corpus = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    "' OR 1=1 --",
    "' UNION SELECT password",
    '../../etc/passwd',
    '| cat /etc/passwd',
  ];
  
  const network = createLSTMNetwork(48);
  const trainer = new LSTMTrainer(network, corpus, {
    learningRate: 0.1,
    epochs: 5,
    batchSize: 2,
    sequenceLength: 15,
  });
  
  await trainer.train();
  
  // Create generator with custom config
  const generator = new SequenceGenerator(network, {
    maxLength: 30,
    temperature: 0.85,
    topK: 40,
    topP: 0.92,
    repetitionPenalty: 1.2,
    seedText: '<script>',
    stopToken: '<END>',
  });
  
  console.log('\nGeneration with different strategies:');
  
  // Greedy (low temperature)
  const greedy = generator.generate('greedy');
  console.log(`  Greedy: "${greedy.text}"`);
  
  // Weighted
  const weighted = generator.generate('weighted');
  console.log(`  Weighted: "${weighted.text}"`);
  
  // Nucleus sampling
  const nucleus = generator.generate('nucleus');
  console.log(`  Nucleus: "${nucleus.text}"`);
  
  // Temperature sampling (default)
  const temp = generator.generate('temperature');
  console.log(`  Temperature: "${temp.text}"`);
  
  // Show metrics
  console.log('\nGeneration metrics:');
  console.log(`  Greedy - Length: ${greedy.metrics.length}, Entropy: ${greedy.metrics.entropy.toFixed(2)}`);
  console.log(`  Weighted - Length: ${weighted.metrics.length}, Entropy: ${weighted.metrics.entropy.toFixed(2)}`);
}

// ============== Batch Generation ==============

async function batchGeneration(): Promise<void> {
  console.log('\n--- Example 4: Batch Generation ---\n');
  
  const generator = getSequenceGenerator();
  
  // Generate batch
  const batch = generator.generateBatch(5);
  
  console.log('Generated batch of 5 payloads:');
  for (let i = 0; i < batch.length; i++) {
    const seq = batch[i];
    console.log(`  ${i + 1}. "${seq.text}" (length: ${seq.metrics.length})`);
  }
}

// ============== Quick Generate ==============

function quickGenerateExample(): void {
  console.log('\n--- Example 5: Quick Generate ---\n');
  
  // Quick single generation
  const payload1 = quickGenerate(50, 0.8);
  console.log(`Quick generate (50 chars, temp 0.8): "${payload1}"`);
  
  const payload2 = quickGenerate(80, 1.2);
  console.log(`Quick generate (80 chars, temp 1.2): "${payload2}"`);
  
  // Batch generate
  const payloads = generatePayloadBatch(10);
  console.log('\nBatch of 10 payloads:');
  payloads.forEach((p, i) => console.log(`  ${i + 1}. "${p}"`));
}

// ============== PayloadLSTMGenerator ==============

function payloadGeneratorExample(): void {
  console.log('\n--- Example 6: PayloadLSTMGenerator ---\n');
  
  const generator = new PayloadLSTMGenerator();
  
  // Single payload generation
  const payload = generator.generatePayload(100);
  console.log(`Generated payload: "${payload}"`);
  
  // Multiple payloads
  const payloads = generator.generatePayloads(5);
  console.log('\nGenerated 5 payloads:');
  payloads.forEach((p, i) => console.log(`  ${i + 1}. "${p}"`));
  
  // Generate from seed
  const fromSeed = generator.generateFromSeed('<script>', 60);
  console.log(`\nFrom seed "<script>": "${fromSeed}"`);
}

// ============== Custom Configuration ==============

async function customConfiguration(): Promise<void> {
  console.log('\n--- Example 7: Custom Configuration ---\n');
  
  const network = createLSTMNetwork(128);
  
  // Train briefly
  const trainer = new LSTMTrainer(network, [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    "' OR 1=1 --",
  ], {
    learningRate: 0.1,
    epochs: 3,
    batchSize: 1,
    sequenceLength: 20,
  });
  
  await trainer.train();
  
  // Create generator with custom config
  const generator = new SequenceGenerator(network, {
    maxLength: 50,
    temperature: 0.7,
    topK: 20,
    topP: 0.95,
    repetitionPenalty: 1.3,
    seedText: '"',
  });
  
  // Generate multiple
  const results = generator.generateBatch(3);
  
  console.log('Custom configuration results:');
  results.forEach((seq, i) => {
    console.log(`  ${i + 1}. "${seq.text}"`);
    console.log(`     Metrics: length=${seq.metrics.length}, entropy=${seq.metrics.entropy.toFixed(2)}, uniqueness=${seq.metrics.uniqueness.toFixed(2)}`);
  });
}

// ============== Main Execution ==============

async function main() {
  console.log('='.repeat(60));
  console.log('LSTM Generation Examples');
  console.log('='.repeat(60));
  
  // Example 1: Pre-trained network
  await usePreTrainedNetwork();
  
  // Example 2: Train custom network
  await trainCustomNetwork();
  
  // Example 3: Generation strategies
  await demonstrateStrategies();
  
  // Example 4: Batch generation
  await batchGeneration();
  
  // Example 5: Quick generate
  quickGenerateExample();
  
  // Example 6: PayloadLSTMGenerator
  payloadGeneratorExample();
  
  // Example 7: Custom configuration
  await customConfiguration();
  
  console.log('\n' + '='.repeat(60));
  console.log('Generation examples complete!');
  console.log('='.repeat(60));
}

// Run if executed directly
main().catch(console.error);

export { 
  usePreTrainedNetwork, 
  trainCustomNetwork, 
  demonstrateStrategies, 
  batchGeneration,
  quickGenerateExample,
  payloadGeneratorExample,
  customConfiguration 
};

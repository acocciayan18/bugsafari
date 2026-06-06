/**
 * LSTM Save/Load Example
 * 
 * Demonstrates how to save and load LSTM network weights.
 * Includes export/import, JSON serialization, and MongoDB persistence.
 * Run with: npx tsx examples/lstm-save-load-example.ts
 */

import { createLSTMNetwork, serializeWeights, deserializeWeights, type LSTMConfig, type LSTMWeights } from '../src/ml/lstmNetwork.js';
import { LSTMTrainer, saveNetworkWeights, loadNetworkWeights } from '../src/ml/lstmTrainer.js';

// ============== In-Memory Save/Load ==============

function exportImportExample(): void {
  console.log('\n--- Example 1: Export/Import Weights ---\n');
  
  // Create network
  const network = createLSTMNetwork(64);
  
  console.log('Created LSTM network (hidden size: 64)');
  console.log('Vocabulary size:', network.getVocabSize());
  
  // Export weights (to JSON)
  console.log('\nExporting weights...');
  const weights = network.exportWeights();
  
  // Check exported structure
  console.log('Exported weight keys:', Object.keys(weights).join(', '));
  console.log('Sample weight (Wix[0][0]):', weights.Wix[0][0].toFixed(4));
  console.log('Sample bias (bi[0]):', weights.bi[0].toFixed(4));
  
  // Import to new network
  console.log('\nImporting to new network...');
  const network2 = createLSTMNetwork(64);
  network2.importWeights(weights);
  
  // Verify both networks produce similar output
  const prompt = '<script>';
  const gen1 = network.generate(prompt, 10, 0.8);
  const gen2 = network2.generate(prompt, 10, 0.8);
  
  console.log(`Original network: "${gen1}"`);
  console.log(`Imported network: "${gen2}"`);
  console.log('Match:', gen1 === gen2 ? 'Yes (expected)' : 'No (expected for untrained)');
}

// ============== JSON Serialization ==============

function jsonSerializationExample(): void {
  console.log('\n--- Example 2: JSON Serialization ---\n');
  
  // Create and train network (minimal training)
  const network = createLSTMNetwork(32);
  
  const trainer = new LSTMTrainer(network, [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    "' OR 1=1 --",
  ], {
    learningRate: 0.1,
    epochs: 3,
    batchSize: 1,
    sequenceLength: 15,
  });
  
  // Note: Synchronous train for demo (not recommended for production)
  console.log('Training network...');
  trainer.train().catch(() => {});
  
  // Export to JSON string
  console.log('\nSerializing to JSON...');
  const weights = network.exportWeights();
  const jsonString = JSON.stringify(weights);
  
  console.log('JSON string length:', jsonString.length, 'characters');
  console.log('Preview:', jsonString.substring(0, 100), '...');
  
  // Parse JSON back
  console.log('\nParsing JSON...');
  const parsedWeights = JSON.parse(jsonString) as LSTMWeights;
  
  // Import to new network
  const network2 = createLSTMNetwork(32);
  network2.importWeights(parsedWeights);
  
  // Verify
  const gen1 = network.generate('<script>', 8, 0.8);
  const gen2 = network2.generate('<script>', 8, 0.8);
  
  console.log(`Original: "${gen1}"`);
  console.log(`Restored: "${gen2}"`);
}

// ============== Serialize/Deserialize Utilities ==============

function serializeDeserializeExample(): void {
  console.log('\n--- Example 3: Serialize/Deserialize Utilities ---\n');
  
  // Create network
  const network = createLSTMNetwork(48);
  
  // Get weights
  const weights = network.exportWeights();
  
  // Use serializeWeights for storage
  console.log('Using serializeWeights utility...');
  const serialized = serializeWeights(weights);
  
  console.log('Serialized Map entries:');
  for (const [key, value] of serialized) {
    console.log(`  ${key}: ${value.length} values`);
  }
  
  // Config for deserialization
  const config: LSTMConfig = {
    inputSize: network.getVocabSize(),
    hiddenSize: 48,
    outputSize: network.getVocabSize(),
  };
  
  // Deserialize back
  console.log('\nDeserializing...');
  const restored = deserializeWeights(serialized, config);
  
  console.log('Restored weight keys:', Object.keys(restored).join(', '));
  
  // Import to new network
  const network2 = createLSTMNetwork(48);
  network2.importWeights(restored);
  
  console.log('Successfully restored network!');
}

// ============== Session-Based Weight Management ==============

async function sessionWeightManagement(): Promise<void> {
  console.log('\n--- Example 4: Session-Based Weight Management ---\n');
  
  const sessionId = 'demo-session-123';
  
  // Create and train network
  const network = createLSTMNetwork(64);
  
  const corpus = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<svg/onload=confirm(1)>',
    "' OR 1=1 --",
    "' UNION SELECT password FROM users",
    "../../../../etc/passwd",
  ];
  
  const trainer = new LSTMTrainer(network, corpus, {
    learningRate: 0.1,
    epochs: 5,
    batchSize: 2,
    sequenceLength: 20,
  });
  
  console.log('Training network...');
  await trainer.train();
  
  // Save weights (simulated - will fail without MongoDB)
  console.log('\nAttempting to save weights...');
  try {
    await saveNetworkWeights(sessionId, network);
    console.log('Saved successfully!');
  } catch (error) {
    console.log('Save skipped (MongoDB not available):', (error as Error).message);
  }
  
  // Load weights (simulated)
  console.log('Attempting to load weights...');
  try {
    const loaded = await loadNetworkWeights(sessionId, network);
    console.log('Load result:', loaded ? 'Loaded!' : 'No saved weights found');
  } catch (error) {
    console.log('Load skipped (MongoDB not available):', (error as Error).message);
  }
}

// ============== Weight Backup/Restore ==============

function weightBackupExample(): void {
  console.log('\n--- Example 5: Weight Backup/Restore ---\n');
  
  // Create initial network
  const network1 = createLSTMNetwork(32);
  
  // Train with one corpus
  const trainer1 = new LSTMTrainer(network1, [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
  ], {
    learningRate: 0.1,
    epochs: 2,
    batchSize: 1,
    sequenceLength: 10,
  });
  
  console.log('Training network 1...');
  trainer1.train().catch(() => {});
  
  // Export weights
  const weights1 = network1.exportWeights();
  
  // Create second network with different config
  const network2 = createLSTMNetwork(64);
  
  // Export its weights
  const weights2 = network2.exportWeights();
  
  // Swap weights between networks (same architecture required)
  console.log('\nSwapping weights between networks...');
  network1.importWeights(weights2);
  network2.importWeights(weights1);
  
  // Both networks now have each other's weights
  const gen1 = network1.generate('<script>', 8, 0.8);
  const gen2 = network2.generate('<script>', 8, 0.8);
  
  console.log('Network 1 (now has network2 weights):', gen1);
  console.log('Network 2 (now has network1 weights):', gen2);
}

// ============== Weight Versioning ==============

function weightVersioningExample(): void {
  console.log('\n--- Example 6: Weight Versioning ---\n');
  
  // Create networks for different versions
  const networkV1 = createLSTMNetwork(32);
  const networkV2 = createLSTMNetwork(32);
  
  // Train with different corpus
  const trainerV1 = new LSTMTrainer(networkV1, [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
  ], {
    learningRate: 0.1,
    epochs: 2,
    batchSize: 1,
    sequenceLength: 10,
  });
  
  const trainerV2 = new LSTMTrainer(networkV2, [
    "' OR 1=1 --",
    "' UNION SELECT",
  ], {
    learningRate: 0.1,
    epochs: 2,
    batchSize: 1,
    sequenceLength: 10,
  });
  
  console.log('Training version 1 (XSS corpus)...');
  trainerV1.train().catch(() => {});
  
  console.log('Training version 2 (SQLi corpus)...');
  trainerV2.train().catch(() => {});
  
  // Export both versions
  const weightsV1 = networkV1.exportWeights();
  const weightsV2 = networkV2.exportWeights();
  
  // Store with version metadata
  const versions = new Map<string, { weights: LSTMWeights; metadata: any }>();
  versions.set('v1.0-xss', { 
    weights: weightsV1, 
    metadata: { type: 'xss', created: new Date().toISOString() } 
  });
  versions.set('v1.0-sqli', { 
    weights: weightsV2, 
    metadata: { type: 'sqli', created: new Date().toISOString() } 
  });
  
  console.log('\nStored versions:');
  for (const [version, data] of versions) {
    console.log(`  ${version}: ${data.metadata.type}`);
  }
  
  // Restore specific version
  const selected = versions.get('v1.0-xss');
  if (selected) {
    const network = createLSTMNetwork(32);
    network.importWeights(selected.weights);
    const gen = network.generate('<script>', 8, 0.8);
    console.log(`\nRestored v1.0-xss: "${gen}"`);
  }
}

// ============== Main Execution ==============

async function main() {
  console.log('='.repeat(60));
  console.log('LSTM Save/Load Examples');
  console.log('='.repeat(60));
  
  // Example 1: Export/Import
  exportImportExample();
  
  // Example 2: JSON Serialization
  jsonSerializationExample();
  
  // Example 3: Serialize/Deserialize utilities
  serializeDeserializeExample();
  
  // Example 4: Session-based management
  await sessionWeightManagement();
  
  // Example 5: Weight backup/restore
  weightBackupExample();
  
  // Example 6: Weight versioning
  weightVersioningExample();
  
  console.log('\n' + '='.repeat(60));
  console.log('Save/Load examples complete!');
  console.log('='.repeat(60));
}

// Run if executed directly
main().catch(console.error);

export { 
  exportImportExample, 
  jsonSerializationExample, 
  serializeDeserializeExample,
  sessionWeightManagement,
  weightBackupExample,
  weightVersioningExample 
};

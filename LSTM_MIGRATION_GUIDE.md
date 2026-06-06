# LSTM Migration Guide

This guide helps you migrate from the Perceptron-based payload generation to the new LSTM system.

## Overview

The LSTM system provides:
- **Character-level sequence prediction** for dynamic payload generation
- **Training capabilities** with customizable corpus
- **Multiple generation strategies** (greedy, weighted, nucleus, temperature)
- **Weight persistence** for saving/loading trained models

## Key Differences

| Feature | Perceptron | LSTM |
|---------|----------|------|
| Architecture | Single-layer feedforward | Multi-layer recurrent |
| Sequence handling | Fixed input size | Variable length |
| Training | Simple gradient descent | BPTT with memory |
| Generation | Single prediction | Character-by-character |
| Memory | No | Yes (cell state) |

## Migration Steps

### 1. Update Imports

**Before (Perceptron):**
```typescript
import { PerceptronPayloadGenerator } from '../ml/perceptron.js';
const generator = new PerceptronPayloadGenerator();
```

**After (LSTM):**
```typescript
import { getPreTrainedNetwork, LSTMTrainer } from '../ml/lstmTrainer.js';
import { SequenceGenerator, getSequenceGenerator } from '../ml/sequenceGenerator.js';
```

### 2. Replace Generation Calls

**Before:**
```typescript
const payload = generator.generate(input, config);
```

**After:**
```typescript
// Option 1: Pre-trained network
const network = getPreTrainedNetwork();
const payload = network.generate(startText, maxLength, temperature);

// Option 2: Custom generator
const generator = getSequenceGenerator();
const result = generator.generate('temperature');
const payload = result.text;
```

### 3. Add Training (Optional)

```typescript
import { createLSTMNetwork, LSTMTrainer } from '../ml/lstmNetwork.js';

// Create network
const network = createLSTMNetwork(128); // 128 hidden units

// Define custom corpus
const corpus = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  "' OR 1=1 --",
];

// Train
const trainer = new LSTMTrainer(network, corpus, {
  learningRate: 0.1,
  epochs: 50,
  batchSize: 32,
  sequenceLength: 50,
});

await trainer.train();

// Generate with trained network
const payload = network.generate('<script>', 20, 0.8);
```

### 4. Save/Load Weights

```typescript
import { serializeWeights, deserializeWeights } from '../ml/lstmNetwork.js';

// Save
const weights = network.exportWeights();
const jsonString = JSON.stringify(weights);

// Load
const parsedWeights = JSON.parse(jsonString);
network.importWeights(parsedWeights);
```

## API Reference

### LSTMNetwork

```typescript
import { createLSTMNetwork } from '../ml/lstmNetwork.js';

// Create with default config
const network = createLSTMNetwork(128);

// Or with custom vocabulary
const vocab = new Map([['a', 0], ['b', 1], ...]);
const network = createLSTMNetwork(128, vocab);

// Generate
const payload = network.generate('<script>', 50, 0.8);
// Returns: string

// Encode/Decode
const encoded = network.encode('payload');
// Returns: number[]
const decoded = network.decode(encoded);
// Returns: string

// Export/Import
const weights = network.exportWeights();
network.importWeights(weights);
```

### LSTMTrainer

```typescript
import { LSTMTrainer } from '../ml/lstmTrainer.js';

const trainer = new LSTMTrainer(network, corpus, config);

// Train with progress callback
const result = await trainer.train((epoch, loss) => {
  console.log(`Epoch ${epoch}: loss = ${loss}`);
});

// Result
console.log(result.epochsCompleted);
console.log(result.averageLoss);
```

### SequenceGenerator

```typescript
import { SequenceGenerator, getSequenceGenerator } from '../ml/sequenceGenerator.js';

// Create with custom config
const generator = new SequenceGenerator(network, {
  maxLength: 100,
  temperature: 0.85,
  topK: 40,
  topP: 0.92,
  repetitionPenalty: 1.2,
  seedText: '"',
});

// Generate with strategy
const result = generator.generate('temperature');
// Returns: { text: string, metrics: { length, entropy, uniqueness } }

// Batch generation
const batch = generator.generateBatch(10);
```

### Generation Strategies

| Strategy | Temperature | Use Case |
|----------|-------------|----------|
| `greedy` | 0.1 | Deterministic output |
| `weighted` | 0.7 | Balanced creativity |
| `nucleus` | topP × 0.9 | High quality |
| `temperature` | user-defined | Full control |

## Configuration

### TrainingConfig

```typescript
interface TrainingConfig {
  learningRate: number;      // Default: 0.1
  epochs: number;            // Default: 50
  batchSize: number;        // Default: 32
  sequenceLength: number;   // Default: 50
  temperature: number;      // Default: 1.0
  useAdam: boolean;        // Default: false
  teacherForcingRatio: number; // Default: 0.5
}
```

### GenerationOptions

```typescript
interface GenerationOptions {
  maxLength: number;           // Default: 120
  temperature: number;        // Default: 0.85
  topK: number;              // Default: 40
  topP: number;             // Default: 0.92
  repetitionPenalty: number;  // Default: 1.2
  seedText: string;          // Default: '"'
  stopToken: string;         // Default: '<END>'
}
```

## Backward Compatibility

The system maintains backward compatibility with:

1. **Perceptron integration**: Use `PayloadLSTMGenerator` class
2. **JSON serialization**: Standard JSON.stringify/parse
3. **MongoDB storage**: Via BrainConfigModel

## Performance Tips

1. **Use Adam optimizer** for faster convergence:
   ```typescript
   const trainer = new LSTMTrainer(network, corpus, { useAdam: true });
   ```

2. **Adjust temperature** based on use case:
   - Lower (0.1-0.5): More deterministic
   - Higher (1.0-2.0): More creative

3. **Batch generation** for multiple payloads:
   ```typescript
   const batch = generator.generateBatch(100);
   ```

4. **Gradient clipping** prevents exploding gradients (built-in, threshold: 5.0)

## Troubleshooting

### Training Loss Not Decreasing
- Check learning rate (try lower: 0.01)
- Increase epochs
- Verify corpus size (minimum 5-10 samples)

### Generation Quality Poor
- Increase training epochs
- Lower temperature (0.5-0.8)
- Add more diverse training data

### Memory Issues
- Reduce batch size
- Reduce sequence length
- Use gradient accumulation

## Examples

See `examples/` directory:
- `lstm-training-example.ts` - Training with custom corpus
- `lstm-generation-example.ts` - Various generation strategies
- `lstm-save-load-example.ts` - Weight persistence

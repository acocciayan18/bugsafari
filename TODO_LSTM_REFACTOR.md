# LSTM Refactor TODO

## Phase 1: Core Implementation
- [x] Analyze existing implementation (lstmNetwork.ts, lstmTrainer.ts)
- [x] Identify all bugs and issues
- [x] Plan comprehensive fixes

## Phase 2: lstmNetwork.ts - Fixed Implementation
- [x] Fix gate equations with proper separate weights for each gate
- [x] Implement forward pass caching structure
- [x] Add Xavier initialization
- [x] Fix vocabulary system with <UNK>
- [x] Implement weight validation

## Phase 3: lstmTrainer.ts - Proper Training
- [x] Implement BPTT with full gradients
- [x] Add SGD optimizer
- [x] Add Adam optimizer (optional)
- [x] Fix training loop to actually update weights
- [x] Implement cross-entropy loss correctly
- [x] Add mini-batch support
- [x] Add teacher forcing

## Phase 4: Persistence Fixes
- [x] Fix MongoDB schema for full weights
- [x] Implement serializeWeights/deserializeWeights
- [x] Fix loadNetworkWeights to actually load

## Phase 5: Testing
- [x] Create unit tests
- [x] Create integration test with small corpus

## Phase 6: Documentation
- [x] Migration guide
- [x] Example scripts (training, generation, save/load)

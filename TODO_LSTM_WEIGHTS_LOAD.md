# Plan: Load LSTM/Perceptron Weights from MongoDB on Exploration Start

## Current State
- `saveNetworkWeights()` and `loadNetworkWeights()` exist in `lstmTrainer.ts` but are never called
- Perceptron brain state is saved via `persistBrainSnapshot()` but never loaded back
- Each exploration starts with fresh initialized weights

## Changes Needed

### 1. Add Load Method to FindingRepository

**File:** `testing-core/src/domain/repositories/FindingRepository.ts`
- Add `loadLatestBrainConfig(targetUrl?: string)` method to interface

**File:** `testing-core/src/infrastructure/database/repositories/MongoFindingRepository.ts`  
- Implement `loadLatestBrainConfig()` to fetch latest brain config for a target URL

### 2. Load Weights in AutonomousExplorationEngine

**File:** `testing-core/src/domain/services/AutonomousExplorationEngine.ts`
- At session start, call `loadLatestBrainConfig()` if findingRepo exists
- Import brain state into RiskScorer via `importBrainState()`
- Import weights into PayloadSynthesizer LSTM generator

### 3. Ensure Weights Are Loaded into Components

**File:** `testing-core/src/domain/services/RiskScorer.ts`
- Add `importBrainState(bias, weights)` method to import saved state

## Execution Order

1. Add `loadLatestBrainConfig` to FindingRepository interface
2. Implement in MongoFindingRepository
3. Add `importBrainState` to RiskScorer
4. Modify AutonomousExplorationEngine to load at start
5. Ensure weights flow to PayloadSynthesizer

## Dependencies
- BrainConfigModel already stores weights in MongoDB
- RiskScorer already exports via `exportBrainState()`
- Need to wire up the load path

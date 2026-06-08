# TODO - Step 2: Strategic Payload Engines

## Information Gathered
- `elementClassifier.ts` exports: `classifyInputElement(element: unknown): FieldCategory` where `FieldCategory = 'NUMERIC' | 'TEXT_SEARCH' | 'DATABASE_AUTH' | 'CHAOS_FALLBACK'`
- `dataFuzzer.ts` currently imports classifier and logs: `console.log(🔍 [HEURISTIC CLASSIFIER] Classified input target "${target.id || selector}" as -> ${category});`
- `chaosData.ts` provides `getRandomPayload()` function for chaotic fallback
- Need to create modular strategy pattern with 4 separate strategy files

## Plan
1. Create `strategies/` directory at `testing-core/src/domain/scenarios/fuzzing/strategies/`
2. Create 4 strategy modules:
   - `numericBoundaryStrategy.ts` - boundary edge-cases
   - `xssVectorStrategy.ts` - XSS attack vectors  
   - `noSqlInjectionStrategy.ts` - SQL/NoSQL injection
   - `chaosFallbackStrategy.ts` - chaotic payloads from chaosData
3. Export strategy interfaces and generators from `strategies/index.ts`
4. Update `dataFuzzer.ts` to:
   - Import all strategies
   - Select strategy based on classified category
   - Add console reporting: `🔥 [HEURISTIC FUZZ] Injecting targeted ${category} exploit vector into field selector:`, element.name

## Dependent Files to be edited
- `testing-core/src/domain/scenarios/fuzzing/dataFuzzer.ts` - integrate strategies

## New Files to create
- `testing-core/src/domain/scenarios/fuzzing/strategies/numericBoundaryStrategy.ts`
- `testing-core/src/domain/scenarios/fuzzing/strategies/xssVectorStrategy.ts`
- `testing-core/src/domain/scenarios/fuzzing/strategies/noSqlInjectionStrategy.ts`
- `testing-core/src/domain/scenarios/fuzzing/strategies/chaosFallbackStrategy.ts`
- `testing-core/src/domain/scenarios/fuzzing/strategies/index.ts`

## Followup steps
- TypeScript compilation check
- No runtime tests needed (stress scenario testing done manually)

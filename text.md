A. The Generation & Strategy Selection Layer (Intelligence)

Field Classification: testing-core/src/domain/scenarios/fuzzing/elementClassifier.ts classifies input elements (DATABASE_AUTH, NUMERIC, EMAIL, DATE, JSON, TEXT_SEARCH, CHAOS_FALLBACK)
Payload Synthesis: Multiple strategy files under testing-core/src/domain/scenarios/fuzzing/strategies/:
numericBoundaryStrategy.ts - boundary testing for numeric fields
xssVectorStrategy.ts - XSS attack vectors
noSqlInjectionStrategy.ts - SQL/NoSQL injection
emailStrategy.ts - email fuzzing
dateStrategy.ts - date manipulation
jsonStrategy.ts - JSON injection
chaosFallbackStrategy.ts - generic chaos tokens
B. The Adversarial Execution Sub-Systems (Arsenal Scenarios)

Constraint Stripping:

testing-core/src/domain/scenarios/formBypasser.ts - strips maxlength, required, disabled, readonly, pattern, etc.
testing-core/src/domain/scenarios/fuzzing/dataFuzzer.ts - also strips constraints as part of fuzzing
Rapid Interaction:

testing-core/src/domain/scenarios/rapidClicker/buttonSpammer.ts - rapid click stress
testing-core/src/domain/scenarios/rapidClicker/burstClicker.ts - burst clicking
testing-core/src/domain/scenarios/rapidClicker/coordinateBombing.ts - coordinate bombing
Network Disruption: testing-core/src/domain/scenarios/networkSaboteur.ts and testing-core/src/domain/scenarios/routeTrasher.ts handle network stress and route manipulation

C. The Forensic Interception & Detection Layer (Sensory Monitoring)

Error Detection: testing-core/src/infrastructure/monitoring/stabilityMonitor.ts monitors runtime stability and catches JS exceptions
Action Recording: testing-core/src/infrastructure/monitoring/actionBuffer.ts (ActionRecorder) and testing-core/src/infrastructure/monitoring/reproductionPlaybookStore track executed actions
Forensic Analysis: testing-core/src/domain/services/ForensicAnalysisService.ts enables pattern-matching and diagnostic remediation. Orchestration flows through the ExplorationEngine in testing-core/src/domain/services/exploration/ExplorationEngine.ts, which manages fuzzing scenarios and coordinates chaos transactions via ChaosTransactionManager in testing-core/src/domain/fuzzing/ChaosTransactionManager.ts.
# TODO - Security Vulnerability Scout Implementation

## Task Overview
Fully implement securityVulnerabilityScout.ts and wire it into AutonomousExplorationEngine.ts

## Edit Plan

### 1. securityVulnerabilityScout.ts - Update Payload Values
- [ ] Update XSS payloads to exact values: `<script>alert("BugSafari_XSS")</script>`, `<img src=x onerror=alert(1)>`, `<svg onload=alert(1)>`
- [ ] Update Injection payloads to exact values: `' OR 1=1 --`, `{"$gt": ""}`, `'; DROP TABLE users;`

### 2. formBypasser.ts - Add pattern attribute stripping
- [ ] Add 'pattern' to STRIPPED_ATTRIBUTES array

### 3. AutonomousExplorationEngine.ts - Integration
- [ ] Import securityVulnerabilityScout from scenarios
- [ ] Add chaosThreshold property for conditional weight check
- [ ] Update pickStressScenario to delegate to securityVulnerabilityScout for text inputs when chaos threshold allows
- [ ] Ensure stripConstraints is called before injection

## Dependencies
- testing-core/src/domain/scenarios/securityVulnerabilityScout.ts
- testing-core/src/domain/scenarios/formBypasser.ts
- testing-core/src/domain/services/AutonomousExplorationEngine.ts

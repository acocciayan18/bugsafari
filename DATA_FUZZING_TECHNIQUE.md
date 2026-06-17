# Data Fuzzing Technique in BugSafari

## Overview
The data fuzzing system in BugSafari is a **heuristic-driven, context-aware fuzzing framework** that automatically analyzes input fields and injects targeted exploit payloads during autonomous exploration testing.

---

## When Testing Starts - The Fuzzing Process

### 1. Exploration Engine Begins
In `AutonomousExplorationEngine.ts`, the engine runs interactive exploration on the target URL. Each step:
- Parses DOM to find interactive elements
- Scores elements by risk level
- Selects a target to interact with

### 2. Fuzzing Decision Point
In `executeWeightedAction()`, there's a **50% probability** the engine will use Data Fuzzing on `<input>` or `<textarea>` elements:

```typescript
const useDataFuzzer = (target.tagName === 'input' || target.tagName === 'textarea') && Math.random() < 0.5;
```

---

## Detailed 6-Step Fuzzing Flow

### Step 1: Element Classification (`elementClassifier.ts`)
Classifies input elements into **7 categories**:

| Category | Detection | Example Fields |
|----------|----------|---------------|
| `DATABASE_AUTH` | Tokens: login, password, username, token | Login/signup forms |
| `NUMERIC` | type="number"/"tel" or tokens: quantity, price | Price, quantity, phone |
| `TEXT_SEARCH` | type="text" or tokens: search, query | Search bars |
| `EMAIL` | type="email" or tokens: email, mail | Email fields |
| `DATE` | type="date" or tokens: date, birthday | Date pickers |
| `JSON` | type="hidden" or tokens: json, data | API fields |
| `CHAOS_FALLBACK` | Default unclassified | Generic text |

**Classification Priority:** DATABASE_AUTH → NUMERIC → TEXT_SEARCH → EMAIL → DATE → JSON → CHAOS_FALLBACK

### Step 2: Strategy Selection (`strategies/index.ts`)
Maps category to fuzzing strategy:

```typescript
getStrategyByCategory(category) → {
  NUMERIC     → numericBoundaryStrategy
  TEXT_SEARCH → xssVectorStrategy  
  DATABASE_AUTH → noSqlInjectionStrategy
  EMAIL      → emailStrategy
  DATE       → dateStrategy
  JSON       → jsonStrategy
  CHAOS_FALLBACK → chaosFallbackStrategy
}
```

### Step 3: Payload Generation (Strategy Files)
Each strategy generates specific exploit payloads:

| Strategy | Attack Types | Example Vectors |
|----------|--------------|-----------------|
| **emailStrategy** | Missing @, DNS fuzzing, Null bytes | `test@@domain.com`, `test@localhost` |
| **noSqlInjectionStrategy** | SQL injection, NoSQL operators, Auth bypass | `' OR '1'='1`, `{"$gt": 0}` |
| **xssVectorStrategy** | Script tags, event handlers | `<script>alert(1)</script>` |
| **numericBoundaryStrategy** | Boundary overflow, negative numbers | `9999999999`, `-1`, `NaN` |
| **dateStrategy** | Invalid dates, Unix timestamps | `0000-00-00`, `1899-12-30` |
| **jsonStrategy** | Prototype pollution, syntax errors | `{"__proto__": {}}` |

### Step 4: Constraint Stripping
Removes HTML5 validation before injection:
- Removes: `maxlength`, `pattern`, `required`, `min`, `max`
- Sets `maxLength = 524288` to allow large payloads

### Step 5: Payload Injection
- **Small payloads (<10k chars):** Uses `page.fill()`
- **Large payloads (≥10k chars):** Uses `page.evaluate()` to set value directly
- **Select elements:** Uses `page.selectOption()`

**Dispatches:** `input` and `change` events after injection

### Step 6: Form Submission Trigger
Attempts to submit the form:
1. Press `Enter` on the field
2. Click submit button (`button[type="submit"]`)
3. Dispatch `submit` event on parent form

---

## Multi-Pass Iteration (Advanced)
The system supports iterating through multiple payloads:

```typescript
interface FuzzerOptions {
  iterationCount: 5,    // Number of payloads
  stopOnCrash: false,   // Stop on first crash
  iterationDelay: 100,  // Delay between iterations (ms)
  shufflePayloads: true,
}
```

---

## Trigger Summary Table

| Scenario | Trigger Condition |
|----------|-------------------|
| Standard Fuzzing | 50% chance on input/textarea |
| Security Scout | 25% chaos threshold on text inputs |
| Stress Scenarios | 30% probability escalation |
| Multi-Pass | Configurable via `executeMultiPassFuzzing()` |

---

## Why 50% and Not 100%?

The 50% probability is a **deliberate design decision** for several reasons:

1. **Exploration Balance**: The engine needs to discover different application states. If we fuzz every input field, we might:
   - Get stuck submitting forms with invalid data
   - Not explore the "happy path" (normal valid inputs)
   - Trigger validation errors that change application flow prematurely

2. **State Space Coverage**: By using only 50%, the engine can:
   - Test both valid and invalid inputs
   - Navigate through different UI branches
   - Avoid overwhelming the application with attack payloads

3. **Resource Efficiency**: Fuzzing is more expensive than normal typing (validation, error handling). The 50% balance ensures the exploration remains efficient while still providing security coverage.

4. **Observing Different Behaviors**: Valid inputs may trigger different code paths than fuzzed inputs. The 50% split helps identify bugs in both normal and edge-case scenarios.

This intelligent fuzzing system automatically adapts to different input field types and tests for validation bypass, injection vulnerabilities, and data handling issues across the application.

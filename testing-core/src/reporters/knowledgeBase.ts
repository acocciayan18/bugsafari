// testing-core/src/reporters/knowledgeBase.ts

export interface DiagnosticCard {
  vulnerabilityClass: string;
  cwe: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  suggestedFix: string;
  explanation: string;
}

// The Rules-Based Knowledge Base
export const HEURISTIC_RULES: Array<{
  keywords: string[];
  diagnostics: DiagnosticCard;
}> = [
  {
    keywords: ['vulnerability', 'sql syntax', 'postgres', 'uid', 'mysql', 'database error'],
    diagnostics: {
      vulnerabilityClass: "Improper Backend Input Validation / Injection Flaw",
      cwe: "CWE-20 / CWE-89",
      severity: "CRITICAL",
      explanation: "The application backend directly parsed un-sanitized chaos payloads into a data access interpreter layout.",
      suggestedFix: "Implement strict parameterization or ORM object models. Enforce strong backend schema typing constraints to avoid active execution of injected text arguments."
    }
  },
  {
    keywords: ['cannot read properties of undefined', 'null reading', 'is not a function', 'unhandledrejection'],
    diagnostics: {
      vulnerabilityClass: "Uncontrolled State Lifecycle Synchronization Flaw",
      cwe: "CWE-476 (Null Pointer Dereference)",
      severity: "WARNING",
      explanation: "A rapid traversal action or malformed string form update caused a React/SPA component hook to execute before dependent asynchronous API data objects resolved.",
      suggestedFix: "Apply short-circuit optional chaining expressions (e.g., `data?.property`). Implement loading state barriers and verify async hook initializers."
    }
  },
  {
    keywords: ['404', 'not found', 'failed to load resource'],
    diagnostics: {
      vulnerabilityClass: "Missing Broken Resource Allocation Pathway",
      cwe: "CWE-425",
      severity: "WARNING",
      explanation: "The exploratory agent triggered a routing path that referenced a non-existent or un-mapped backend asset or API endpoint.",
      suggestedFix: "Verify that all routing tables align with the active decoupled API blueprint. Implement generic 404 fallback routing structures."
    }
  }
];
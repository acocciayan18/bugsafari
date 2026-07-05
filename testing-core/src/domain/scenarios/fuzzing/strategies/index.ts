/**
 * Fuzzing Strategy Modules Index
 * 
 * Exports all strategy modules for heuristic-driven context-aware fuzzing.
 * Each strategy generates targeted payloads based on field category classification.
 */

import type { FuzzingStrategyType } from '../../../chaos/index.js';

import {
  type NumericPayload,
  generateNumericBoundaryPayload, 
  getAllNumericPayloads, 
  isBoundaryPayload 
} from './numericBoundaryStrategy.js';

import { 
  type XssPayload, 
  generateXssPayload, 
  getAllXssVectors, 
  isXssVector 
} from './xssVectorStrategy.js';

import { 
  type SqlNoSqlPayload, 
  generateSqlNoSqlPayload, 
  getAllSqlNoSqlVectors, 
  isSqlNoSqlVector 
} from './noSqlInjectionStrategy.js';

import { 
  type ChaosPayload, 
  generateChaosPayload, 
  getAllChaosTokens, 
  isChaosToken 
} from './chaosFallbackStrategy.js';

import { 
  type EmailPayload, 
  generateEmailPayload, 
  getAllEmailVectors, 
  isEmailVector 
} from './emailStrategy.js';

import { 
  type DatePayload, 
  generateDatePayload, 
  getAllDateVectors, 
  isDateVector 
} from './dateStrategy.js';

import { 
  type JsonPayload, 
  generateJsonPayload, 
  getAllJsonVectors, 
  isJsonVector 
} from './jsonStrategy.js';

// Re-export all types and functions
export { 
  type NumericPayload, 
  generateNumericBoundaryPayload, 
  getAllNumericPayloads, 
  isBoundaryPayload 
};

export { 
  type XssPayload, 
  generateXssPayload, 
  getAllXssVectors, 
  isXssVector 
};

export { 
  type SqlNoSqlPayload, 
  generateSqlNoSqlPayload, 
  getAllSqlNoSqlVectors, 
  isSqlNoSqlVector 
};

export { 
  type ChaosPayload, 
  generateChaosPayload, 
  getAllChaosTokens, 
  isChaosToken 
};

export { 
  type EmailPayload, 
  generateEmailPayload, 
  getAllEmailVectors, 
  isEmailVector 
};

export { 
  type DatePayload, 
  generateDatePayload, 
  getAllDateVectors, 
  isDateVector 
};

export { 
  type JsonPayload, 
  generateJsonPayload, 
  getAllJsonVectors, 
  isJsonVector 
};

/**
 * Strategy type union for all available fuzzing strategies
 */
export type FuzzingStrategy = 
  | { strategy: 'NUMERIC'; payload: NumericPayload }
  | { strategy: 'XSS'; payload: XssPayload }
  | { strategy: 'NOSQL'; payload: SqlNoSqlPayload }
  | { strategy: 'CHAOS'; payload: ChaosPayload };

/**
 * Field category type from element classifier
 */
export type FieldCategory = 'NUMERIC' | 'TEXT_SEARCH' | 'DATABASE_AUTH' | 'CHAOS_FALLBACK' | 'EMAIL' | 'DATE' | 'JSON';

/**
 * Result type for strategy payload
 */
export interface StrategyPayload {
  value: string;
  description: string;
}

/**
 * Gets the appropriate strategy generator based on field category.
 * @param category The FieldCategory to map to a strategy
 * @returns The strategy payload with value and description
 */
export function getStrategyByCategory(category: FieldCategory): StrategyPayload {
  switch (category) {
    case 'NUMERIC': {
      const result = generateNumericBoundaryPayload();
      return { value: result.value, description: result.description };
    }
    case 'TEXT_SEARCH': {
      // TEXT_SEARCH uses XSS vectors for text inputs that might render HTML
      const result = generateXssPayload();
      return { value: result.vector, description: result.description };
    }
    case 'DATABASE_AUTH': {
      // DATABASE_AUTH uses SQL/NoSQL injection for auth-related fields
      const result = generateSqlNoSqlPayload();
      return { value: result.vector, description: result.description };
    }
    case 'EMAIL': {
      // EMAIL uses email-specific fuzzing vectors
      const result = generateEmailPayload();
      return { value: result.value, description: result.description };
    }
    case 'DATE': {
      // DATE uses date manipulation vectors
      const result = generateDatePayload();
      return { value: result.value, description: result.description };
    }
    case 'JSON': {
      // JSON uses JSON injection vectors
      const result = generateJsonPayload();
      return { value: result.value, description: result.description };
    }
    case 'CHAOS_FALLBACK':
    default: {
      const result = generateChaosPayload();
      return { value: result.value, description: result.description };
    }
  }
}

/**
 * Maps a classified FieldCategory to the FuzzingStrategyType label recorded in
 * FuzzMetadata, so forensic findings name the strategy that generated a payload.
 */
export function categoryToStrategyType(category: FieldCategory): FuzzingStrategyType {
  switch (category) {
    case 'NUMERIC':
      return 'boundary';
    case 'TEXT_SEARCH':
      return 'injection';
    case 'DATABASE_AUTH':
      return 'injection';
    case 'EMAIL':
      return 'mutating';
    case 'DATE':
      return 'boundary';
    case 'JSON':
      return 'encoding';
    case 'CHAOS_FALLBACK':
    default:
      return 'chaos';
  }
}

export default {
  getStrategyByCategory,
};

/**
 * JSON Strategy
 * 
 * Generates specialized payloads for JSON/API field fuzzing.
 * Tests for: JSON syntax errors, prototype pollution, deep object injection, type confusion.
 */

import { scenarioRandom } from '../../seededRandom.js';

export interface JsonPayload {
  type: 'SYNTAX_ERROR' | 'PROTOTYPE_POLLUTION' | 'DEEP_OBJECT' | 'TYPE_CONFUSION' | 'RECURSION' | 'ARRAY_OVERFLOW' | 'NULL_INJECTION' | 'UNICODE_ESCAPE';
  value: string;
  description: string;
}

/**
 * JSON syntax error variants
 */
const SYNTAX_ERROR_VECTORS: string[] = [
  '{',
  '}',
  '{invalid}',
  '{"a":',
  '{"a": }',
  '{"a": "b",}',
  '{"a": "b"',
  '["]',
  '[,]',
  '[,]',
  '{"a": [}',
  '{"a": []}',
  '{"a": {}}',
  'undefined',
  'nullnull',
  '{"a": "b" "c": "d"}',
];

/**
 * Prototype pollution vectors
 */
const PROTOTYPE_POLLUTION_VECTORS: string[] = [
  '{"__proto__": {"admin": true}}',
  '{"__proto__": {}}',
  '{"constructor": {"prototype": {"admin": true}}}',
  '{"constructor.prototype": {"admin": true}}',
  '{"__proto__": null}',
  '{"a": {"__proto__": {"evil": true}}}',
  '{"__proto__.isAdmin": true}',
  '{"constructor": null}',
  '{"__proto__": {"": ""}}',
  '{"x": {"__proto__": {"y": true}}}',
];

/**
 * Deep object injection - nested JSON
 */
const DEEP_OBJECT_VECTORS: string[] = [
  '{"a": {"b": {"c": {"d": {"e": {"f": "g"}}}}}',
  '{"a": {"b": {"c": {"d": {"e": {"f": {"g": "h"}}}}}}',
  '{"level1": {"level2": {"level3": {"level4": {"level5": "value"}}}}}',
  '{"a": {"a": {"a": {"a": {"a": {"a": "value"}}}}}}',
  '{"users": [{"id": 1}, {"id": 2}, {"id": 3}]}',
  '{"data": {"results": [{"item": 1}, {"item": 2}]}}',
];

/**
 * Type confusion variants
 */
const TYPE_CONFUSION_VECTORS: string[] = [
  '{"count": "not_a_number"}',
  '{"count": true}',
  '{"count": false}',
  '{"count": [1, 2, 3]}',
  '{"count": {"value": 1}}',
  '{"name": 12345}',
  '{"active": "true"}',
  '{"active": "false"}',
  '{"users": "not_an_array"}',
  '{"settings": "not_an_object"}',
];

/**
 * Recursion/cyclic reference variants
 */
const RECURSION_VECTORS: string[] = [
  '{"a": {"a": {"a": {"a": {"a": {"a": {"a": {"a": {"a": "value"}}}}}}}',
  '{"a": [{"a": [{"a": [{"a": [{"a": "value"}]}]}]',
  '{"a": {"b": {"a": {"b": {"a": "value"}}}}}',
];

/**
 * Array overflow variants
 */
const ARRAY_OVERFLOW_VECTORS: string[] = [
  '{"items": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]}',
  '{"items": []}',
  '{"items": [1]}',
  '{"items": Array(1000)}',
  '{"data": Array(10000).fill(0)}',
];

/**
 * Null injection variants
 */
const NULL_INJECTION_VECTORS: string[] = [
  '{"value": null}',
  '{"value": "null"}',
  '{"value": Null}',
  '{"value": NULL}',
  '{"value": nUll}',
  '{"value": "\\u0000"}',
  '{"value": "\\u0000\\u0000"}',
  '{"value": "\u0000value"}',
];

/**
 * Unicode escape variants
 */
const UNICODE_ESCAPE_VECTORS: string[] = [
  '{"value": "\\u0000"}',
  '{"value": "\\u0027"}',
  '{"value": "\\u0022"}',
  '{"value": "\\u003c"}',
  '{"value": "\\u003e"}',
  '{"name": "\\u0061\\u0062\\u0063"}',
  '{"script": "\\u003cscript\\u003ealert(1)\\u003c/script\\u003e"}',
];

/**
 * Generates a JSON fuzzing payload.
 * @returns A JsonPayload with attack vector
 */
export function generateJsonPayload(): JsonPayload {
  const rand = scenarioRandom();
  let payload: JsonPayload;

  if (rand < 0.12) {
    const value = SYNTAX_ERROR_VECTORS[Math.floor(scenarioRandom() * SYNTAX_ERROR_VECTORS.length)];
    payload = { type: 'SYNTAX_ERROR', value, description: 'JSON syntax error' };
  } else if (rand < 0.25) {
    const value = PROTOTYPE_POLLUTION_VECTORS[Math.floor(scenarioRandom() * PROTOTYPE_POLLUTION_VECTORS.length)];
    payload = { type: 'PROTOTYPE_POLLUTION', value, description: 'Prototype pollution' };
  } else if (rand < 0.38) {
    const value = DEEP_OBJECT_VECTORS[Math.floor(scenarioRandom() * DEEP_OBJECT_VECTORS.length)];
    payload = { type: 'DEEP_OBJECT', value, description: 'Deep object injection' };
  } else if (rand < 0.50) {
    const value = TYPE_CONFUSION_VECTORS[Math.floor(scenarioRandom() * TYPE_CONFUSION_VECTORS.length)];
    payload = { type: 'TYPE_CONFUSION', value, description: 'Type confusion' };
  } else if (rand < 0.62) {
    const value = RECURSION_VECTORS[Math.floor(scenarioRandom() * RECURSION_VECTORS.length)];
    payload = { type: 'RECURSION', value, description: 'Deep recursion' };
  } else if (rand < 0.74) {
    const value = ARRAY_OVERFLOW_VECTORS[Math.floor(scenarioRandom() * ARRAY_OVERFLOW_VECTORS.length)];
    payload = { type: 'ARRAY_OVERFLOW', value, description: 'Array overflow' };
  } else if (rand < 0.86) {
    const value = NULL_INJECTION_VECTORS[Math.floor(scenarioRandom() * NULL_INJECTION_VECTORS.length)];
    payload = { type: 'NULL_INJECTION', value, description: 'Null injection' };
  } else {
    const value = UNICODE_ESCAPE_VECTORS[Math.floor(scenarioRandom() * UNICODE_ESCAPE_VECTORS.length)];
    payload = { type: 'UNICODE_ESCAPE', value, description: 'Unicode escape sequence' };
  }

  return payload;
}

/**
 * Gets all JSON fuzzing vectors as an array.
 * @returns Array of attack vectors
 */
export function getAllJsonVectors(): string[] {
  return [
    ...SYNTAX_ERROR_VECTORS,
    ...PROTOTYPE_POLLUTION_VECTORS,
    ...DEEP_OBJECT_VECTORS,
    ...TYPE_CONFUSION_VECTORS,
    ...RECURSION_VECTORS,
    ...ARRAY_OVERFLOW_VECTORS,
    ...NULL_INJECTION_VECTORS,
    ...UNICODE_ESCAPE_VECTORS,
  ];
}

/**
 * Checks if a string value is a known JSON fuzzing vector.
 * @param value The value to check
 * @returns true if value is a known JSON vector
 */
export function isJsonVector(value: string): boolean {
  return getAllJsonVectors().includes(value);
}

export default generateJsonPayload;

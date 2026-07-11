/**
 * Numeric Boundary Strategy
 * 
 * Generates boundary edge-case payloads for numeric input fields.
 * Tests for: integer overflows, negative values, NaN, precision errors.
 */

import { scenarioRandom } from '../../seededRandom.js';

export interface NumericPayload {
  type: 'OVERFLOW' | 'NEGATIVE' | 'NAN' | 'PRECISION' | 'ZERO';
  value: string;
  description: string;
}

/**
 * Boundary values that commonly trigger numeric vulnerabilities
 */
const OVERFLOW_VALUES = [
  '99999999999999999999999999999999999999999999999999',
  '18446744073709551615',
  '2147483647',
  '-2147483648',
  '32767',
  '-32768',
  '65535',
];

const NEGATIVE_VALUES = [
  '-1',
  '-999999999999',
  '-0.0000001',
  '-3.4028235e38',
];

const NAN_VALUES = [
  'NaN',
  'nan',
  'NaNel',
  'Infinity',
  '-Infinity',
  'inf',
  '-inf',
  '1e999999999999999',
];

const PRECISION_VALUES = [
  '0.1',
  '0.01',
  '0.001',
  '0.0001',
  '1.0000000000000001',
  '1.7976931348623157e+308',
  '2.2250738585072014e-308',
];

const ZERO_VALUES = [
  '0',
  '-0',
  '+0',
  '0.0',
  '0e0',
  '0x0',
];

/**
 * Generates a boundary test payload for numeric fields.
 * @returns A NumericPayload with edge-case value
 */
export function generateNumericBoundaryPayload(): NumericPayload {
  const rand = scenarioRandom();
  let payload: NumericPayload;

  if (rand < 0.2) {
    const value = OVERFLOW_VALUES[Math.floor(scenarioRandom() * OVERFLOW_VALUES.length)];
    payload = { type: 'OVERFLOW', value, description: 'Integer overflow' };
  } else if (rand < 0.4) {
    const value = NEGATIVE_VALUES[Math.floor(scenarioRandom() * NEGATIVE_VALUES.length)];
    payload = { type: 'NEGATIVE', value, description: 'Negative boundary' };
  } else if (rand < 0.6) {
    const value = NAN_VALUES[Math.floor(scenarioRandom() * NAN_VALUES.length)];
    payload = { type: 'NAN', value, description: 'Not-a-Number' };
  } else if (rand < 0.8) {
    const value = PRECISION_VALUES[Math.floor(scenarioRandom() * PRECISION_VALUES.length)];
    payload = { type: 'PRECISION', value, description: 'Precision boundary' };
  } else {
    const value = ZERO_VALUES[Math.floor(scenarioRandom() * ZERO_VALUES.length)];
    payload = { type: 'ZERO', value, description: 'Zero boundary' };
  }

  return payload;
}

/**
 * Gets all numeric boundary test values as an array.
 * @returns Array of boundary values
 */
export function getAllNumericPayloads(): string[] {
  return [
    ...OVERFLOW_VALUES,
    ...NEGATIVE_VALUES,
    ...NAN_VALUES,
    ...PRECISION_VALUES,
    ...ZERO_VALUES,
  ];
}

/**
 * Checks if a string value is a valid numeric boundary payload.
 * @param value The value to check
 * @returns true if value is a known boundary payload
 */
export function isBoundaryPayload(value: string): boolean {
  return getAllNumericPayloads().includes(value);
}

export default generateNumericBoundaryPayload;

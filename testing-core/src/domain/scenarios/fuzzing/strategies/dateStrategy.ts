/**
 * Date Strategy
 * 
 * Generates specialized payloads for date/datetime field fuzzing.
 * Tests for: format manipulation, timestamp injection, timezone issues, invalid dates.
 */

export interface DatePayload {
  type: 'ISO_MANIPULATION' | 'UNIX_TIMESTAMP' | 'INVALID_DATE' | 'TIMEZONE_FUZZ' | 'FRACTIONAL_DATE' | 'NEGATIVE_DATE' | 'OVERFLOW_DATE' | 'EMPTY_DATE';
  value: string;
  description: string;
}

/**
 * ISO 8601 format manipulation
 */
const ISO_MANIPULATION_VECTORS: string[] = [
  '0000-01-01',
  '9999-12-31',
  '1970-01-01T00:00:00Z',
  '2038-01-19T03:14:07Z',
  '1969-12-31T23:59:59Z',
  '2024-02-30',
  '2024-13-01',
  '2024-01-32',
  '2024-04-31',
  '2024-06-31',
  '2024-09-31',
  '2024-11-31',
  '2024-00-01',
  '2024-01-00',
  '--01-01',
  '2024--01-01',
  '2024-01--01',
  '2024T00:00:00',
  'T00:00:00Z',
  '2024-01-01t00:00:00z',
  '2024/01/01',
  '01/01/2024',
  '01-01-2024',
  '2024.01.01',
];

/**
 * Unix timestamp variants
 */
const UNIX_TIMESTAMP_VECTORS: string[] = [
  '0',
  '-1',
  '1',
  '100',
  '1000',
  '10000',
  '100000',
  '1000000',
  '10000000',
  '100000000',
  '1000000000',
  '2147483647',
  '2147483648',
  '-2147483648',
  '253402300799',
  '-62135596800',
  '1704067200',
  '1704153600',
  '1704240000',
];

/**
 * Invalid date formats that may bypass validation
 */
const INVALID_DATE_VECTORS: string[] = [
  'not-a-date',
  'invalid',
  'null',
  'undefined',
  'NaN',
  'none',
  'today',
  'tomorrow',
  'yesterday',
  'now',
  'now()',
  'CURRENT_DATE',
  'SYSDATE',
  'GETDATE()',
  'CURDATE()',
  '01/01/1970',
  '01-01-1970',
  '1970/01/01',
  '32/13/2024',
];

/**
 * Timezone fuzzing variants
 */
const TIMEZONE_FUZZ_VECTORS: string[] = [
  '2024-01-01T00:00:00Z',
  '2024-01-01T00:00:00+00:00',
  '2024-01-01T00:00:00-00:00',
  '2024-01-01T00:00:00+12:00',
  '2024-01-01T00:00:00-12:00',
  '2024-01-01T00:00:00+14:00',
  '2024-01-01T00:00:00-14:00',
  '2024-01-01T00:00:00+05:30',
  '2024-01-01T00:00:00-05:30',
  '2024-01-01T00:00:00+08:00',
  '2024-01-01T00:00:00-08:00',
  '2024-01-01T00:00:00+09:00',
];

/**
 * Fractional date variants
 */
const FRACTIONAL_DATE_VECTORS: string[] = [
  '2024.5',
  '2024.25',
  '2024.75',
  '2024.0',
  '2024.01',
  '0.5',
  '0.25',
  '1970.0',
  '1900.0',
  '2000.5',
];

/**
 * Negative date values
 */
const NEGATIVE_DATE_VECTORS: string[] = [
  '-1',
  '-100',
  '-1000',
  '-10000',
  '-86400',
  '-365',
  '-30',
  '-1 days',
  '-1 year',
];

/**
 * Date overflow variants
 */
const OVERFLOW_DATE_VECTORS: string[] = [
  '9999-12-31',
  '9999-99-99',
  '99999999',
  '999999999999',
  '99999999999999999999',
  '3024-01-01',
  '10000-01-01',
  '100000-01-01',
  '2147483647-01-01',
];

/**
 * Empty/null date variants
 */
const EMPTY_DATE_VECTORS: string[] = [
  '',
  ' ',
  'null',
  'NULL',
  'None',
  'none',
  'undefined',
  'undefined',
  '0',
  '0.0',
  '-',
  '--',
  '//',
  '..',
  'T',
];

/**
 * Generates a date fuzzing payload.
 * @returns A DatePayload with attack vector
 */
export function generateDatePayload(): DatePayload {
  const rand = Math.random();
  let payload: DatePayload;

  if (rand < 0.12) {
    const value = ISO_MANIPULATION_VECTORS[Math.floor(Math.random() * ISO_MANIPULATION_VECTORS.length)];
    payload = { type: 'ISO_MANIPULATION', value, description: 'ISO 8601 manipulation' };
  } else if (rand < 0.25) {
    const value = UNIX_TIMESTAMP_VECTORS[Math.floor(Math.random() * UNIX_TIMESTAMP_VECTORS.length)];
    payload = { type: 'UNIX_TIMESTAMP', value, description: 'Unix timestamp injection' };
  } else if (rand < 0.38) {
    const value = INVALID_DATE_VECTORS[Math.floor(Math.random() * INVALID_DATE_VECTORS.length)];
    payload = { type: 'INVALID_DATE', value, description: 'Invalid date string' };
  } else if (rand < 0.50) {
    const value = TIMEZONE_FUZZ_VECTORS[Math.floor(Math.random() * TIMEZONE_FUZZ_VECTORS.length)];
    payload = { type: 'TIMEZONE_FUZZ', value, description: 'Timezone manipulation' };
  } else if (rand < 0.62) {
    const value = FRACTIONAL_DATE_VECTORS[Math.floor(Math.random() * FRACTIONAL_DATE_VECTORS.length)];
    payload = { type: 'FRACTIONAL_DATE', value, description: 'Fractional date' };
  } else if (rand < 0.74) {
    const value = NEGATIVE_DATE_VECTORS[Math.floor(Math.random() * NEGATIVE_DATE_VECTORS.length)];
    payload = { type: 'NEGATIVE_DATE', value, description: 'Negative date' };
  } else if (rand < 0.86) {
    const value = OVERFLOW_DATE_VECTORS[Math.floor(Math.random() * OVERFLOW_DATE_VECTORS.length)];
    payload = { type: 'OVERFLOW_DATE', value, description: 'Date overflow' };
  } else {
    const value = EMPTY_DATE_VECTORS[Math.floor(Math.random() * EMPTY_DATE_VECTORS.length)];
    payload = { type: 'EMPTY_DATE', value, description: 'Empty/null date' };
  }

  return payload;
}

/**
 * Gets all date fuzzing vectors as an array.
 * @returns Array of attack vectors
 */
export function getAllDateVectors(): string[] {
  return [
    ...ISO_MANIPULATION_VECTORS,
    ...UNIX_TIMESTAMP_VECTORS,
    ...INVALID_DATE_VECTORS,
    ...TIMEZONE_FUZZ_VECTORS,
    ...FRACTIONAL_DATE_VECTORS,
    ...NEGATIVE_DATE_VECTORS,
    ...OVERFLOW_DATE_VECTORS,
    ...EMPTY_DATE_VECTORS,
  ];
}

/**
 * Checks if a string value is a known date fuzzing vector.
 * @param value The value to check
 * @returns true if value is a known date vector
 */
export function isDateVector(value: string): boolean {
  return getAllDateVectors().includes(value);
}

export default generateDatePayload;

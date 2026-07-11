/**
 * Email Strategy
 * 
 * Generates specialized payloads for email address field fuzzing.
 * Tests for: email validation bypass, format manipulation, DNS fuzzing.
 */

import { scenarioRandom } from '../../seededRandom.js';

export interface EmailPayload {
  type: 'MISSING_AT' | 'MULTIPLE_AT' | 'INVALID_DOMAIN' | 'DNS_FUZZ' | 'DOT_ABUSE' | 'CASE_MANGLED' | 'PLUS_ADDRESSING' | 'NULL_BYTES';
  value: string;
  description: string;
}

/**
 * Missing @ symbol variants
 */
const MISSING_AT_VECTORS: string[] = [
  'testexample.com',
  'test@fake',
  'test.localhost',
  'test',
  'user@',
  '@domain.com',
];

/**
 * Multiple @ symbol variants
 */
const MULTIPLE_AT_VECTORS: string[] = [
  'test@@domain.com',
  'test@@@domain.com',
  'a@b@c@domain.com',
  'test@domain@com',
  '@test@domain.com',
];

/**
 * Invalid domain variants
 */
const INVALID_DOMAIN_VECTORS: string[] = [
  'test@.com',
  'test@..com',
  'test@domain.',
  'test@domain..',
  'test@-domain.com',
  'test@domain-.com',
  'test@domain.c',
  'test@domain.cöm',
  'test@løcalhost',
  'test@üñîcode.com',
  'test@999.999.999.999',
  'test@127.0.0.1',
  'test@localhost',
];

/**
 * DNS fuzzing variants - tries to resolve internal/dangerous hosts
 */
const DNS_FUZZ_VECTORS: string[] = [
  'test@localhost',
  'test@127.0.0.1',
  'test@0.0.0.0',
  'test@::1',
  'test@metadata.google.internal',
  'test@metadata.aws.internal',
  'test@169.254.169.254',
  'test@metadata.google',
  'test@dashboard.internal',
  'test@admin.internal',
  'test@dev.internal',
  'test@staging.internal',
];

/**
 * Dot abuse - multiple dots, leading/trailing dots
 */
const DOT_ABUSE_VECTORS: string[] = [
  'test@..domain.com',
  '.test@domain.com',
  'test.@domain.com',
  'test..test@domain.com',
  '.test.@domain.com',
  'test.@domain.com.',
  ' t@domain.com',
  'test @domain.com',
];

/**
 * Case mangling variants - uppercase/lowercase fuzzing
 */
const CASE_MANGLED_VECTORS: string[] = [
  'TEST@DOMAIN.COM',
  'Test@Domain.Com',
  'tEst@DoMaIn.CoM',
  'TEST@domain.com',
  'test@DOMAIN.COM',
  'Test@Test.COM',
  'TEST@test.COM',
];

/**
 * Plus addressing variants - tests for bad alias handling
 */
const PLUS_ADDRESSING_VECTORS: string[] = [
  'test+spam@domain.com',
  'test+admin@domain.com',
  'test+root@domain.com',
  'test+@{domain.com}',
  'test+all@domain.com',
  'test+verify@domain.com',
  'test+[email]@domain.com',
  'test+{email}@domain.com',
  'test%40domain.com',
  'test(email)@domain.com',
];

/**
 * Null byte injection variants
 */
const NULL_BYTE_VECTORS: string[] = [
  'test\u0000@domain.com',
  'test@doma\u0000in.com',
  'test@domain\u0000.com',
  'test\u0000@domain\u0000.com',
  'test%00@domain.com',
  'test@domain%00.com',
];

/**
 * Generates an email fuzzing payload.
 * @returns An EmailPayload with attack vector
 */
export function generateEmailPayload(): EmailPayload {
  const rand = scenarioRandom();
  let payload: EmailPayload;

  if (rand < 0.12) {
    const value = MISSING_AT_VECTORS[Math.floor(scenarioRandom() * MISSING_AT_VECTORS.length)];
    payload = { type: 'MISSING_AT', value, description: 'Missing @ symbol' };
  } else if (rand < 0.24) {
    const value = MULTIPLE_AT_VECTORS[Math.floor(scenarioRandom() * MULTIPLE_AT_VECTORS.length)];
    payload = { type: 'MULTIPLE_AT', value, description: 'Multiple @ symbols' };
  } else if (rand < 0.36) {
    const value = INVALID_DOMAIN_VECTORS[Math.floor(scenarioRandom() * INVALID_DOMAIN_VECTORS.length)];
    payload = { type: 'INVALID_DOMAIN', value, description: 'Invalid domain format' };
  } else if (rand < 0.50) {
    const value = DNS_FUZZ_VECTORS[Math.floor(scenarioRandom() * DNS_FUZZ_VECTORS.length)];
    payload = { type: 'DNS_FUZZ', value, description: 'DNS/internal host fuzzing' };
  } else if (rand < 0.62) {
    const value = DOT_ABUSE_VECTORS[Math.floor(scenarioRandom() * DOT_ABUSE_VECTORS.length)];
    payload = { type: 'DOT_ABUSE', value, description: 'Dot abuse/positioning' };
  } else if (rand < 0.74) {
    const value = CASE_MANGLED_VECTORS[Math.floor(scenarioRandom() * CASE_MANGLED_VECTORS.length)];
    payload = { type: 'CASE_MANGLED', value, description: 'Case mangling' };
  } else if (rand < 0.86) {
    const value = PLUS_ADDRESSING_VECTORS[Math.floor(scenarioRandom() * PLUS_ADDRESSING_VECTORS.length)];
    payload = { type: 'PLUS_ADDRESSING', value, description: 'Plus addressing' };
  } else {
    const value = NULL_BYTE_VECTORS[Math.floor(scenarioRandom() * NULL_BYTE_VECTORS.length)];
    payload = { type: 'NULL_BYTES', value, description: 'Null byte injection' };
  }

  return payload;
}

/**
 * Gets all email fuzzing vectors as an array.
 * @returns Array of attack vectors
 */
export function getAllEmailVectors(): string[] {
  return [
    ...MISSING_AT_VECTORS,
    ...MULTIPLE_AT_VECTORS,
    ...INVALID_DOMAIN_VECTORS,
    ...DNS_FUZZ_VECTORS,
    ...DOT_ABUSE_VECTORS,
    ...CASE_MANGLED_VECTORS,
    ...PLUS_ADDRESSING_VECTORS,
    ...NULL_BYTE_VECTORS,
  ];
}

/**
 * Checks if a string value is a known email fuzzing vector.
 * @param value The value to check
 * @returns true if value is a known email vector
 */
export function isEmailVector(value: string): boolean {
  return getAllEmailVectors().includes(value);
}

export default generateEmailPayload;

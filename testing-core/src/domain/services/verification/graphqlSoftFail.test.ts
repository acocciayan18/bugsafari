// Self-executing checks for the GraphQL soft-fail suppression — isGraphQLErrorResponse
// and resolveMaskedFailure. A valid HTTP 200 GraphQL response carrying field/resolver
// errors is normal GraphQL (spec §7), NOT a CWE-754 API contract violation; a REST 200
// error envelope still promotes, and a server-error signature overrides suppression.
// Run: `npx tsx src/domain/services/verification/graphqlSoftFail.test.ts`.

import assert from 'node:assert/strict';
import { isGraphQLErrorResponse, resolveMaskedFailure } from './softFailBody.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const GQL_ERRORS = '{"data":null,"errors":[{"message":"Cannot query field \\"foo\\" on type \\"Query\\".","locations":[{"line":1,"column":3}]}]}';
const GQL_PARTIAL = '{"data":{"user":null},"errors":[{"message":"Forbidden","path":["user"]}]}';
const REST_ERROR_FLAG = '{"error":true,"message":"order processing failed"}';
const REST_SUCCESS_FALSE = '{"success":false,"reason":"payment declined"}';
const REST_STRING_ERRORS = '{"errors":["name is required","email is invalid"]}';
const REST_AUTH_LOGIN = '{"success":false,"message":"invalid credentials"}';
const SQL_LEAK = '{"data":null,"errors":[{"message":"ER_PARSE_ERROR: You have an error in your SQL syntax near SELECT * FROM users"}]}';

console.log('graphqlSoftFail — isGraphQLErrorResponse');

check('spec-shaped errors on a /graphql endpoint is recognized', () => {
  assert.equal(isGraphQLErrorResponse('https://x.test/graphql', GQL_ERRORS), true);
  assert.equal(isGraphQLErrorResponse('https://x.test/api/graphql?query=%7Bfoo%7D', GQL_ERRORS), true);
});

check('spec-shaped errors off a graphql route is recognized via the data sibling', () => {
  assert.equal(isGraphQLErrorResponse('https://x.test/api/query', GQL_PARTIAL), true);
});

check('a REST string-array errors payload is NOT GraphQL', () => {
  assert.equal(isGraphQLErrorResponse('https://x.test/api/users', REST_STRING_ERRORS), false);
});

check('a REST error-flag envelope is NOT GraphQL', () => {
  assert.equal(isGraphQLErrorResponse('https://x.test/api/orders', REST_ERROR_FLAG), false);
});

check('an empty body is NOT GraphQL', () => {
  assert.equal(isGraphQLErrorResponse('https://x.test/graphql', ''), false);
});

console.log('graphqlSoftFail — resolveMaskedFailure (GraphQL vs REST)');

check('GraphQL 200 errors on /graphql → suppressed, informational, no finding', () => {
  const r = resolveMaskedFailure({ url: 'https://x.test/graphql', body: GQL_ERRORS, serverSignature: false });
  assert.equal(r.softFail, false);
  assert.equal(r.graphqlInformational, true);
});

check('GraphQL shape off-endpoint → suppressed via data sibling', () => {
  const r = resolveMaskedFailure({ url: 'https://x.test/api/query', body: GQL_PARTIAL, serverSignature: false });
  assert.equal(r.softFail, false);
  assert.equal(r.graphqlInformational, true);
});

check('GraphQL endpoint whose body leaks a SQL error → still promotes (server signature overrides)', () => {
  const r = resolveMaskedFailure({ url: 'https://x.test/graphql', body: SQL_LEAK, serverSignature: true });
  assert.equal(r.softFail, true);
  assert.equal(r.graphqlInformational, false);
});

check('REST error-flag 200 → promotes (masked failure)', () => {
  const r = resolveMaskedFailure({ url: 'https://x.test/api/orders', body: REST_ERROR_FLAG, serverSignature: false });
  assert.equal(r.softFail, true);
  assert.equal(r.graphqlInformational, false);
});

check('REST success:false on a non-auth endpoint → promotes', () => {
  const r = resolveMaskedFailure({ url: 'https://x.test/api/checkout', body: REST_SUCCESS_FALSE, serverSignature: false });
  assert.equal(r.softFail, true);
});

check('REST string-array errors → promotes (not GraphQL-shaped)', () => {
  const r = resolveMaskedFailure({ url: 'https://x.test/api/users', body: REST_STRING_ERRORS, serverSignature: false });
  assert.equal(r.softFail, true);
  assert.equal(r.graphqlInformational, false);
});

check('REST auth login success:false → suppressed via expected rejection (behavior preserved)', () => {
  const r = resolveMaskedFailure({ url: 'https://x.test/api/login', body: REST_AUTH_LOGIN, serverSignature: false });
  assert.equal(r.softFail, false);
  assert.equal(r.graphqlInformational, false);
});

check('a clean 200 body with no envelope → no fault', () => {
  const r = resolveMaskedFailure({ url: 'https://x.test/graphql', body: '{"data":{"user":{"id":1}}}', serverSignature: false });
  assert.equal(r.softFail, false);
  assert.equal(r.graphqlInformational, false);
});

console.log(`\n${passed} assertions passed.`);

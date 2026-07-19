// Standalone tests for the shared pagination helpers. No unit-test runner is
// configured in this package, so this is a self-executing script:
// `npx tsx src/presentation/api/pagination.test.ts`.

import assert from 'node:assert/strict';
import type { ParsedQs } from 'qs';
import { parsePagination, buildPage, isPaginatedRequest } from './pagination.js';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../../../../shared/types.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const query = (values: Record<string, string>): ParsedQs => values as unknown as ParsedQs;

console.log('pagination — page-based list contract');

check('defaults to page 1 at the default page size', () => {
  const params = parsePagination(query({}));
  assert.deepEqual(params, { page: 1, pageSize: DEFAULT_PAGE_SIZE, skip: 0 });
});

check('computes skip from page and pageSize', () => {
  assert.equal(parsePagination(query({ page: '3', pageSize: '20' })).skip, 40);
});

check('clamps pageSize to the maximum', () => {
  assert.equal(parsePagination(query({ pageSize: '99999' })).pageSize, MAX_PAGE_SIZE);
});

check('rejects non-positive and unparseable page values', () => {
  for (const page of ['0', '-5', 'abc', '']) {
    assert.equal(parsePagination(query({ page })).page, 1, `page=${page}`);
  }
});

check('pageSize floor is 1, never 0 or negative', () => {
  for (const pageSize of ['0', '-10']) {
    assert.equal(parsePagination(query({ pageSize })).pageSize, 1, `pageSize=${pageSize}`);
  }
});

check('legacy limit maps onto pageSize but loses to an explicit pageSize', () => {
  assert.equal(parsePagination(query({}), 25).pageSize, 25);
  assert.equal(parsePagination(query({ pageSize: '10' }), 25).pageSize, 10);
});

check('hasMore is true only while rows remain beyond this page', () => {
  const params = parsePagination(query({ page: '1', pageSize: '2' }));
  assert.equal(buildPage([1, 2], 5, params).hasMore, true);
  assert.equal(buildPage([1, 2], 2, params).hasMore, false);
});

check('hasMore is false on the final page', () => {
  const params = parsePagination(query({ page: '3', pageSize: '2' }));
  assert.equal(buildPage([5], 5, params).hasMore, false);
});

check('an empty page past the end does not claim more rows', () => {
  const params = parsePagination(query({ page: '99', pageSize: '10' }));
  assert.equal(buildPage([], 5, params).hasMore, false);
});

check('envelope carries the page metadata alongside items', () => {
  const params = parsePagination(query({ page: '2', pageSize: '5' }));
  assert.deepEqual(buildPage(['a'], 6, params), {
    items: ['a'],
    page: 2,
    pageSize: 5,
    total: 6,
    hasMore: false,
  });
});

check('paginated requests are detected by either param', () => {
  assert.equal(isPaginatedRequest(query({})), false);
  assert.equal(isPaginatedRequest(query({ limit: '10' })), false);
  assert.equal(isPaginatedRequest(query({ page: '1' })), true);
  assert.equal(isPaginatedRequest(query({ pageSize: '10' })), true);
});

console.log(`\n${passed} passed`);

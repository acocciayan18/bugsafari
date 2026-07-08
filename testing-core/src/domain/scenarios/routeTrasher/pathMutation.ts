import type { Page } from 'playwright';
import { safeGoto, assertWithinOrigin } from './navigation.js';

/**
 * Malformed dynamic-route-parameter values. Ordered and picked round-robin by
 * iteration index (no `Math.random`), so a given origin + iteration always yields
 * the same mutation — fully reproducible for regression replay.
 */
export const PATH_MUTATIONS = [
  'null',
  'undefined',
  'NaN',
  '-1',
  '9999999999999',
  '99999999999999999999999999999999', // oversized: exceeds 2^53, breaks naive int parsers
  'Infinity',
  '[object Object]', // invalid runtime value — a stringified object that leaked into a route
  '{}',
  '[]',
  'true',
  '%00',
  '..%2f..%2f',
  '<script>',
  '%2e%2e',
] as const;

/** Malformed client-side hash-route fragments (SPA hash routers). */
export const HASH_MUTATIONS = [
  '#/undefined',
  '#/null',
  '#//',
  '#/%00',
  '#/../../',
  `#/${'a'.repeat(4096)}`,
] as const;

export type PathMutationType = (typeof PATH_MUTATIONS)[number];

export interface RouteMutationOutcome {
  /** Whether the mutated navigation ran (and stayed within the origin boundary). */
  mutated: boolean;
  mutation?: string;
  /** The page URL after attempting the mutation. */
  resultingUrl: string;
}

/**
 * Replace the last path segment with a malformed dynamic-route value and navigate
 * to the mutated URL. Built from `originUrl` so it stays same-origin by
 * construction, then re-checked with {@link assertWithinOrigin} as defense — a
 * candidate that would leave the origin is skipped (`mutated: false`).
 */
export async function mutateRoutePath(
  page: Page,
  originUrl: string,
  index: number,
): Promise<RouteMutationOutcome> {
  const mutation = PATH_MUTATIONS[index % PATH_MUTATIONS.length];
  let candidate: string;
  try {
    const urlObj = new URL(originUrl);
    const segments = urlObj.pathname.split('/').filter(Boolean);
    if (segments.length > 0) {
      segments[segments.length - 1] = mutation;
    } else {
      segments.push(mutation);
    }
    urlObj.pathname = `/${segments.join('/')}`;
    candidate = urlObj.toString();
  } catch {
    return { mutated: false, resultingUrl: page.url() };
  }

  if (!assertWithinOrigin(candidate, originUrl)) {
    console.log(`[StressScenario:RouteTrasher] Blocked off-origin path mutation: ${candidate}`);
    return { mutated: false, mutation, resultingUrl: page.url() };
  }

  const mutated = await safeGoto(page, candidate, 1000);
  return { mutated, mutation, resultingUrl: page.url() };
}

/**
 * Deterministically mutate the client-side hash route. Setting `location.hash`
 * stays same-origin inherently (no document navigation), so it needs no origin
 * guard. Returns whether the hash actually changed.
 */
export async function mutateHashRoute(page: Page, index: number): Promise<RouteMutationOutcome> {
  const mutation = HASH_MUTATIONS[index % HASH_MUTATIONS.length];
  try {
    await page.evaluate((h) => {
      location.hash = h;
    }, mutation);
    return { mutated: true, mutation, resultingUrl: page.url() };
  } catch (error) {
    console.log(
      `[StressScenario:RouteTrasher] Hash mutation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { mutated: false, mutation, resultingUrl: page.url() };
  }
}

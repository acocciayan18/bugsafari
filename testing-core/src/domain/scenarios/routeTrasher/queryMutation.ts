import type { Page } from 'playwright';
import { safeGoto } from './navigation.js';

/**
 * Ordered query-string mutation strategies used to trigger hidden framework
 * routing errors. Ordering is significant: the route trasher picks by iteration
 * index (round-robin) so the same URL + iteration is fully reproducible.
 */
export const QUERY_MUTATIONS = [
  'nullify',
  'undefined',
  'nan',
  'extreme_int',
  'empty_string',
  'drop_param',
] as const;

export type QueryMutationType = (typeof QUERY_MUTATIONS)[number];

export interface QueryMutationOutcome {
  /** Whether a parameter existed and the mutated navigation ran. */
  mutated: boolean;
  mutation?: QueryMutationType;
  param?: string;
  /** The page URL after attempting the mutation. */
  resultingUrl: string;
}

/**
 * Deterministically mutate a single query parameter and navigate to the mutated
 * URL. The parameter is chosen by `paramIndex` (round-robin over the present
 * params) and the mutation by the caller — no `Math.random`, so a given URL +
 * iteration always yields the same mutation. No-ops (returns `mutated: false`)
 * when the URL has no query parameters to mutate.
 */
export async function mutateQueryParams(
  page: Page,
  mutation: QueryMutationType,
  paramIndex: number,
): Promise<QueryMutationOutcome> {
  const currentUrl = page.url();
  const urlObj = new URL(currentUrl);
  const params = urlObj.searchParams;
  const paramNames = Array.from(params.keys());

  if (paramNames.length === 0) {
    return { mutated: false, resultingUrl: currentUrl };
  }

  const targetParam = paramNames[paramIndex % paramNames.length];

  switch (mutation) {
    case 'nullify':
      params.set(targetParam, 'null');
      break;
    case 'undefined':
      params.set(targetParam, 'undefined');
      break;
    case 'nan':
      params.set(targetParam, 'NaN');
      break;
    case 'extreme_int': {
      // Deterministic MAX/MIN choice via param-name length parity (was Math.random).
      const extremeValue =
        targetParam.length % 2 === 0
          ? Number.MAX_SAFE_INTEGER.toString()
          : Number.MIN_SAFE_INTEGER.toString();
      params.set(targetParam, extremeValue);
      break;
    }
    case 'empty_string':
      params.set(targetParam, '');
      break;
    case 'drop_param':
      params.delete(targetParam);
      break;
  }

  const mutated = await safeGoto(page, urlObj.toString(), 1000);
  return {
    mutated,
    mutation,
    param: targetParam,
    resultingUrl: page.url(),
  };
}

import type { ParsedQs } from 'qs';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  type PaginatedResponse,
  type PaginationParams,
} from '../../../../shared/types.js';
import { extractIntParam } from './queryParams.js';

// True when the caller opted into the paginated envelope explicitly.
export function isPaginatedRequest(query: ParsedQs): boolean {
  return query.page !== undefined || query.pageSize !== undefined;
}

// Clamp page/pageSize into safe bounds. `legacyLimit` maps an older ?limit= param
// onto pageSize so pre-pagination clients keep their requested page size.
export function parsePagination(query: ParsedQs, legacyLimit?: number): PaginationParams {
  const rawPage = extractIntParam(query.page);
  const rawPageSize = extractIntParam(query.pageSize) ?? legacyLimit;

  const page = rawPage !== undefined && rawPage > 0 ? rawPage : 1;
  const pageSize = Math.max(1, Math.min(rawPageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE));

  return { page, pageSize, skip: (page - 1) * pageSize };
}

export function buildPage<T>(items: T[], total: number, params: PaginationParams): PaginatedResponse<T> {
  return {
    items,
    page: params.page,
    pageSize: params.pageSize,
    total,
    hasMore: params.skip + items.length < total,
  };
}

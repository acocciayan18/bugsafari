// Shared page-based pagination contract for every list endpoint.

export interface PaginatedResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export interface PaginationParams {
  page: number;
  pageSize: number;
  skip: number;
}

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

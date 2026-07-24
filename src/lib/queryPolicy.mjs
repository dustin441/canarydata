export const CUSTOMER_SEARCH_QUERY_LIMIT = 10;
export const CUSTOMER_SEARCH_QUERY_MIN_LENGTH = 3;
export const CUSTOMER_SEARCH_QUERY_MAX_LENGTH = 200;
export const SEARCH_QUERY_RUN_INTERVAL_DAYS = 2;

export function normalizeSearchQueryText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

export function searchQueryFingerprint(value) {
  return normalizeSearchQueryText(value).toLocaleLowerCase('en-US');
}

export function validateSearchQueryText(value) {
  const query = normalizeSearchQueryText(value);
  if (query.length < CUSTOMER_SEARCH_QUERY_MIN_LENGTH) {
    throw new Error(`Search queries must be at least ${CUSTOMER_SEARCH_QUERY_MIN_LENGTH} characters.`);
  }
  if (query.length > CUSTOMER_SEARCH_QUERY_MAX_LENGTH) {
    throw new Error(`Search queries must be ${CUSTOMER_SEARCH_QUERY_MAX_LENGTH} characters or fewer.`);
  }
  if (!/[\p{L}\p{N}]/u.test(query)) {
    throw new Error('Search queries must include at least one letter or number.');
  }
  return query;
}

export function activeNewsQueryCount(queries) {
  return (queries || []).filter((query) => query?.active !== false && query?.channels === 'news').length;
}

export function estimatedMonthlySearches(queryCount, days = 30) {
  const safeCount = Math.max(0, Number(queryCount) || 0);
  return Math.ceil((safeCount * days) / SEARCH_QUERY_RUN_INTERVAL_DAYS);
}

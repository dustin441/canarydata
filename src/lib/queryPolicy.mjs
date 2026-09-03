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

export function validateCustomerSearchQueryText(value) {
  const query = validateSearchQueryText(value);
  if (/\b(?:AND|OR|NOT)\b/i.test(query) || /[()]/.test(query)) {
    throw new Error('Use one school, district, person, program, or topic per query. Compound Boolean queries require Canary review.');
  }
  const siteClauses = query.match(/\bsite\s*:/gi) || [];
  if (siteClauses.length > 1) {
    throw new Error('Use no more than one site: filter per query.');
  }
  const quoteCount = (query.match(/["“”]/g) || []).length;
  if (quoteCount % 2 !== 0 || quoteCount > 2) {
    throw new Error('Use at most one complete quoted phrase per query.');
  }
  return query;
}

export function activeNewsQueryCount(queries) {
  return (queries || []).filter((query) => query?.active !== false && query?.channels === 'news').length;
}

export function hasActiveSearchQueryDuplicate(queries, candidate) {
  const fingerprint = searchQueryFingerprint(candidate?.query_text);
  return (queries || []).some((query) => (
    query?.id !== candidate?.id &&
    query?.active !== false &&
    query?.channels === candidate?.channels &&
    searchQueryFingerprint(query?.query_text) === fingerprint
  ));
}

const SEARCH_QUERY_SNAPSHOT_FIELDS = ['query_text', 'channels', 'active', 'geo_city', 'geo_state', 'geo_zip'];
const NULLABLE_SEARCH_QUERY_FIELDS = new Set(['geo_city', 'geo_state', 'geo_zip']);

export function searchQuerySnapshot(query) {
  if (!query || SEARCH_QUERY_SNAPSHOT_FIELDS.some((field) => !Object.hasOwn(query, field))) {
    throw new Error('The original query values are missing. Refresh and try again.');
  }
  if (typeof query.query_text !== 'string' || (query.channels !== null && typeof query.channels !== 'string')) {
    throw new Error('The original query values are invalid. Refresh and try again.');
  }
  if (query.active !== null && typeof query.active !== 'boolean') {
    throw new Error('The original query values are invalid. Refresh and try again.');
  }
  for (const field of NULLABLE_SEARCH_QUERY_FIELDS) {
    if (query[field] !== null && typeof query[field] !== 'string') {
      throw new Error('The original query values are invalid. Refresh and try again.');
    }
  }
  return Object.fromEntries(SEARCH_QUERY_SNAPSHOT_FIELDS.map((field) => [field, query[field]]));
}

export function applySearchQuerySnapshotFilters(queryBuilder, snapshotInput) {
  const snapshot = searchQuerySnapshot(snapshotInput);
  let filtered = queryBuilder;
  for (const field of SEARCH_QUERY_SNAPSHOT_FIELDS) {
    filtered = snapshot[field] === null
      ? filtered.is(field, null)
      : filtered.eq(field, snapshot[field]);
  }
  return filtered;
}

export async function reconcileActiveSearchQueryWrite({ writtenQuery, loadDistrictQueries, undoWrittenQuery }) {
  const districtQueries = await loadDistrictQueries();
  if (writtenQuery?.active !== true || !hasActiveSearchQueryDuplicate(districtQueries, writtenQuery)) {
    return { duplicate: false, reconciled: false };
  }
  const reconciled = await undoWrittenQuery(searchQuerySnapshot(writtenQuery));
  return { duplicate: true, reconciled: Boolean(reconciled) };
}

function cleanSearchQueryLocation(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

export function buildSearchQueryUpdate({ actor, existingQuery, changes = {} }) {
  if (!existingQuery?.id) throw new Error('Search query not found.');
  if (!actor?.isAdmin && existingQuery.district_id !== actor?.districtId) {
    throw new Error('You do not have access to this district.');
  }
  if (!actor?.isAdmin && (existingQuery.active !== true || existingQuery.channels !== 'news')) {
    throw new Error('Customers can edit only their active news queries.');
  }

  const requestedDistrictId = String(changes.district_id ?? existingQuery.district_id ?? '').trim();
  if (requestedDistrictId !== existingQuery.district_id) {
    throw new Error('Search queries cannot be moved to another district.');
  }

  const requestedChannel = String(changes.channels ?? existingQuery.channels ?? 'news').trim();
  if (!actor?.isAdmin && requestedChannel !== 'news') {
    throw new Error('The query channel cannot be changed.');
  }
  const channels = actor?.isAdmin && ['news', 'social', 'all'].includes(requestedChannel)
    ? requestedChannel
    : existingQuery.channels;

  return {
    query_text: actor?.isAdmin
      ? validateSearchQueryText(changes.query_text)
      : validateCustomerSearchQueryText(changes.query_text),
    channels,
    geo_city: cleanSearchQueryLocation(changes.geo_city ?? existingQuery.geo_city, 100),
    geo_state: cleanSearchQueryLocation(changes.geo_state ?? existingQuery.geo_state, 50),
    geo_zip: cleanSearchQueryLocation(changes.geo_zip ?? existingQuery.geo_zip, 20),
  };
}

export function estimatedMonthlySearches(queryCount, days = 30) {
  const safeCount = Math.max(0, Number(queryCount) || 0);
  return Math.ceil((safeCount * days) / SEARCH_QUERY_RUN_INTERVAL_DAYS);
}

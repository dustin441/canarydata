import assert from 'node:assert/strict';
import {
  CUSTOMER_SEARCH_QUERY_LIMIT,
  activeNewsQueryCount,
  estimatedMonthlySearches,
  normalizeSearchQueryText,
  searchQueryFingerprint,
  validateSearchQueryText,
} from '../src/lib/queryPolicy.mjs';

assert.equal(CUSTOMER_SEARCH_QUERY_LIMIT, 10);
assert.equal(normalizeSearchQueryText('  Santa   Clara   schools  '), 'Santa Clara schools');
assert.equal(searchQueryFingerprint(' Santa CLARA Schools '), 'santa clara schools');
assert.equal(validateSearchQueryText('  Hoover school board  '), 'Hoover school board');
assert.throws(() => validateSearchQueryText('***'), /letter or number/);
assert.throws(() => validateSearchQueryText('ab'), /at least 3 characters/);
assert.throws(() => validateSearchQueryText('x'.repeat(201)), /200 characters or fewer/);
assert.equal(activeNewsQueryCount([
  { channels: 'news', active: true },
  { channels: 'news', active: false },
  { channels: 'social', active: true },
  { channels: 'news' },
]), 2);
assert.equal(estimatedMonthlySearches(10), 150);

console.log('Query management policy tests passed.');

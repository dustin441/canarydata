import assert from 'node:assert/strict';
import { buildReportingDataset, filterReportingDataset, isNewsMediaArticle } from '../src/lib/reportingDataset.mjs';

const articles = [
  { id: 'news-1', district_id: 'alpha', source_type: 'news', headline: 'Kindergarten registration opens', canary_score: 8 },
  { id: 'news-2', district_id: 'alpha', source_type: 'web', headline: 'Budget hearing scheduled', canary_score: null },
  { id: 'legacy-duplicate', district_id: 'alpha', source_type: 'facebook', headline: 'Registration reminder', link: 'https://facebook.com/district/posts/123', date: '2026-07-01' },
  { id: 'legacy-only', district_id: 'alpha', source_type: 'instagram', headline: 'Archived arts campaign', link: 'https://instagram.com/p/legacy-only', date: '2026-06-01' },
  { id: 'news-beta', district_id: 'beta', source_type: 'news', headline: 'Beta district story', canary_score: 7 },
  { id: 'legacy-gamma', district_id: 'gamma', source_type: 'instagram', headline: 'Gamma legacy fallback', link: 'https://instagram.com/p/gamma', date: '2026-06-03' },
];
const socialThreads = [
  { id: 'canonical-1', external_thread_id: 'canonical-1', district_id: 'alpha', platform: 'facebook', headline: 'Registration reminder', canonical_url: 'https://facebook.com/district/posts/123', published_at: '2026-07-01', relationship_type: 'owned', visibility_status: 'active' },
  { id: 'canonical-2', external_thread_id: 'canonical-2', district_id: 'beta', platform: 'instagram', headline: 'Beta social post', canonical_url: 'https://instagram.com/p/beta', published_at: '2026-07-02', relationship_type: 'owned', visibility_status: 'active' },
  { id: 'canonical-cross-district', external_thread_id: 'canonical-cross-district', district_id: 'beta', platform: 'facebook', headline: 'Registration reminder shared with beta', canonical_url: 'https://facebook.com/district/posts/123', published_at: '2026-07-01', relationship_type: 'owned', visibility_status: 'active' },
];
const socialSources = [
  { id: 'alpha-instagram-source', district_id: 'alpha', platform: 'instagram', active: true },
];

assert.equal(isNewsMediaArticle(articles[0]), true);
assert.equal(isNewsMediaArticle(articles[2]), false);

const central = buildReportingDataset({ articles, socialThreads, socialSources });
assert.equal(central.mediaArticles.length, 3, 'central media collection excludes social-source article rows');
assert.equal(central.socialResults.length, 4, 'canonical threads plus legacy fallback from unconfigured lanes remain client-visible');
assert.equal(central.suppressedLegacySocialResults.length, 1, 'configured lanes expose unmatched legacy rows only as admin reference data');
assert.equal(central.records.length, 7, 'the central reporting collection excludes suppressed legacy reference rows from client-facing totals');
assert.equal(central.socialResults.filter((result) => result.url?.includes('/district/posts/123')).length, 2, 'the same public URL remains available to each associated district');

const alpha = filterReportingDataset(central, { districtId: 'alpha' });
assert.deepEqual(alpha.mediaArticles.map((article) => article.id).sort(), ['news-1', 'news-2']);
assert.equal(alpha.socialResults.length, 1);
assert.equal(alpha.suppressedLegacySocialResults.length, 1);
assert.equal(alpha.records.length, alpha.mediaArticles.length + alpha.socialResults.length);
const beta = filterReportingDataset(central, { districtId: 'beta' });
assert.equal(beta.socialResults.length, 2, 'cross-district URL deduplication must not hide a district record');
assert.equal(beta.suppressedLegacySocialResults.length, 0);
assert.equal(beta.records.length, beta.mediaArticles.length + beta.socialResults.length, 'normalized record filters remain district-safe');
const gamma = filterReportingDataset(central, { districtId: 'gamma' });
assert.equal(gamma.socialResults.length, 1, 'legacy Social remains available until that exact district/platform lane is configured');
assert.equal(gamma.suppressedLegacySocialResults.length, 0);

const campaign = filterReportingDataset(central, { districtId: 'alpha', campaignSearch: 'registration' });
assert.deepEqual(campaign.mediaArticles.map((article) => article.id), ['news-1']);
assert.deepEqual(campaign.socialResults.map((result) => result.id), ['canonical-1']);
assert.equal(campaign.records.length, 2, 'one campaign filter is applied to both channel views');

const noteUpdated = buildReportingDataset({
  articles: articles.map((article) => article.id === 'news-2' ? { ...article, notes: 'Enrollment campaign follow-up' } : article),
  socialThreads,
  socialSources,
});
assert.deepEqual(
  filterReportingDataset(noteUpdated, { districtId: 'alpha', campaignSearch: 'enrollment' }).mediaArticles.map((article) => article.id),
  ['news-2'],
  'resolved analyst note text participates in central campaign membership',
);

console.log('Central reporting dataset tests passed.');

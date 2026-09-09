import assert from 'node:assert/strict';
import { buildReportingDataset, filterReportingDataset, isNewsMediaArticle } from '../src/lib/reportingDataset.mjs';

const articles = [
  { id: 'news-1', district_id: 'alpha', source_type: 'news', headline: 'Kindergarten registration opens', canary_score: 8 },
  { id: 'manual-1', district_id: 'alpha', source_type: 'manual', headline: 'Board release added by an analyst', canary_score: 7 },
  { id: 'web-1', district_id: 'alpha', source_type: 'web', headline: 'Budget hearing scheduled', canary_score: null },
  { id: 'legacy-facebook', district_id: 'alpha', source_type: 'facebook', headline: 'Registration reminder', link: 'https://facebook.com/district/posts/123', date: '2026-07-01' },
  { id: 'legacy-instagram', district_id: 'alpha', source_type: 'instagram', headline: 'Archived arts campaign', link: 'https://instagram.com/p/legacy-only', date: '2026-06-01' },
  { id: 'legacy-tiktok', district_id: 'alpha', source_type: 'tiktok', headline: 'Archived video', link: 'https://tiktok.com/@district/video/123', date: '2026-05-01' },
  { id: 'news-beta', district_id: 'beta', source_type: 'news', headline: 'Beta district story', canary_score: 7 },
];
const legacySocialArticles = articles.filter((article) => !isNewsMediaArticle(article));
const socialThreads = [
  { id: 'canonical-1', external_thread_id: 'canonical-1', district_id: 'alpha', platform: 'facebook', headline: 'Registration reminder', canonical_url: 'https://facebook.com/district/posts/123', published_at: '2026-07-01', relationship_type: 'owned', visibility_status: 'active' },
  { id: 'canonical-2', external_thread_id: 'canonical-2', district_id: 'beta', platform: 'instagram', headline: 'Beta social post', canonical_url: 'https://instagram.com/p/beta', published_at: '2026-07-02', relationship_type: 'owned', visibility_status: 'active' },
  { id: 'canonical-cross-district', external_thread_id: 'canonical-cross-district', district_id: 'beta', platform: 'facebook', headline: 'Registration reminder shared with beta', canonical_url: 'https://facebook.com/district/posts/123', published_at: '2026-07-01', relationship_type: 'owned', visibility_status: 'active' },
];

assert.equal(isNewsMediaArticle(articles[0]), true);
assert.equal(isNewsMediaArticle(articles[1]), true, 'manually added News remains eligible');
assert.equal(isNewsMediaArticle(articles[3]), false);

const clientDataset = buildReportingDataset({ articles, socialThreads });
assert.equal(clientDataset.mediaArticles.length, 4, 'News collection excludes all three legacy Social fixtures');
assert.equal(clientDataset.socialResults.length, 3, 'client Social contains canonical Social threads only');
assert.equal(clientDataset.suppressedLegacySocialResults.length, 0, 'client datasets receive no legacy audit evidence');
assert.equal(clientDataset.records.length, 7, 'report totals contain eligible News plus canonical Social only');

const adminDataset = buildReportingDataset({ articles, socialThreads, legacySocialArticles });
assert.equal(adminDataset.mediaArticles.length, clientDataset.mediaArticles.length, 'admin and client News totals use the same eligibility rule');
assert.equal(adminDataset.socialResults.length, clientDataset.socialResults.length, 'legacy evidence never changes Social feed/report totals');
assert.equal(adminDataset.suppressedLegacySocialResults.length, 3, 'admin receives explicitly separated legacy Social audit evidence');
assert.equal(adminDataset.records.length, clientDataset.records.length, 'audit evidence is excluded from combined reporting totals');

const alpha = filterReportingDataset(adminDataset, { districtId: 'alpha' });
assert.deepEqual(alpha.mediaArticles.map((article) => article.id).sort(), ['manual-1', 'news-1', 'web-1']);
assert.equal(alpha.socialResults.length, 1);
assert.equal(alpha.suppressedLegacySocialResults.length, 3);
assert.equal(alpha.records.length, alpha.mediaArticles.length + alpha.socialResults.length);

const beta = filterReportingDataset(adminDataset, { districtId: 'beta' });
assert.equal(beta.socialResults.length, 2, 'cross-district URL deduplication must not hide a district record');
assert.equal(beta.suppressedLegacySocialResults.length, 0);
assert.equal(beta.records.length, beta.mediaArticles.length + beta.socialResults.length, 'normalized record filters remain district-safe');

const campaign = filterReportingDataset(adminDataset, { districtId: 'alpha', campaignSearch: 'registration' });
assert.deepEqual(campaign.mediaArticles.map((article) => article.id), ['news-1']);
assert.deepEqual(campaign.socialResults.map((result) => result.id), ['canonical-1']);
assert.equal(campaign.suppressedLegacySocialResults.length, 1);
assert.equal(campaign.records.length, 2, 'CSV/PDF/report inputs receive one eligible News row and one canonical Social row');

const noteUpdated = buildReportingDataset({
  articles: articles.map((article) => article.id === 'web-1' ? { ...article, notes: 'Enrollment campaign follow-up' } : article),
  socialThreads,
  legacySocialArticles,
});
assert.deepEqual(
  filterReportingDataset(noteUpdated, { districtId: 'alpha', campaignSearch: 'enrollment' }).mediaArticles.map((article) => article.id),
  ['web-1'],
  'resolved analyst note text participates in central campaign membership',
);

console.log('Central News/Social reporting boundary tests passed.');

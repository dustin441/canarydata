import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  isLegacySocialArticle,
  isNewsEligibleArticle,
  normalizeNewsSourceType,
} from '../src/lib/newsEligibility.mjs';

const fixtures = [
  { label: 'normal News', article: { source_type: 'news' }, eligible: true },
  { label: 'manually added News', article: { source_type: 'manual', manual_override: true }, eligible: true },
  { label: 'legacy Instagram', article: { source_type: 'instagram' }, eligible: false },
  { label: 'legacy TikTok', article: { source_type: 'tiktok' }, eligible: false },
  { label: 'legacy Facebook', article: { source_type: 'facebook' }, eligible: false },
  { label: 'legacy X/Twitter', article: { source_type: ' X/Twitter ' }, eligible: false },
  { label: 'generic Social', article: { source_type: 'SOCIAL' }, eligible: false },
];
for (const fixture of fixtures) {
  assert.equal(isNewsEligibleArticle(fixture.article), fixture.eligible, fixture.label);
  assert.equal(isLegacySocialArticle(fixture.article), !fixture.eligible, `${fixture.label} inverse Social classification`);
}
assert.equal(normalizeNewsSourceType('  Social   Media '), 'social media');
assert.equal(isNewsEligibleArticle({ source_type: null }), true, 'unknown legacy News types remain eligible instead of requiring source_type=news');

const [dataSource, dashboardPage, dashboardClient, melodiRoute] = await Promise.all([
  readFile(new URL('../src/lib/data.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/dashboard/page.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/dashboard/DashboardClient.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/api/melodi/route.js', import.meta.url), 'utf8'),
]);
assert.match(dataSource, /predicate: isNewsEligibleArticle/, 'News data loader must apply the central predicate');
assert.match(dataSource, /getLegacySocialAuditArticles[\s\S]*predicate: isLegacySocialArticle/, 'legacy evidence must have a separate loader');
assert.match(dashboardPage, /isAdmin \? loadDashboardDataset\('Legacy Social audit evidence'/, 'legacy evidence must be admin-gated server-side');
assert.match(dashboardClient, /legacySocialArticles: legacySocialAuditArticles/, 'admin evidence must use the explicit audit input');
assert.match(dashboardClient, /filtered\.map\(\(article\) => articleCsvRow/, 'News CSV must use the eligible filtered dataset');
assert.match(dashboardClient, /mediaArticles=\{chartArticles\}/, 'board/PDF report must use the eligible News dataset');
assert.match(melodiRoute, /getArticles\(districtId, \{ limit: 120 \}\)/, 'MELODI must use the central News loader');
assert.doesNotMatch(melodiRoute, /from\('news_stories'\)/, 'MELODI must not bypass central News eligibility');

console.log('News eligibility and consumer wiring tests passed.');

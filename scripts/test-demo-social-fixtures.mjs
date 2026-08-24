import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildDemoSocialData, findDemoSocialPost } from '../src/lib/demo-social-data.mjs';
import { OWNED_DEMO_SOCIAL_FIXTURES } from '../src/lib/demo-social-fixture-source.mjs';
import { buildSocialResults, safeSocialMediaUrl, safeSocialUrl } from '../src/lib/social.mjs';
import { rankSocialReportTopPerformers, resolveSocialReportComparisonWindow, resolveSocialReportWindow } from '../src/lib/socialReport.mjs';
import { buildSocialPerformanceFromDailySeries } from '../src/lib/socialPerformance.mjs';
import { buildReportingDataset, isNewsMediaArticle } from '../src/lib/reportingDataset.mjs';
import { demoArticles, demoSocialSources } from '../src/lib/demo-data.js';

const DAY_MS = 86_400_000;
const DISTRICT_ID = 'canary-falls-usd';
const fixedAsOf = '2026-08-24T10:00:00.000Z';
const shiftedAsOf = '2026-09-10T10:00:00.000Z';
const fixed = buildDemoSocialData(fixedAsOf);
const shifted = buildDemoSocialData(shiftedAsOf);
const demoPageSource = await readFile(new URL('../src/app/demo/page.js', import.meta.url), 'utf8');
const threads = fixed.socialThreads;
const owned = threads.filter((post) => post.relationship_type === 'owned');
const publicPosts = threads.filter((post) => post.relationship_type === 'ambient');
const reportingDataset = buildReportingDataset({
  articles: demoArticles.filter(isNewsMediaArticle),
  socialThreads: threads,
  socialSources: demoSocialSources,
});

assert.equal(threads.length, 27, 'Demo Social must contain exactly 27 unique fixtures.');
assert.equal(new Set(threads.map((post) => post.id)).size, 27, 'Fixture IDs must remain unique.');
assert.equal(new Set(threads.map((post) => post.external_thread_id)).size, 27, 'Provider post IDs must remain unique.');
assert.equal(owned.length, 16, 'Our Social must contain 16 owned posts.');
assert.equal(publicPosts.length, 11, 'Public Conversation must contain 11 posts.');
assert.equal(publicPosts.filter((post) => post.media_url).length, 9, 'Public Conversation must contain 9 image posts.');
assert.equal(publicPosts.filter((post) => post.provider_metadata.is_text_only).length, 2, 'Public Conversation must contain 2 text-only posts.');
assert.equal(reportingDataset.socialResults.length, 27, 'The route must not mix legacy Social fallback rows into Lesley’s fixture package.');
assert.equal(reportingDataset.socialResults.filter((post) => post.relationshipType !== 'owned').length, 11, 'Rendered Public Conversation must remain exactly 11 posts.');
assert.ok(publicPosts.every((post) => post.provider_metadata.action_intelligence), 'Every public fixture must include review-only action intelligence.');
assert.ok(threads.every((post) => post.district_id === DISTRICT_ID && post.provider === 'demo_fixture'), 'Fixtures must remain isolated to the fictional demo district.');
assert.ok(threads.every((post) => post.canonical_url.startsWith('/demo/social/')), 'Every fixture must use an internal fictional demo permalink.');
assert.ok(threads.every((post) => !String(post.canonical_url).includes('DEMO://')), 'Legacy DEMO:// links must not escape into the UI.');
assert.match(demoPageSource, /export const dynamic = ['"]force-dynamic['"]/, 'The demo route must not freeze relative dates in a static build artifact.');

const expectedTopIds = new Set(OWNED_DEMO_SOCIAL_FIXTURES.filter((post) => post.isTopPost).map((post) => post.postId));
assert.equal(expectedTopIds.size, 6, 'The source workbook must designate exactly 6 top posts.');
const normalized = buildSocialResults(threads);
const rankedIds = new Set(rankSocialReportTopPerformers(normalized.filter((post) => post.relationshipType === 'owned'), 6).map((post) => post.externalThreadId));
assert.deepEqual(rankedIds, expectedTopIds, 'Top six must be derived from the owned feed, not imported as duplicate posts.');

const fixedById = new Map(fixed.socialThreads.map((post) => [post.external_thread_id, post]));
const shiftedById = new Map(shifted.socialThreads.map((post) => [post.external_thread_id, post]));
const expectedShift = Date.parse(shifted.reportAsOf) - Date.parse(fixed.reportAsOf);
for (const [postId, post] of fixedById) {
  const moved = shiftedById.get(postId);
  assert.ok(moved, `Shifted dynamic fixture must retain ${postId}.`);
  assert.equal(Date.parse(moved.published_at) - Date.parse(post.published_at), expectedShift, `${postId} must move by the same dynamic date offset.`);
  assert.ok(Date.parse(post.published_at) < Date.parse(fixed.reportAsOf), `${postId} cannot be future-dated.`);
  assert.ok(Date.parse(fixed.reportAsOf) - Date.parse(post.published_at) <= 30 * DAY_MS, `${postId} must remain in the default 30-day report.`);
}
const fixedSequence = [...fixedById.values()].sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at)).map((post) => post.external_thread_id);
const shiftedSequence = [...shiftedById.values()].sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at)).map((post) => post.external_thread_id);
assert.deepEqual(shiftedSequence, fixedSequence, 'Dynamic dating must preserve the full post chronology.');

assert.equal(safeSocialUrl('/demo/social/DEMO-FB-001'), '/demo/social/DEMO-FB-001');
assert.equal(safeSocialUrl('/demo/social/../../api/private'), null, 'Demo permalinks must reject traversal.');
assert.equal(safeSocialUrl('javascript:alert(1)'), null);
assert.equal(safeSocialMediaUrl('/demo-social/fb-001-canary-guides.webp'), '/demo-social/fb-001-canary-guides.webp');
assert.equal(safeSocialMediaUrl('/demo-social/../../secrets.env'), '', 'Demo media must reject traversal.');
assert.equal(safeSocialMediaUrl('/demo-social/unsafe.svg'), '', 'Demo media must reject active SVG content.');

for (const post of threads.filter((item) => item.media_url)) {
  assert.equal(safeSocialMediaUrl(post.media_url), post.media_url, `${post.external_thread_id} must have a safe local image URL.`);
  const assetPath = fileURLToPath(new URL(`../public${post.media_url}`, import.meta.url));
  await access(assetPath);
}

const summary = fixed.socialAccountMetricSummaries[DISTRICT_ID];
assert.equal(summary.platformCount, 2);
assert.equal(summary.accountCount, 2);
assert.ok(summary.accounts.every((account) => account.platform && account.accountHandle));
const history = fixed.socialPerformanceHistory[DISTRICT_ID];
assert.equal(history.length, 300, 'Demo history must contain 60 complete days across five platform metrics.');
const currentWindow = resolveSocialReportWindow('last-30-days', Date.parse(fixed.reportAsOf));
const comparisonWindow = resolveSocialReportComparisonWindow('last-30-days', Date.parse(fixed.reportAsOf));
const performance = buildSocialPerformanceFromDailySeries(history, { currentWindow, comparisonWindow });
assert.notEqual(performance.overallStatus, 'insufficient_history', 'Dynamic demo history must support a real current-vs-prior decision.');
assert.ok(performance.accounts.every((account) => Object.values(account.dimensions).some((dimension) => dimension.status !== 'insufficient_history')));

assert.equal(findDemoSocialPost('DEMO-FB-001', fixedAsOf)?.external_thread_id, 'DEMO-FB-001');
assert.equal(findDemoSocialPost('missing-post', fixedAsOf), null);

console.log('Demo Social fixture checks passed: 27 unique posts, dynamic chronology, safe local assets, two-platform metrics, and complete trend history.');

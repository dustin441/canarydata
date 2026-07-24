import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeSocialResult } from '../src/lib/social.mjs';
import {
  resolveSocialReportWindow,
  groupTopReportPostsByPlatform,
  isEligibleSocialReportPost,
  metricAvailabilityCoverage,
  rankSocialReportTopPerformers,
  selectOfficialSocialReportPosts,
  sortSocialReportDetails,
  summarizeSocialReport,
} from '../src/lib/socialReport.mjs';

const reviewed = normalizeSocialResult({
  id: 'thread-review-1',
  provider: 'apify',
  platform: 'facebook',
  social_account_id: '22222222-2222-2222-2222-222222222222',
  external_thread_id: 'official-1',
  relationship_type: 'owned',
  visibility_status: 'approved',
  reviewer_note: '**Safe official post.**',
  review_version: 4,
  reviewed_at: '2026-07-23T12:00:00Z',
  reviewed_by: '11111111-1111-1111-1111-111111111111',
});
assert.equal(reviewed.visibilityStatus, 'approved');
assert.equal(reviewed.reviewerNote, 'Safe official post.');
assert.equal(reviewed.reviewVersion, 4);
assert.equal(reviewed.reviewedAt, '2026-07-23T12:00:00Z');
assert.equal(reviewed.socialAccountId, '22222222-2222-2222-2222-222222222222');

const providerWithoutAvailability = normalizeSocialResult({
  id: 'no-metric-contract', provider: 'apify', platform: 'facebook',
  reaction_count: 0, comment_count: 0, share_count: 0, view_count: 0,
});
assert.deepEqual(providerWithoutAvailability.metricAvailability, {
  reactions: false, comments: false, shares: false, views: false,
});

const schoolYearAfterBoundary = resolveSocialReportWindow('school-year', Date.UTC(2026, 6, 24));
assert.equal(schoolYearAfterBoundary.startInput, '2026-07-15');
const schoolYearBeforeBoundary = resolveSocialReportWindow('school-year', Date.UTC(2026, 6, 14));
assert.equal(schoolYearBeforeBoundary.startInput, '2025-07-15');

const reportWindow = {
  start: new Date('2026-07-01T00:00:00.000Z'),
  end: new Date('2026-07-31T23:59:59.999Z'),
};
const reportPosts = [
  {
    id: 'fb-high', platform: 'facebook', date: '2026-07-20T12:00:00Z', visibilityStatus: 'active', relationshipType: 'owned',
    reactionCount: 22, commentCount: 2, shareCount: 1, viewCount: 100,
    metricAvailability: { reactions: true, comments: true, shares: true, views: true },
  },
  {
    id: 'ig-tie-b', platform: 'instagram', date: '2026-07-21T12:00:00Z', visibilityStatus: 'active', relationshipType: 'owned',
    reactionCount: 8, commentCount: 4, shareCount: 1, viewCount: 0,
    metricAvailability: { reactions: true, comments: true, shares: true, views: false },
  },
  {
    id: 'ig-tie-a', platform: 'instagram', date: '2026-07-21T12:00:00Z', visibilityStatus: 'active', relationshipType: 'owned',
    reactionCount: 12, commentCount: 1, shareCount: 0, viewCount: 50,
    metricAvailability: { reactions: true, comments: true, shares: false, views: true },
  },
  {
    id: 'fb-no-metrics', platform: 'facebook', date: '2026-07-22T12:00:00Z', visibilityStatus: 'active', relationshipType: 'owned',
    reactionCount: 0, commentCount: 0, shareCount: 0, viewCount: 0,
    metricAvailability: { reactions: false, comments: false, shares: false, views: false },
  },
  { id: 'review', platform: 'facebook', date: '2026-07-23T12:00:00Z', visibilityStatus: 'review', relationshipType: 'owned', metricAvailability: {} },
  { id: 'mention', platform: 'facebook', date: '2026-07-23T12:00:00Z', visibilityStatus: 'active', relationshipType: 'direct', metricAvailability: {} },
  { id: 'outside', platform: 'facebook', date: '2026-06-30T23:59:59Z', visibilityStatus: 'active', relationshipType: 'owned', metricAvailability: {} },
];

assert.equal(isEligibleSocialReportPost(reportPosts[0], reportWindow), true);
assert.equal(isEligibleSocialReportPost(reportPosts[4], reportWindow), false);
assert.equal(isEligibleSocialReportPost(reportPosts[5], reportWindow), false);
assert.equal(isEligibleSocialReportPost(reportPosts[6], reportWindow), false);

const eligibleReportPosts = reportPosts.filter((post) => isEligibleSocialReportPost(post, reportWindow));
assert.deepEqual(metricAvailabilityCoverage(eligibleReportPosts, 'views'), { available: 2, total: 4 });
assert.deepEqual(metricAvailabilityCoverage(eligibleReportPosts, 'shares'), { available: 2, total: 4 });
assert.deepEqual(rankSocialReportTopPerformers(eligibleReportPosts, 3).map((post) => post.id), ['fb-high', 'ig-tie-a', 'ig-tie-b']);
assert.deepEqual(sortSocialReportDetails(eligibleReportPosts).map((post) => post.id), ['fb-no-metrics', 'ig-tie-a', 'ig-tie-b', 'fb-high']);

const platformTopPerformers = groupTopReportPostsByPlatform([
  ...Array.from({ length: 5 }, (_, index) => ({
    id: `fb-${index}`,
    platform: 'facebook',
    date: `2026-07-${String(16 + index).padStart(2, '0')}T12:00:00Z`,
    visibilityStatus: 'active',
    relationshipType: 'owned',
    reactionCount: 100 - index,
    metricAvailability: { reactions: true },
  })),
  ...Array.from({ length: 4 }, (_, index) => ({
    id: `ig-${index}`,
    platform: 'instagram',
    date: `2026-07-${String(16 + index).padStart(2, '0')}T12:00:00Z`,
    visibilityStatus: 'active',
    relationshipType: 'owned',
    reactionCount: 20 - index,
    metricAvailability: { reactions: true },
  })),
]);
assert.deepEqual(platformTopPerformers.map(({ platform, posts }) => [platform, posts.map((post) => post.id)]), [
  ['facebook', ['fb-0', 'fb-1', 'fb-2']],
  ['instagram', ['ig-0', 'ig-1', 'ig-2']],
]);

const reportSummary = summarizeSocialReport(eligibleReportPosts);
assert.equal(reportSummary.officialPosts, 4);
assert.equal(reportSummary.totalInteractions, 51);
assert.equal(reportSummary.interactionsAvailable, 3);
assert.equal(reportSummary.averageInteractions, 17);
assert.equal(reportSummary.reportedViews, 150);
assert.deepEqual(reportSummary.viewsCoverage, { available: 2, total: 4 });
assert.deepEqual(reportSummary.reactionsCoverage, { available: 3, total: 4 });
assert.deepEqual(reportSummary.commentsCoverage, { available: 3, total: 4 });
assert.deepEqual(reportSummary.sharesCoverage, { available: 2, total: 4 });
assert.deepEqual(reportSummary.platformBreakdown, [
  { platform: 'facebook', count: 2 },
  { platform: 'instagram', count: 2 },
]);
assert.equal(reportSummary.topPlatform, 'facebook');
const unavailableSummary = summarizeSocialReport([eligibleReportPosts.find((post) => post.id === 'fb-no-metrics')]);
assert.equal(unavailableSummary.totalInteractions, null);
assert.equal(unavailableSummary.averageInteractions, null);
assert.equal(unavailableSummary.reportedViews, null);

const officialSources = [
  { id: 'official-fb', district_id: 'district-a', platform: 'facebook', active: true, handle: 'districta' },
  { id: 'official-ig', district_id: 'district-a', platform: 'instagram', active: true, profile_url: 'https://instagram.com/districta' },
  { id: 'inactive-ig', district_id: 'district-a', platform: 'instagram', active: false, handle: 'districta' },
  { id: 'anonymous-ig', district_id: 'district-a', platform: 'instagram', active: true, handle: '', profile_url: '' },
];
const officialCandidates = [
  ...reportPosts.slice(0, 4).map((post) => ({ ...post, districtId: 'district-a', socialAccountId: post.platform === 'instagram' ? 'official-ig' : 'official-fb' })),
  { ...reportPosts[0], id: 'wrong-district', districtId: 'district-b', socialAccountId: 'official-fb' },
  { ...reportPosts[0], id: 'wrong-platform', platform: 'instagram', districtId: 'district-a', socialAccountId: 'official-fb' },
  { ...reportPosts[0], id: 'inactive-source', platform: 'instagram', districtId: 'district-a', socialAccountId: 'inactive-ig' },
  { ...reportPosts[0], id: 'anonymous-source', platform: 'instagram', districtId: 'district-a', socialAccountId: 'anonymous-ig' },
  { ...reportPosts[6], districtId: 'district-a', socialAccountId: 'official-fb' },
];
assert.deepEqual(
  selectOfficialSocialReportPosts(officialCandidates, officialSources, 'district-a', reportWindow, 3).map((post) => post.id),
  ['fb-high', 'ig-tie-a', 'ig-tie-b'],
);

const [sql, actions, dashboard, styles, data, melodi] = await Promise.all([
  readFile(new URL('../supabase/social_review_workflow.sql', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/actions.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/dashboard/DashboardClient.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/globals.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/data.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/api/melodi/route.js', import.meta.url), 'utf8'),
]);

assert.match(sql, /visibility_status in \('review', 'approved', 'active', 'excluded'\)/);
assert.match(sql, /social_review_events_immutable/);
assert.match(sql, /before_state jsonb not null/);
assert.match(sql, /after_state jsonb not null/);
assert.match(sql, /relationship_type = 'owned'[\s\S]*visibility_status in \('review', 'approved'\)/);
assert.match(sql, /set visibility_status = 'active'/);
assert.match(sql, /canary_assert_social_reviewer/);
assert.match(sql, /raw_app_meta_data ->> 'role'/);
assert.match(sql, /account\.id = social_threads\.social_account_id/);
assert.match(sql, /account\.active = true/);
assert.match(sql, /revoke all on function public\.canary_review_social_thread[\s\S]*from public, anon, authenticated/);
assert.match(sql, /revoke all on function public\.canary_bulk_review_social_threads[\s\S]*from public, anon, authenticated/);

assert.match(actions, /function assertCanaryReviewer/);
assert.match(actions, /if \(!actor\.isAdmin\)/);
assert.match(actions, /Selection contains missing or cross-district social results/);
assert.match(actions, /Bulk approval is limited to verified official district posts awaiting client approval/);
assert.match(actions, /runReviewAction\('promote', current\.review_version\)/);
assert.match(actions, /runBulkAction\('promote', promotionIds\)/);
assert.match(actions, /\.select\('visibility_status, review_version'\)/);
assert.match(actions, /expectedCurrentVersion/);
assert.match(sql, /p_action not in \('approve', 'promote'/);
assert.match(sql, /p_action not in \('approve_official', 'promote'\)/);
assert.doesNotMatch(actions, /Only approved results can be promoted/);
for (const marker of ['Approve for client and reports', 'not yet client-visible or included in reports', 'Select eligible official posts', 'Review audit history', 'Compact list']) {
  assert.ok(dashboard.includes(marker), `Dashboard must include ${marker}`);
}
assert.doesNotMatch(dashboard, /Promote to client|Promote approved batch|Approved internally/);

const socialReportSource = dashboard.slice(dashboard.indexOf('function SocialReportThumbnail'), dashboard.indexOf('function BoardReportView'));
for (const marker of [
  'Social Media Performance Report',
  'Executive scorecards',
  'Official posts published',
  'Total public interactions',
  'Average reported interactions',
  'Reported views',
  'Available for',
  'Top Performers',
  'Official Post Detail',
  'Not available',
]) {
  assert.ok(socialReportSource.includes(marker), `Social Report must include ${marker}`);
}
assert.match(socialReportSource, /safeSocialUrl\(result\.url\)/);
assert.match(socialReportSource, /socialReportInteractionTotal\(result\)/);
assert.match(socialReportSource, /ranked \? 'Rank' : 'Row'/);
assert.match(socialReportSource, /topPerformerGroups\.map/);
assert.match(socialReportSource, /<SocialReportTable results=\{group\.posts\} ranked \/>/);
assert.doesNotMatch(socialReportSource, /news|evidence appendix|Strategic Alignment/i);
assert.match(dashboard, /function SocialReportView/);
assert.match(dashboard, /visibleResults\.filter\(\(result\) => isEligibleSocialReportPost\(result, topPostsWindow\)[\s\S]*verifiedOfficialSourceKeys\.has/);
assert.match(dashboard, /reportPeriod = `\$\{topPostsWindow\.label\}/);
assert.match(dashboard, /Choose one district before exporting a Social Report/);
assert.match(dashboard, /Minimum engagement rate:/);
assert.match(dashboard, /Feed dates:/);
assert.match(dashboard, /setSocialReportMode\(true\)/);
assert.doesNotMatch(dashboard, /function exportSocialPdf\(\)[\s\S]{0,250}setCurrentView\('dashboard'\)/);
assert.match(dashboard, /source\.id === result\.socialAccountId/);
assert.match(dashboard, /source\.active === true/);
assert.match(dashboard, /const SHOW_GLOBAL_BOARD_REPORT_EXPORT = false/);
assert.match(dashboard, /SHOW_GLOBAL_BOARD_REPORT_EXPORT && \['dashboard', 'birdseye', 'social'\]/);
assert.match(dashboard, /Export Leadership \/ Board PDF/);
assert.doesNotMatch(dashboard, /⬇ Export PDF[\s\S]{0,180}Tabloid landscape works best/);
assert.doesNotMatch(dashboard, /function handleExportPdf/);
assert.match(dashboard, /function BirdEyeView\(\{[\s\S]*districtId[\s\S]*districtName[\s\S]*socialThreads[\s\S]*socialSources/);
assert.match(dashboard, /selectOfficialSocialReportPosts\([\s\S]*socialThreads[\s\S]*socialSources[\s\S]*districtId[\s\S]*reportWindow[\s\S]*3/);
assert.match(dashboard, /Top 3 official social posts/);
assert.match(dashboard, /socialReportPosts\.map\(\(result, index\)/);
assert.match(dashboard, /canary-social-performance-/);
assert.match(dashboard, /socialReportPosts\.map\(\(result\) => socialCsvRow/);
assert.match(dashboard, /<SocialReportMetric result=\{result\} metric="reactions"/);
const socialReportCardSource = dashboard.slice(dashboard.indexOf('function SocialReportCard'), dashboard.indexOf('function SocialReportThumbnail'));
for (const metric of ['reactions', 'comments', 'shares']) {
  assert.ok(socialReportCardSource.includes(`metric="${metric}"`), `Board social cards must honor ${metric} availability`);
}
assert.match(socialReportCardSource, /socialReportInteractionTotal\(result\) === null \? 'Not available'/);
assert.match(styles, /\.social-report-mode > \*:not\(\.social-report\)/);
assert.match(styles, /\.social-report-mode \.social-report/);
assert.match(styles, /\.social-report-table thead \{ display: table-header-group; \}/);
assert.match(styles, /\.social-report-thumbnail img[\s\S]*object-fit: contain/);
assert.match(styles, /\.social-report-table th,[\s\S]*overflow-wrap: anywhere/);
assert.doesNotMatch(styles, /\.social-report-grid/);
assert.match(styles, /input\[type="date"\][\s\S]*color-scheme: dark/);
assert.match(styles, /\.birdseye-report-controls[\s\S]*display: none !important/);
assert.match(styles, /\.birdseye-evidence-page[\s\S]*break-before: page/);
assert.match(styles, /\.birdseye-evidence-table thead[\s\S]*display: table-header-group/);
assert.match(styles, /\.board-report-social \.social-report-media img[\s\S]*object-fit: contain/);
assert.match(dashboard, /!listCompact && \(/);
assert.match(data, /includeReview \? \['active', 'approved', 'review', 'excluded'\] : \['active'\]/);
assert.match(data, /export async function getSocialReviewEvents/);
assert.match(melodi, /isAdmin \? \['active', 'approved', 'review'\] : \['active'\]/);

console.log('Social review workflow tests passed.');

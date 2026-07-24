import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeSocialResult } from '../src/lib/social.mjs';
import { resolveSocialReportWindow, groupTopReportPostsByPlatform } from '../src/lib/socialReport.mjs';

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

const schoolYearAfterBoundary = resolveSocialReportWindow('school-year', Date.UTC(2026, 6, 24));
assert.equal(schoolYearAfterBoundary.startInput, '2026-07-15');
const schoolYearBeforeBoundary = resolveSocialReportWindow('school-year', Date.UTC(2026, 6, 14));
assert.equal(schoolYearBeforeBoundary.startInput, '2025-07-15');

const reportGroups = groupTopReportPostsByPlatform([
  ...Array.from({ length: 4 }, (_, index) => ({ id: `fb-${index}`, platform: 'facebook', engagementTotal: 10 - index, visibilityStatus: 'active', relationshipType: 'owned' })),
  { id: 'ig-active', platform: 'instagram', engagementTotal: 8, visibilityStatus: 'active', relationshipType: 'owned' },
  { id: 'ig-review', platform: 'instagram', engagementTotal: 99, visibilityStatus: 'review', relationshipType: 'owned' },
  { id: 'fb-mention', platform: 'facebook', engagementTotal: 100, visibilityStatus: 'active', relationshipType: 'direct' },
]);
assert.deepEqual(reportGroups.map((group) => [group.platform, group.posts.map((post) => post.id)]), [
  ['facebook', ['fb-0', 'fb-1', 'fb-2']],
  ['instagram', ['ig-active']],
]);

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
assert.doesNotMatch(actions, /Only approved results can be promoted/);

for (const marker of [
  'Approve for client and reports',
  'not yet client-visible or included in reports',
  'Select eligible official posts',
  'Review audit history',
  'Compact list',
  'social-report-mode',
  'Social Report',
  'Report period',
  'Filter context',
  'No safe thumbnail available',
  'View source',
]) {
  assert.ok(dashboard.includes(marker), `Dashboard must include ${marker}`);
}
assert.doesNotMatch(dashboard, /Promote to client|Promote approved batch|Approved internally/);
assert.match(dashboard, /function SocialReportView/);
assert.match(dashboard, /groupTopReportPostsByPlatform\(visibleResults\.filter/);
assert.match(dashboard, /reportPeriod = `\$\{topPostsWindow\.label\}/);
assert.match(dashboard, /setSocialReportMode\(true\)/);
assert.doesNotMatch(dashboard, /function exportSocialPdf\(\)[\s\S]{0,250}setCurrentView\('dashboard'\)/);
assert.match(dashboard, /source\.id === result\.socialAccountId/);
assert.match(dashboard, /source\.active === true/);
assert.match(styles, /\.social-report-mode > \*:not\(\.social-report\)/);
assert.match(styles, /\.social-report-mode \.social-report/);
assert.match(styles, /\.social-report-media img/);
assert.match(styles, /input\[type="date"\][\s\S]*color-scheme: dark/);
assert.match(dashboard, /!listCompact && \(/);
assert.match(data, /includeReview \? \['active', 'approved', 'review', 'excluded'\] : \['active'\]/);
assert.match(data, /export async function getSocialReviewEvents/);
assert.match(melodi, /isAdmin \? \['active', 'approved', 'review'\] : \['active'\]/);

console.log('Social review workflow tests passed.');

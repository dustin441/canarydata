import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeSocialResult } from '../src/lib/social.mjs';

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

const [sql, actions, dashboard, data, melodi] = await Promise.all([
  readFile(new URL('../supabase/social_review_workflow.sql', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/actions.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/dashboard/DashboardClient.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/data.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/api/melodi/route.js', import.meta.url), 'utf8'),
]);

assert.match(sql, /visibility_status in \('review', 'approved', 'active', 'excluded'\)/);
assert.match(sql, /social_review_events_immutable/);
assert.match(sql, /before_state jsonb not null/);
assert.match(sql, /after_state jsonb not null/);
assert.match(sql, /relationship_type = 'owned'[\s\S]*visibility_status = 'review'/);
assert.match(sql, /visibility_status = 'approved'/);
assert.match(sql, /canary_assert_social_reviewer/);
assert.match(sql, /raw_app_meta_data ->> 'role'/);
assert.match(sql, /account\.id = social_threads\.social_account_id/);
assert.match(sql, /account\.active = true/);
assert.match(sql, /revoke all on function public\.canary_review_social_thread[\s\S]*from public, anon, authenticated/);
assert.match(sql, /revoke all on function public\.canary_bulk_review_social_threads[\s\S]*from public, anon, authenticated/);

assert.match(actions, /function assertCanaryReviewer/);
assert.match(actions, /if \(!actor\.isAdmin\)/);
assert.match(actions, /Selection contains missing or cross-district social results/);
assert.match(actions, /Bulk approval is limited to official district posts awaiting review/);
assert.match(actions, /Only approved results can be promoted/);

for (const marker of [
  'Approve',
  'Exclude',
  'Save classification',
  'Save note',
  'Approve official batch',
  'Promote approved batch',
  'Review audit history',
  'Compact list',
]) {
  assert.ok(dashboard.includes(marker), `Dashboard must include ${marker}`);
}
assert.match(dashboard, /!listCompact && \(/);
assert.match(data, /includeReview \? \['active', 'approved', 'review', 'excluded'\] : \['active'\]/);
assert.match(data, /export async function getSocialReviewEvents/);
assert.match(melodi, /isAdmin \? \['active', 'approved', 'review'\] : \['active'\]/);

console.log('Social review workflow tests passed.');

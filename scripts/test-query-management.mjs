import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CUSTOMER_SEARCH_QUERY_LIMIT,
  activeNewsQueryCount,
  applySearchQuerySnapshotFilters,
  buildSearchQueryUpdate,
  estimatedMonthlySearches,
  hasActiveSearchQueryDuplicate,
  normalizeSearchQueryText,
  reconcileActiveSearchQueryWrite,
  searchQueryFingerprint,
  searchQuerySnapshot,
  validateSearchQueryText,
  validateCustomerSearchQueryText,
} from '../src/lib/queryPolicy.mjs';
import { buildQueryReviewTask } from '../src/lib/clickup.js';

assert.equal(CUSTOMER_SEARCH_QUERY_LIMIT, 10);
assert.equal(normalizeSearchQueryText('  Santa   Clara   schools  '), 'Santa Clara schools');
assert.equal(searchQueryFingerprint(' Santa CLARA Schools '), 'santa clara schools');
assert.equal(validateSearchQueryText('  Hoover school board  '), 'Hoover school board');
assert.throws(() => validateSearchQueryText('***'), /letter or number/);
assert.throws(() => validateSearchQueryText('ab'), /at least 3 characters/);
assert.throws(() => validateSearchQueryText('x'.repeat(201)), /200 characters or fewer/);
assert.equal(validateCustomerSearchQueryText('"Hoover City Schools" budget'), '"Hoover City Schools" budget');
assert.equal(validateCustomerSearchQueryText('site:hoovercityschools.net budget'), 'site:hoovercityschools.net budget');
assert.throws(() => validateCustomerSearchQueryText('"District A" OR "District B"'), /one school, district, person, program, or topic/);
assert.throws(() => validateCustomerSearchQueryText('(Hoover schools) budget'), /Compound Boolean queries/);
assert.throws(() => validateCustomerSearchQueryText('site:example.org site:example.com budget'), /no more than one site/);
assert.throws(() => validateCustomerSearchQueryText('"Hoover" "budget"'), /one complete quoted phrase/);
assert.equal(activeNewsQueryCount([
  { channels: 'news', active: true },
  { channels: 'news', active: false },
  { channels: 'social', active: true },
  { channels: 'news' },
]), 2);
assert.equal(estimatedMonthlySearches(10), 150);

const reviewTask = buildQueryReviewTask({
  action: 'update',
  district_id: 'district-a',
  district_name: 'District A',
  query_id: 'query-1',
  request_id: 'request-1',
  created_at: '2026-07-28T00:00:00Z',
  before: { query_text: 'District A board', channels: 'news', active: true },
  after: { query_text: 'District A budget', channels: 'news', active: true, geo_city: 'Canary Falls' },
});
assert.match(reviewTask.name, /^\[Query activation review\] District A: update/);
assert.deepEqual(reviewTask.tags, ['query-review', 'customer-request', 'canary-data']);
assert.match(reviewTask.markdown_content, /does not modify generated_queries or canonical ingestion automatically/);
assert.match(reviewTask.markdown_content, /Run a controlled ingestion/);

const activeNewsQuery = {
  id: 'query-1',
  district_id: 'district-a',
  district_name: 'District A',
  query_text: 'District A board',
  channels: 'news',
  geo_city: 'Canary Falls',
  geo_state: 'AL',
  geo_zip: '35000',
  active: true,
};
const customerActor = { isAdmin: false, districtId: 'district-a' };

assert.deepEqual(
  buildSearchQueryUpdate({
    actor: customerActor,
    existingQuery: activeNewsQuery,
    changes: {
      query_text: '  District A   budget  ',
      district_id: 'district-a',
      channels: 'news',
      geo_city: 'New Canary Falls',
      geo_state: 'Alabama',
      geo_zip: '35001',
    },
  }),
  {
    query_text: 'District A budget',
    channels: 'news',
    geo_city: 'New Canary Falls',
    geo_state: 'Alabama',
    geo_zip: '35001',
  },
);
assert.throws(() => buildSearchQueryUpdate({
  actor: customerActor,
  existingQuery: { ...activeNewsQuery, district_id: 'district-b' },
  changes: { query_text: 'District B budget' },
}), /access to this district/);
assert.throws(() => buildSearchQueryUpdate({
  actor: customerActor,
  existingQuery: { ...activeNewsQuery, active: false },
  changes: { query_text: 'District A budget' },
}), /active news queries/);
assert.throws(() => buildSearchQueryUpdate({
  actor: customerActor,
  existingQuery: { ...activeNewsQuery, active: null },
  changes: { query_text: 'District A budget' },
}), /active news queries/);
assert.throws(() => buildSearchQueryUpdate({
  actor: customerActor,
  existingQuery: { ...activeNewsQuery, channels: 'social' },
  changes: { query_text: 'District A budget' },
}), /active news queries/);
assert.throws(() => buildSearchQueryUpdate({
  actor: customerActor,
  existingQuery: activeNewsQuery,
  changes: { query_text: 'District A budget', district_id: 'district-b' },
}), /cannot be moved/);
assert.throws(() => buildSearchQueryUpdate({
  actor: customerActor,
  existingQuery: activeNewsQuery,
  changes: { query_text: 'District A budget', channels: 'social' },
}), /channel cannot be changed/);
assert.equal(hasActiveSearchQueryDuplicate([
  activeNewsQuery,
  { id: 'query-2', district_id: 'district-a', query_text: ' district a BUDGET ', channels: 'news', active: true },
], { id: 'query-1', query_text: 'District A budget', channels: 'news' }), true);
assert.equal(hasActiveSearchQueryDuplicate([
  activeNewsQuery,
  { id: 'query-2', district_id: 'district-a', query_text: 'District A budget', channels: 'news', active: false },
], { id: 'query-1', query_text: 'District A budget', channels: 'news' }), false);
assert.deepEqual(buildSearchQueryUpdate({
  actor: { isAdmin: true, districtId: null },
  existingQuery: activeNewsQuery,
  changes: { query_text: 'District A social', channels: 'social', geo_city: '', geo_state: '', geo_zip: '' },
}), {
  query_text: 'District A social',
  channels: 'social',
  geo_city: '',
  geo_state: '',
  geo_zip: '',
});
assert.throws(() => buildSearchQueryUpdate({
  actor: { isAdmin: true, districtId: null },
  existingQuery: activeNewsQuery,
  changes: { query_text: 'District B board', district_id: 'district-b' },
}), /cannot be moved/);

const nullableSnapshot = searchQuerySnapshot({
  ...activeNewsQuery,
  geo_city: null,
  geo_state: '',
  geo_zip: null,
});
assert.deepEqual(nullableSnapshot, {
  query_text: 'District A board',
  channels: 'news',
  active: true,
  geo_city: null,
  geo_state: '',
  geo_zip: null,
});
const filterCalls = [];
const fakeFilter = {
  eq(column, value) { filterCalls.push(['eq', column, value]); return this; },
  is(column, value) { filterCalls.push(['is', column, value]); return this; },
};
assert.equal(applySearchQuerySnapshotFilters(fakeFilter, nullableSnapshot), fakeFilter);
assert.deepEqual(filterCalls, [
  ['eq', 'query_text', 'District A board'],
  ['eq', 'channels', 'news'],
  ['eq', 'active', true],
  ['is', 'geo_city', null],
  ['eq', 'geo_state', ''],
  ['is', 'geo_zip', null],
]);
assert.throws(() => searchQuerySnapshot({ query_text: 'incomplete' }), /original query values/i);

async function reconcileAgainstRows({ rows, writtenQuery, rollbackValues }) {
  return reconcileActiveSearchQueryWrite({
    writtenQuery,
    loadDistrictQueries: async () => [...rows.values()].map((row) => ({ ...row })),
    undoWrittenQuery: async (expectedWrite) => {
      const current = rows.get(writtenQuery.id);
      if (!current || Object.entries(expectedWrite).some(([key, value]) => current[key] !== value)) return false;
      rows.set(writtenQuery.id, { ...current, ...rollbackValues });
      return true;
    },
  });
}

// A later add must deactivate itself if an earlier racing add has already become active.
const addRaceRows = new Map();
const firstAdd = { ...activeNewsQuery, id: 'add-1', query_text: 'District A growth' };
const secondAdd = { ...firstAdd, id: 'add-2' };
addRaceRows.set(firstAdd.id, firstAdd);
assert.deepEqual(await reconcileAgainstRows({ rows: addRaceRows, writtenQuery: firstAdd, rollbackValues: { active: false } }), {
  duplicate: false,
  reconciled: false,
});
addRaceRows.set(secondAdd.id, secondAdd);
assert.deepEqual(await reconcileAgainstRows({ rows: addRaceRows, writtenQuery: secondAdd, rollbackValues: { active: false } }), {
  duplicate: true,
  reconciled: true,
});
assert.equal(addRaceRows.get(firstAdd.id).active, true);
assert.equal(addRaceRows.get(secondAdd.id).active, false);

// If two edits both commit before reconciliation, each safely rolls back only its own exact write.
const editRaceRows = new Map([
  ['edit-1', { ...activeNewsQuery, id: 'edit-1', query_text: 'Shared race target', geo_city: null }],
  ['edit-2', { ...activeNewsQuery, id: 'edit-2', query_text: 'Shared race target', geo_city: null }],
]);
const [firstEditResult, secondEditResult] = await Promise.all([
  reconcileAgainstRows({ rows: editRaceRows, writtenQuery: editRaceRows.get('edit-1'), rollbackValues: { query_text: 'Original one' } }),
  reconcileAgainstRows({ rows: editRaceRows, writtenQuery: editRaceRows.get('edit-2'), rollbackValues: { query_text: 'Original two' } }),
]);
assert.equal(firstEditResult.duplicate, true);
assert.equal(secondEditResult.duplicate, true);
assert.equal(hasActiveSearchQueryDuplicate([...editRaceRows.values()], editRaceRows.get('edit-1')), false);

// An edit/add race cannot leave both writes active, regardless of which request reconciles first.
const editAddRaceRows = new Map([
  ['edit-5', { ...activeNewsQuery, id: 'edit-5', query_text: 'Edit add target' }],
  ['add-5', { ...activeNewsQuery, id: 'add-5', query_text: 'Edit add target' }],
]);
const [editAddEditResult, editAddAddResult] = await Promise.all([
  reconcileAgainstRows({ rows: editAddRaceRows, writtenQuery: editAddRaceRows.get('edit-5'), rollbackValues: { query_text: 'Edit original' } }),
  reconcileAgainstRows({ rows: editAddRaceRows, writtenQuery: editAddRaceRows.get('add-5'), rollbackValues: { active: false } }),
]);
assert.equal(editAddEditResult.duplicate, true);
assert.equal(editAddAddResult.duplicate, true);
assert.equal(hasActiveSearchQueryDuplicate([...editAddRaceRows.values()], editAddRaceRows.get('edit-5')), false);

// A guard miss never overwrites a newer edit and produces a retryable reconciliation failure.
const guardMissRows = new Map([
  ['edit-3', { ...activeNewsQuery, id: 'edit-3', query_text: 'Newer value' }],
  ['edit-4', { ...activeNewsQuery, id: 'edit-4', query_text: 'Duplicate value' }],
]);
const guardMissResult = await reconcileAgainstRows({
  rows: guardMissRows,
  writtenQuery: { ...guardMissRows.get('edit-3'), query_text: 'Duplicate value' },
  rollbackValues: { query_text: 'Original three' },
});
assert.deepEqual(guardMissResult, { duplicate: true, reconciled: false });
assert.equal(guardMissRows.get('edit-3').query_text, 'Newer value');

// A rollback can collide with a third writer that claimed the temporarily free
// original fingerprint. A second reconciliation pass must pause only the
// restored row so the compensation itself cannot leave duplicate monitoring.
const rollbackCollisionRows = new Map([
  ['edit-a', { ...activeNewsQuery, id: 'edit-a', query_text: 'Original fingerprint', active: true }],
  ['edit-b', { ...activeNewsQuery, id: 'edit-b', query_text: 'Original fingerprint', active: true }],
  ['edit-c', { ...activeNewsQuery, id: 'edit-c', query_text: 'Other winner', active: true }],
]);
const rollbackCollision = await reconcileAgainstRows({
  rows: rollbackCollisionRows,
  writtenQuery: rollbackCollisionRows.get('edit-a'),
  rollbackValues: { active: false },
});
assert.deepEqual(rollbackCollision, { duplicate: true, reconciled: true });
assert.equal(rollbackCollisionRows.get('edit-a').active, false);
assert.equal(hasActiveSearchQueryDuplicate(
  [...rollbackCollisionRows.values()],
  rollbackCollisionRows.get('edit-b'),
), false);

const actionsSource = await readFile(new URL('../src/app/actions.js', import.meta.url), 'utf8');
const addAction = actionsSource.slice(actionsSource.indexOf('export async function addQuery'), actionsSource.indexOf('export async function updateQuery'));
const updateAction = actionsSource.slice(actionsSource.indexOf('export async function updateQuery'), actionsSource.indexOf('export async function deleteQuery'));
const deleteAction = actionsSource.slice(actionsSource.indexOf('export async function deleteQuery'), actionsSource.indexOf('export async function submitFeedback'));
assert.equal((addAction.match(/duplicateWriteError/g) || []).length, 4, 'every add/reactivation write path must reconcile duplicates');
assert.equal((addAction.match(/finishSearchQueryMutation/g) || []).length, 4, 'every successful add/reactivation path must create a customer review request');
assert.match(updateAction, /searchQuerySnapshot\(changes\?\.original\)/, 'edits must require the browser original snapshot');
assert.match(updateAction, /applySearchQuerySnapshotFilters\(update, originalSnapshot\)/, 'edits must guard updates with every original mutable value');
assert.match(updateAction, /duplicateWriteError/, 'edits must reconcile duplicates after writing');
assert.match(updateAction, /reconcileRollback:\s*true/, 'edit rollback must receive a second duplicate reconciliation pass');
assert.match(actionsSource, /restoredReconciliation/, 'restored fingerprints must be reconciled before returning');
assert.match(updateAction, /finishSearchQueryMutation\(\{ actor, supabase, data, action: 'update', before: existingQuery, rollbackValues: originalSnapshot \}\)/, 'customer edits must create a canonical activation review with failure compensation');
assert.match(deleteAction, /finishSearchQueryMutation\(\{ actor, supabase, data, action: 'remove', before: query, after: data, rollbackValues: searchQuerySnapshot\(query\) \}\)/, 'customer removals must create a canonical activation review with exact-snapshot failure compensation');
assert.match(deleteAction, /if \(query\.active !== true\) return \{ error:/, 'already-inactive removals must not reactivate a query during compensation');
assert.match(deleteAction, /applySearchQuerySnapshotFilters\(deactivate, searchQuerySnapshot\(query\)\)/, 'removals must use optimistic snapshot guards');
assert.match(actionsSource, /if \(actor\.isAdmin\) return null;/, 'administrator mutations must not create customer review tickets');
assert.match(actionsSource, /`query_review_synced:\$\{task\.id\}`/, 'successful review tasks must be linked without optional feedback schema columns');
assert.doesNotMatch(actionsSource.slice(actionsSource.indexOf('async function queueCustomerQueryReview'), actionsSource.indexOf('async function finishSearchQueryMutation')), /clickup_task_id/, 'query review queuing must work with the production feedback schema');
assert.match(actionsSource, /async function rollbackSearchQueryAfterReviewFailure/);
assert.match(actionsSource, /canonicalReview\?\.status === 'queue_failed'/, 'a query mutation must be compensated when its durable review request cannot be stored');
assert.match(actionsSource, /applySearchQuerySnapshotFilters\(rollback, searchQuerySnapshot\(data\)\)/, 'review-failure compensation must not overwrite a newer concurrent query change');

const feedbackSyncSource = await readFile(new URL('./sync-feedback-to-clickup.mjs', import.meta.url), 'utf8');
assert.match(feedbackSyncSource, /startsWith\('query_review_synced:'\)/, 'fallback sync must not duplicate linked query review tasks');
assert.match(feedbackSyncSource, /isQueryReview\(row\) \? `query_review_synced:\$\{task\.id\}`/, 'fallback sync must preserve the query review task ID');
assert.match(feedbackSyncSource, /Request record ID/);
assert.match(feedbackSyncSource, /existingTasks\.get\(String\(row\.id\)\) \|\| await createClickUpTask\(row\)/, 'retry sync must reconcile an existing external task before creating another');
assert.match(feedbackSyncSource, /\.eq\('status', row\.status\)/, 'retry workers must atomically claim a pending row');
assert.match(feedbackSyncSource, /statusShowsDispatching/, 'rows with uncertain or active dispatch ownership must not be retried automatically');
assert.match(feedbackSyncSource, /isLeadRequest/, 'lead rows must retain specialized ClickUp task formatting during retry');
assert.match(feedbackSyncSource, /isOnboardingRequest/, 'onboarding fallback rows must retain specialized ClickUp task formatting during retry');
assert.match(actionsSource, /lead_clickup_dispatching:\$\{Date\.now\(\)\}/, 'lead direct dispatches must reserve timestamped ownership');
assert.match(actionsSource, /onboarding_clickup_dispatching:\$\{Date\.now\(\)\}/, 'onboarding fallback dispatches must reserve timestamped ownership');
assert.match(actionsSource, /insert\(\{ \.\.\.request, status: onboardingDispatchStatus \}\)/, 'structured onboarding must also persist dispatch ownership');
assert.match(feedbackSyncSource, /from\('onboarding_requests'\)/, 'shared worker must process structured onboarding rows');
assert.match(feedbackSyncSource, /from\(rowTable\(row\)\)/, 'worker claims and links must target the owning source table');
assert.match(feedbackSyncSource, /buildOnboardingTask\(feedback\)/, 'structured and fallback onboarding retries must use the complete shared task builder');
assert.match(feedbackSyncSource, /--onboarding-id=/, 'structured onboarding rows must support targeted retry');
assert.match(actionsSource, /const dispatchStatus = clickupConfigured \? `clickup_dispatching:\$\{Date\.now\(\)\}:\$\{randomUUID\(\)\}` : null/, 'ordinary feedback must reserve timestamped dispatch ownership before direct ClickUp creation');
assert.match(actionsSource, /const dispatchStatus = `query_review_dispatching:\$\{Date\.now\(\)\}:\$\{randomUUID\(\)\}`/, 'query-review direct dispatches must encode reservation time');
assert.match(feedbackSyncSource, /_dispatching:\$\{Date\.now\(\)\}:\$\{randomUUID\(\)\}/, 'worker claims must encode reservation time');
assert.match(feedbackSyncSource, /Onboarding request ID/, 'direct onboarding tasks must be discoverable during uncertain-dispatch reconciliation');
assert.match(feedbackSyncSource, /--reconcile-feedback-id=/, 'uncertain dispatches must have a targeted reconciliation path');
assert.match(feedbackSyncSource, /\[reconciled\].*existingTask\.id/, 'targeted reconciliation must CAS-link an existing external task');
assert.match(feedbackSyncSource, /--release-dispatch/, 'releasing uncertain ownership must require an explicit operator flag');
assert.match(feedbackSyncSource, /!\[408, 425, 429\]\.includes\(syncError\.status\)/, 'ambiguous ClickUp failures must keep their dispatch claim');

const dashboardSource = await readFile(new URL('../src/app/dashboard/DashboardClient.js', import.meta.url), 'utf8');
assert.match(dashboardSource, /Canonical monitoring stays unchanged until the request passes relevance, source-quality, and clean-results checks/);
assert.match(dashboardSource, /does not directly change canonical ingestion/);
assert.match(dashboardSource, /Request removal of this query\?[\s\S]*canonical monitoring will remain unchanged until Canary reviews the request/);

console.log('Query management policy tests passed.');

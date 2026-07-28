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
assert.equal((addAction.match(/duplicateWriteError/g) || []).length, 4, 'every add/reactivation write path must reconcile duplicates');
assert.match(updateAction, /searchQuerySnapshot\(changes\?\.original\)/, 'edits must require the browser original snapshot');
assert.match(updateAction, /applySearchQuerySnapshotFilters\(update, originalSnapshot\)/, 'edits must guard updates with every original mutable value');
assert.match(updateAction, /duplicateWriteError/, 'edits must reconcile duplicates after writing');
assert.match(updateAction, /reconcileRollback:\s*true/, 'edit rollback must receive a second duplicate reconciliation pass');
assert.match(actionsSource, /restoredReconciliation/, 'restored fingerprints must be reconciled before returning');

console.log('Query management policy tests passed.');

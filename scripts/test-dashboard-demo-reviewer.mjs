import assert from 'node:assert/strict';
import { normalizeDashboardDistrictIds, resolveDemoReviewerAccess } from '../src/lib/dashboard-access.mjs';

const districts = [
  { id: 'shelby', name: 'Shelby' },
  { id: 'auburn', name: 'Auburn' },
  { id: 'spartanburg', name: 'Spartanburg' },
  { id: 'fort-wayne', name: 'Fort Wayne' },
  { id: 'unrelated', name: 'Unrelated' },
];

assert.deepEqual(normalizeDashboardDistrictIds(['auburn', ' auburn ', '', null, 'shelby']), ['auburn', 'shelby']);

const reviewer = resolveDemoReviewerAccess({
  metadata: {
    role: 'demo_reviewer',
    district_id: 'shelby',
    district_ids: ['shelby', 'auburn', 'spartanburg', 'fort-wayne', 'missing', 'auburn'],
  },
  districts,
  requestedDistrictId: 'auburn',
});
assert.equal(reviewer.isDemoReviewer, true);
assert.equal(reviewer.hasAccess, true);
assert.equal(reviewer.selectedDistrictId, 'auburn');
assert.deepEqual(reviewer.districtIds, ['shelby', 'auburn', 'spartanburg', 'fort-wayne']);
assert.deepEqual(reviewer.districts.map((district) => district.id), ['shelby', 'auburn', 'spartanburg', 'fort-wayne']);
assert.equal(reviewer.districts.some((district) => district.id === 'unrelated'), false);

const blockedRequest = resolveDemoReviewerAccess({
  metadata: reviewer.isDemoReviewer ? {
    role: 'demo_reviewer',
    district_id: 'shelby',
    district_ids: reviewer.districtIds,
  } : {},
  districts,
  requestedDistrictId: 'unrelated',
});
assert.equal(blockedRequest.selectedDistrictId, 'shelby');
assert.equal(blockedRequest.districts.some((district) => district.id === 'unrelated'), false);

const noConfiguredAccess = resolveDemoReviewerAccess({
  metadata: { role: 'demo_reviewer', district_ids: ['missing'] },
  districts,
  requestedDistrictId: 'unrelated',
});
assert.equal(noConfiguredAccess.hasAccess, false);
assert.equal(noConfiguredAccess.selectedDistrictId, null);
assert.deepEqual(noConfiguredAccess.districts, []);

const ordinaryClient = resolveDemoReviewerAccess({
  metadata: { role: 'client', district_id: 'shelby' },
  districts,
  requestedDistrictId: 'unrelated',
});
assert.equal(ordinaryClient.isDemoReviewer, false);
assert.equal(ordinaryClient.hasAccess, true);
assert.deepEqual(ordinaryClient.districts, districts);

console.log('Dashboard demo-reviewer access checks passed.');

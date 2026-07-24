import assert from 'node:assert/strict';
import { buildCollectionHealth, summarizeCollectionHealth } from '../src/lib/collectionHealth.mjs';

const now = new Date('2026-07-24T12:00:00Z').getTime();
assert.equal(summarizeCollectionHealth({ lastResultAt: '2026-07-24T10:00:00Z', rawResults7d: 3, acceptedStories14d: 1 }, now).status, 'healthy');
assert.equal(summarizeCollectionHealth({ lastResultAt: '2026-07-22T12:00:00Z', rawResults7d: 3, acceptedStories14d: 1 }, now).status, 'warning');
assert.equal(summarizeCollectionHealth({ lastResultAt: '2026-07-19T12:00:00Z', rawResults7d: 3, acceptedStories14d: 1 }, now).status, 'critical');
const review = summarizeCollectionHealth({ lastResultAt: '2026-07-24T10:00:00Z', rawResults7d: 3, acceptedStories14d: 0 }, now);
assert.equal(review.status, 'warning');
assert.match(review.detail, /no new stories were accepted/i);

const [district] = buildCollectionHealth({
  districts: [{ id: 'alabaster', name: 'Alabaster City Schools' }],
  rawResults: [{ district_id: 'alabaster', collected_at: '2026-07-24T10:00:00Z' }],
  candidates: [{ district_id: 'alabaster', evaluated_at: '2026-07-24T10:05:00Z' }],
  stories: [{ district_id: 'alabaster', created_at: '2026-07-20T10:00:00Z' }],
  now,
});
assert.equal(district.districtName, 'Alabaster City Schools');
assert.equal(district.rawResults7d, 1);
assert.equal(district.candidates7d, 1);
assert.equal(district.acceptedStories14d, 1);
assert.equal(district.status, 'healthy');

console.log('Collection health unit tests passed.');

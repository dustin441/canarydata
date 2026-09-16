import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  SOCIAL_DISCOVERY_BATCH_LIMIT,
  filterSocialDiscoveryCandidates,
  normalizeSocialDiscoveryBatchItems,
  rankSocialDiscoveryCandidates,
  socialDiscoveryAgeHours,
  socialDiscoveryAuthor,
  socialDiscoveryConfidence,
  socialDiscoveryConfidenceBand,
  socialDiscoveryEngagement,
  socialDiscoveryPriority,
} from '../src/lib/socialDiscoveryReview.mjs';

const id = (suffix) => `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;
const candidates = [
  { id: id(1), district_id: 'district-a', platform: 'facebook', relationship_type: 'ambient', last_seen_at: '2026-09-10T10:00:00Z', candidate_payload: { author_name: 'Routine Parent', body: 'A normal school event reminder', reaction_count: 2, identity_confidence: 0.91, published_at: '2026-09-10T09:00:00Z' } },
  { id: id(2), district_id: 'district-b', platform: 'instagram', relationship_type: 'ambient', last_seen_at: '2026-09-09T10:00:00Z', candidate_payload: { author_handle: '@SafetyReporter', headline: 'School lockdown after safety threat', reaction_count: 1, identity_confidence: 0.67, published_at: '2026-09-09T09:00:00Z' } },
  { id: id(3), district_id: 'district-a', platform: 'facebook', relationship_type: 'direct_mention', last_seen_at: '2026-09-10T08:00:00Z', candidate_payload: { author_name: 'Community Group', body: 'District was mentioned in a fundraiser', reaction_count: 10, comment_count: 4, identity_confidence: 0.31, published_at: '2026-09-10T07:00:00Z' } },
  { id: id(4), district_id: 'district-a', platform: 'facebook', relationship_type: 'ambient', last_seen_at: '2026-09-10T06:00:00Z', candidate_payload: { author_name: 'Popular Parent', body: 'Photo from the game', reaction_count: 90, comment_count: 15, published_at: '2026-09-10T05:00:00Z' } },
];

assert.equal(socialDiscoveryAuthor(candidates[1]), 'SafetyReporter');
assert.equal(socialDiscoveryEngagement(candidates[3]), 105);
assert.equal(socialDiscoveryConfidence(candidates[0]), 0.91);
assert.equal(socialDiscoveryConfidenceBand(candidates[0]), 'high');
assert.equal(socialDiscoveryConfidenceBand(candidates[1]), 'medium');
assert.equal(socialDiscoveryConfidenceBand(candidates[2]), 'low');
assert.equal(socialDiscoveryConfidenceBand(candidates[3]), 'unknown');
assert.equal(socialDiscoveryAgeHours(candidates[0], '2026-09-10T12:00:00Z'), 3);
assert.equal(socialDiscoveryPriority(candidates[0]), 'standard');
assert.equal(socialDiscoveryPriority(candidates[1]), 'urgent');
assert.equal(socialDiscoveryPriority(candidates[2]), 'high');
assert.equal(socialDiscoveryPriority(candidates[3]), 'high');
assert.deepEqual(rankSocialDiscoveryCandidates(candidates).map((candidate) => candidate.id), [id(2), id(4), id(3), id(1)]);
assert.deepEqual(filterSocialDiscoveryCandidates(candidates, { priority: 'high', platform: 'facebook' }).map((candidate) => candidate.id), [id(3), id(4)]);
assert.deepEqual(filterSocialDiscoveryCandidates(candidates, { author: 'safetyreporter' }).map((candidate) => candidate.id), [id(2)]);
assert.deepEqual(filterSocialDiscoveryCandidates(candidates, { districtId: 'district-a', confidence: 'low' }).map((candidate) => candidate.id), [id(3)]);
assert.deepEqual(filterSocialDiscoveryCandidates(candidates, { maxAgeDays: 1, now: '2026-09-10T12:00:00Z' }).map((candidate) => candidate.id), [id(1), id(3), id(4)]);
assert.deepEqual(filterSocialDiscoveryCandidates(candidates, { query: 'lockdown' }).map((candidate) => candidate.id), [id(2)]);

assert.deepEqual(normalizeSocialDiscoveryBatchItems([{ candidateId: id(1), expectedVersion: 2 }]), [{ candidateId: id(1), expectedVersion: 2 }]);
assert.throws(() => normalizeSocialDiscoveryBatchItems([]), /Select at least one/);
assert.throws(() => normalizeSocialDiscoveryBatchItems([{ candidateId: 'bad', expectedVersion: 1 }]), /valid ID/);
assert.throws(() => normalizeSocialDiscoveryBatchItems([{ candidateId: id(1), expectedVersion: -1 }]), /current version/);
assert.throws(() => normalizeSocialDiscoveryBatchItems([
  { candidateId: id(1), expectedVersion: 1 }, { candidateId: id(1), expectedVersion: 1 },
]), /cannot appear twice/);
assert.throws(() => normalizeSocialDiscoveryBatchItems(Array.from({ length: SOCIAL_DISCOVERY_BATCH_LIMIT + 1 }, (_, index) => ({ candidateId: id(index + 1), expectedVersion: 1 }))), /no more than/);

const [actions, client, data] = await Promise.all([
  readFile(new URL('../src/app/actions.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/dashboard/affiliates/SocialDiscoveryReviewClient.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/data.js', import.meta.url), 'utf8'),
]);
assert.match(actions, /export async function reviewSocialDiscoveryCandidates/);
assert.match(actions, /normalizeSocialDiscoveryBatchItems/);
assert.match(actions, /\.eq\('district_id', districtId\)/);
assert.match(actions, /\.eq\('status', 'pending'\)/);
assert.match(client, /Select visible/);
assert.match(client, /Approve selected/);
assert.match(client, /Reject selected/);
assert.match(client, /Priority/);
assert.match(data, /getPendingSocialDiscoveryCandidates\(districtId = null\)/);
assert.match(data, /\.range\(from, from \+ SOCIAL_DISCOVERY_PAGE_SIZE - 1\)/);
console.log('Social discovery prioritization and batch-review checks passed.');

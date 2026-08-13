import assert from 'node:assert/strict';
import { buildCollectionHealth, buildSocialCollectionHealth, summarizeCollectionHealth, summarizeSocialCollectionHealth } from '../src/lib/collectionHealth.mjs';

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

assert.equal(summarizeSocialCollectionHealth({ enrolled: false }, now).status, 'not_enrolled');
const healthyEmpty = summarizeSocialCollectionHealth({ enrolled: true, latestRunAt: '2026-07-24T10:00:00Z', latestRunStatus: 'empty', nonterminalRunCount: 0 }, now);
assert.equal(healthyEmpty.status, 'healthy');
assert.match(healthyEmpty.detail, /completed normally/i);
assert.equal(summarizeSocialCollectionHealth({ enrolled: true, latestRunAt: '2026-07-24T10:00:00Z', latestRunStatus: 'failed', latestRunError: 'provider_error', nonterminalRunCount: 0 }, now).status, 'critical');
assert.equal(summarizeSocialCollectionHealth({ enrolled: true, latestRunAt: '2026-07-24T10:00:00Z', latestRunStatus: 'partial', latestRunError: 'coverage_truncated', nonterminalRunCount: 0 }, now).status, 'warning');
const partialWithStuckRun = summarizeSocialCollectionHealth({ enrolled: true, latestRunAt: '2026-07-24T10:00:00Z', latestRunStatus: 'partial', latestRunError: 'coverage_truncated', nonterminalRunCount: 1 }, now);
assert.equal(partialWithStuckRun.status, 'critical');
assert.match(partialWithStuckRun.label, /did not terminalize/i);
assert.equal(summarizeSocialCollectionHealth({ enrolled: true, latestRunAt: '2026-07-24T10:00:00Z', latestRunStatus: 'mystery', nonterminalRunCount: 0 }, now).status, 'critical');
assert.equal(summarizeSocialCollectionHealth({ enrolled: true, latestRunAt: '2026-07-20T10:00:00Z', latestRunStatus: 'success', nonterminalRunCount: 0 }, now).status, 'critical');

const [socialDistrict] = buildSocialCollectionHealth({
  districts: [{ id: 'alabaster', name: 'Alabaster City Schools' }],
  socialQueries: [{ district_id: 'alabaster', channels: 'social', active: true }],
  socialRuns: [
    { district_id: 'alabaster', status: 'partial', started_at: '2026-07-24T08:00:00Z', completed_at: '2026-07-24T08:05:00Z', raw_items: 600, accepted_threads: 300 },
    { district_id: 'alabaster', status: 'success', started_at: '2026-07-24T09:00:00Z', completed_at: '2026-07-24T09:05:00Z', raw_items: 10, accepted_threads: 2 },
    { district_id: 'alabaster', status: 'empty', started_at: '2026-07-24T10:00:00Z', completed_at: '2026-07-24T10:05:00Z', raw_items: 4, accepted_threads: 0 },
    { district_id: 'alabaster', status: 'running', started_at: '2026-07-24T11:00:00Z', completed_at: null, raw_items: 0, accepted_threads: 0 },
  ],
  socialAccounts: [{ district_id: 'alabaster', active: true }],
  now,
});
assert.equal(socialDistrict.status, 'healthy');
assert.equal(socialDistrict.latestRunStatus, 'empty');
assert.equal(socialDistrict.latestRawItems, 4);
assert.equal(socialDistrict.latestAcceptedCandidates, 0);
assert.equal(socialDistrict.officialAccountCount, 1);
assert.equal(socialDistrict.nonterminalRunCount, 0);

const [stuckSocialDistrict] = buildSocialCollectionHealth({
  districts: [{ id: 'alabaster', name: 'Alabaster City Schools' }],
  socialQueries: [{ district_id: 'alabaster', channels: 'social', active: true }],
  socialRuns: [
    { district_id: 'alabaster', status: 'success', started_at: '2026-07-24T05:00:00Z', completed_at: '2026-07-24T05:05:00Z', raw_items: 10, accepted_threads: 2 },
    { district_id: 'alabaster', status: 'running', started_at: '2026-07-24T07:00:00Z', completed_at: null, raw_items: 0, accepted_threads: 0 },
  ],
  now,
});
assert.equal(stuckSocialDistrict.status, 'critical');
assert.equal(stuckSocialDistrict.nonterminalRunCount, 1);

const [overlapDistrict] = buildSocialCollectionHealth({
  districts: [{ id: 'alabaster', name: 'Alabaster City Schools' }],
  socialQueries: [{ district_id: 'alabaster', channels: 'social', active: true }],
  socialRuns: [
    { id: 'run-a', district_id: 'alabaster', status: 'success', started_at: '2026-07-24T09:00:00Z', completed_at: '2026-07-24T11:30:00Z', raw_items: 10, accepted_threads: 2 },
    { id: 'run-b', district_id: 'alabaster', status: 'failed', started_at: '2026-07-24T10:00:00Z', completed_at: '2026-07-24T10:30:00Z', error_code: 'provider_error', raw_items: 0, accepted_threads: 0 },
  ],
  now,
});
assert.equal(overlapDistrict.status, 'critical');
assert.equal(overlapDistrict.latestRunId, 'run-b');
assert.equal(overlapDistrict.latestRunStatus, 'failed');

const [tieBreakDistrict] = buildSocialCollectionHealth({
  districts: [{ id: 'alabaster', name: 'Alabaster City Schools' }],
  socialQueries: [{ district_id: 'alabaster', channels: 'social', active: true }],
  socialRuns: [
    { id: 'run-a', district_id: 'alabaster', status: 'success', started_at: '2026-07-24T10:00:00Z', completed_at: '2026-07-24T10:30:00Z' },
    { id: 'run-b', district_id: 'alabaster', status: 'failed', started_at: '2026-07-24T10:00:00Z', completed_at: '2026-07-24T10:20:00Z', error_code: 'tie_failure' },
  ],
  now,
});
assert.equal(tieBreakDistrict.latestRunId, 'run-b');
assert.equal(tieBreakDistrict.status, 'critical');

console.log('Collection health unit tests passed.');

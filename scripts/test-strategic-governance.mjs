import assert from 'node:assert/strict';
import { buildStrategicGovernance } from '../src/lib/strategicGovernance.mjs';

const result = buildStrategicGovernance({
  districtId: 'alpha',
  profiles: [
    {
      id: 'profile-alpha',
      district_id: 'alpha',
      source_confidence: 'high',
      mission: 'Prepare every student.',
      vision: 'Every student thrives.',
      values: ['Trust', 'Service'],
      source_urls: ['https://district.example/plan', 'javascript:alert(1)', 'https://user:pass@example.com/private'],
      last_reviewed_at: '2026-07-07T00:00:00Z',
    },
    { id: 'profile-beta', district_id: 'beta', source_confidence: 'low' },
  ],
  priorities: [
    { id: 'p1', district_id: 'alpha', profile_id: 'profile-alpha', label: 'Student Success', active: true, confidence: 'high', source_urls: ['https://district.example/plan'] },
    { id: 'p2', district_id: 'alpha', profile_id: 'profile-alpha', label: 'Community Trust', active: true, confidence: 'medium', source_urls: ['https://board.example/goal'] },
    { id: 'p3', district_id: 'alpha', profile_id: 'profile-alpha', label: 'Old Goal', active: false, confidence: 'high' },
    { id: 'p4', district_id: 'beta', profile_id: 'profile-beta', label: 'Wrong District', active: true },
  ],
});

assert.equal(result.profile.id, 'profile-alpha');
assert.equal(result.confidence, 'high');
assert.equal(result.lastReviewedAt, '2026-07-07T00:00:00Z');
assert.deepEqual(result.values, ['Trust', 'Service']);
assert.deepEqual(result.priorities.map((priority) => priority.label), ['Community Trust', 'Student Success']);
assert.deepEqual(result.sourceUrls, ['https://district.example/plan', 'https://board.example/goal']);
assert.equal(result.sourceCount, 2);
assert.equal(result.priorityCount, 2);
assert.equal(buildStrategicGovernance({ districtId: 'missing', profiles: [], priorities: [] }), null);

console.log('Strategic governance unit tests passed.');

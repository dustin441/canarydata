import assert from 'node:assert/strict';
import { buildCommunicationsBrief, formatCommunicationsBriefRecommendation, isRoutineRecommendation } from '../src/lib/communicationsBrief.mjs';

assert.equal(isRoutineRecommendation('No immediate communications action recommended. Continue routine monitoring.'), true);
assert.equal(isRoutineRecommendation('Confirm the event details, then amplify the opportunity.'), false);
assert.equal(isRoutineRecommendation(''), false);
assert.equal(
  formatCommunicationsBriefRecommendation('## Strategic Intent\\n**Amplify** the story and __verify__ the date.'),
  'Strategic Intent Amplify the story and verify the date.'
);

const brief = buildCommunicationsBrief([
  { id: 'routine', date: '2026-07-20', headline: 'Routine mention', recommendation: 'No immediate communications action recommended. Continue routine monitoring.', canary_score: 9.9 },
  { id: 'older', date: '2026-07-18', headline: 'Older action', recommendation: 'Prepare a family update.', canary_score: 8.8, source_type: 'news' },
  { id: 'newer', date: '2026-07-21', headline: 'Newer action', recommendation: 'Confirm the details and share the opportunity.', canary_score: 7.5, source_type: 'instagram' },
  { id: 'duplicate', link: 'https://example.com/newer', date: '2026-07-21', headline: 'Newer action', recommendation: 'Confirm the details and share the opportunity.', canary_score: 7.5 },
  { id: 'duplicate-copy', link: 'https://example.com/newer', date: '2026-07-21', headline: 'Newer action copy', recommendation: 'Confirm the details and share the opportunity.', canary_score: 7.5 },
  { id: 'missing', date: '2026-07-22', headline: 'No recommendation' },
], 2);

assert.equal(brief.latestDate, '2026-07-22');
assert.equal(brief.recommendedCount, 3);
assert.equal(brief.routineCount, 1);
assert.deepEqual(brief.items.map((item) => item.id), ['newer', 'duplicate',]);

const tied = buildCommunicationsBrief([
  { id: 'low', date: '2026-07-10', recommendation: 'Review this.', canary_score: 5 },
  { id: 'high', date: '2026-07-10', recommendation: 'Review that.', canary_score: 9 },
]);
assert.deepEqual(tied.items.map((item) => item.id), ['high', 'low']);

console.log('Communications brief unit tests passed.');

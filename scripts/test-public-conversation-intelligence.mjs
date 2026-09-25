import assert from 'node:assert/strict';
import {
  normalizeCanaryScore,
  canaryScoreBand,
  canaryScoreBandLabel,
  normalizeStrategicLabels,
  publicConversationAction,
  publicConversationSummary,
} from '../src/lib/publicConversation.mjs';

assert.equal(normalizeCanaryScore(null), null);
assert.equal(normalizeCanaryScore(''), null);
assert.equal(normalizeCanaryScore('7.2'), 7.2);
assert.equal(normalizeCanaryScore(0), null);
assert.equal(normalizeCanaryScore(11), null);
assert.equal(canaryScoreBand(10), 'positive');
assert.equal(canaryScoreBand(7), 'positive');
assert.equal(canaryScoreBand(6.9), 'neutral');
assert.equal(canaryScoreBand(3), 'neutral');
assert.equal(canaryScoreBand(2.9), 'concerning');
assert.equal(canaryScoreBand(1), 'concerning');
assert.equal(canaryScoreBandLabel(null), 'Not scored');
assert.deepEqual(normalizeStrategicLabels('Safety & Wellness; Engagement|Safety & Wellness'), ['Safety & Wellness', 'Engagement']);

assert.equal(publicConversationAction({ canaryScore: 2.5 }).actionType, 'monitor');
assert.equal(publicConversationAction({ canaryScore: 8 }).actionType, 'monitor');
assert.equal(publicConversationAction({ canaryScore: 5 }).actionType, 'monitor');
assert.equal(publicConversationAction({ canaryScore: null, sentiment: 'negative' }).actionType, 'monitor');
assert.equal(publicConversationAction({ actionIntelligence: { actionType: 'respond' } }).actionType, 'respond');
assert.deepEqual(publicConversationAction({
  canaryScore: 2.1,
  actionType: 'respond',
  recommendation: 'Respond immediately.',
}).actionType, 'monitor');
assert.equal(
  publicConversationAction({ recommendation: 'Amplify this post.' }).rationale,
  'Review the evidence and verify context before deciding whether public engagement is appropriate.',
);
assert.equal(publicConversationAction({ recommendation: 'Amplify this post.' }).draftResponse, '');
assert.deepEqual(publicConversationAction({
  canaryScore: 8,
  actionIntelligence: {
    actionType: 'thank',
    draftResponse: 'Thank you for celebrating our students.',
    strategicPriorityLabels: ['Student Success'],
    factsToVerify: ['Confirm the award date.'],
  },
}), {
  actionType: 'thank',
  actionLabel: 'Thank',
  rationale: '',
  draftResponse: 'Thank you for celebrating our students.',
  factsToVerify: ['Confirm the award date.'],
  strategicLabels: ['Student Success'],
  strategicAlignmentReason: '',
});

assert.deepEqual(publicConversationSummary([
  { relationshipType: 'ambient', canaryScore: 8, strategicAlignment: ['Engagement'] },
  { relationshipType: 'direct', canaryScore: 5 },
  { relationshipType: 'ambient', canaryScore: 2 },
  { relationshipType: 'ambient', canaryScore: null },
  { relationshipType: 'owned', canaryScore: 10 },
]), {
  total: 4,
  scored: 3,
  averageScore: 5,
  positive: 1,
  neutral: 1,
  concerning: 1,
  strategicHits: 1,
});

console.log('Public Conversation intelligence tests passed.');

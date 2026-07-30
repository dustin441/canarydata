import assert from 'node:assert/strict';
import { compareStrategicAlignmentRows, parseStrategicAlignmentOrdinal } from '../src/lib/strategicAlignmentSort.mjs';

function sortRows(rows) {
  return [...rows].sort(compareStrategicAlignmentRows);
}

function labels(rows) {
  return sortRows(rows).map((row) => row.label);
}

assert.deepEqual(
  labels([
    { label: 'Pillar 2: Community Engagement', count: 10 },
    { label: 'Pillar 4: Operational Excellence', count: 8 },
    { label: 'Pillar 1: Academic Excellence', count: 2 },
    { label: 'Pillar 3: Student Wellness', count: 6 },
  ]),
  [
    'Pillar 1: Academic Excellence',
    'Pillar 2: Community Engagement',
    'Pillar 3: Student Wellness',
    'Pillar 4: Operational Excellence',
  ],
  'Arabic-numbered pillars should sort by ordinal, not mention count',
);

assert.deepEqual(
  labels([
    { label: 'Goal III: Family Partnerships', count: 20 },
    { label: 'Goal I: Academic Growth', count: 3 },
    { label: 'Goal IV: Operational Excellence', count: 12 },
    { label: 'Goal II: Safe Schools', count: 7 },
  ]),
  [
    'Goal I: Academic Growth',
    'Goal II: Safe Schools',
    'Goal III: Family Partnerships',
    'Goal IV: Operational Excellence',
  ],
  'Roman-numeral goals should sort by ordinal, not mention count',
);

assert.deepEqual(
  labels([
    { label: 'Goal 3: Ensure safe, engaging, and welcoming schools', count: 18 },
    { label: 'Goal 2: Support high expectations for academic performance and expand opportunities for every student', count: 11 },
    { label: 'Goal 1: Ensure meaningful post-secondary outcomes for every student', count: 4 },
    { label: 'Goal 4: Support and invest in all staff', count: 7 },
  ]),
  [
    'Goal 1: Ensure meaningful post-secondary outcomes for every student',
    'Goal 2: Support high expectations for academic performance and expand opportunities for every student',
    'Goal 3: Ensure safe, engaging, and welcoming schools',
    'Goal 4: Support and invest in all staff',
  ],
  'Stafford Arabic-numbered goals should remain in natural order regardless of mention counts',
);

assert.deepEqual(
  labels([
    { label: 'Priority 10: Long-term Sustainability', count: 9 },
    { label: 'Priority 2: Staff Success', count: 1 },
    { label: 'Priority 1: Student Success', count: 2 },
  ]),
  [
    'Priority 1: Student Success',
    'Priority 2: Staff Success',
    'Priority 10: Long-term Sustainability',
  ],
  'Multi-digit priority numbers should use numeric ordering',
);

assert.deepEqual(
  labels([
    { label: 'Innovation', count: 4 },
    { label: 'Academic Success', count: 9 },
    { label: 'Community Engagement', count: 9 },
  ]),
  ['Academic Success', 'Community Engagement', 'Innovation'],
  'Named focus areas should retain count-first, alphabetical tie-break ordering',
);

assert.deepEqual(
  labels([
    { label: 'Goal II: Safe Schools', count: 1 },
    { label: 'Academic Success', count: 8 },
    { label: 'Goal I: Academic Growth', count: 3 },
  ]),
  ['Academic Success', 'Goal I: Academic Growth', 'Goal II: Safe Schools'],
  'Ordinal labels should be ordered naturally within their family without displacing named labels from count ranking',
);

assert.deepEqual(parseStrategicAlignmentOrdinal('Goal IX: Future Readiness'), {
  family: 'goal',
  ordinal: 9,
});
assert.deepEqual(parseStrategicAlignmentOrdinal('Strategic Priority #12 - Finance'), {
  family: 'priority',
  ordinal: 12,
});
assert.equal(parseStrategicAlignmentOrdinal('Community Engagement'), null);
assert.equal(parseStrategicAlignmentOrdinal('Goal IC: Invalid Roman numeral'), null);

console.log('Strategic Alignment sorting checks passed.');

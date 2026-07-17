import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  calibrateSentiment,
  canonicalStrategicAlignment,
  classifySource,
  detectSensitivePersonnelTrustIssue,
  validateCandidate,
} from './canary-quality-policy.mjs';

const fixtures = JSON.parse(await readFile(new URL('../test/fixtures/canary-quality-known-cases.json', import.meta.url), 'utf8'));
const failures = [];

for (const fixture of fixtures) {
  try {
    if (fixture.kind === 'sentiment') {
      const fields = { headline: fixture.input.headline, summary: fixture.input.summary, tags: fixture.input.tags };
      assert.equal(detectSensitivePersonnelTrustIssue(fields), fixture.expected.sensitive_personnel);
      assert.equal(calibrateSentiment(fixture.input.raw_sentiment, fields), fixture.expected.sentiment);
    } else if (fixture.kind === 'alignment') {
      const result = canonicalStrategicAlignment(fixture.input.ai, fixture.input.priorities);
      assert.equal(result.flag, fixture.expected.flag);
      assert.deepEqual(result.labels, fixture.expected.labels);
    } else if (fixture.kind === 'geography') {
      const result = validateCandidate(fixture.input);
      assert.equal(result.decision, fixture.expected.decision);
      if (fixture.expected.exclusion) assert.ok(result.exclusion_matches.includes(fixture.expected.exclusion));
    } else if (fixture.kind === 'source') {
      const result = classifySource(fixture.input);
      assert.deepEqual(result, fixture.expected);
    } else {
      throw new Error(`Unknown fixture kind: ${fixture.kind}`);
    }
    console.log(`PASS ${fixture.id}`);
  } catch (error) {
    failures.push(`${fixture.id}: ${error.message}`);
    console.error(`FAIL ${fixture.id}: ${error.message}`);
  }
}

if (failures.length) {
  throw new Error(`${failures.length} quality regression fixture(s) failed:\n${failures.join('\n')}`);
}
console.log(`Canary quality regression suite passed ${fixtures.length}/${fixtures.length} fixtures.`);

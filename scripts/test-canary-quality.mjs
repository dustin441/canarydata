import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  calibrateSentiment,
  canonicalStrategicAlignment,
  classifySource,
  detectSensitivePersonnelTrustIssue,
  isDistrictControlledNewsSource,
  normalizeArticleInterpretation,
  normalizeRecommendationContract,
  validateCandidate,
} from './canary-quality-policy.mjs';

assert.equal(isDistrictControlledNewsSource({ source: 'Tuscaloosa City Schools', district_id: 'tuscaloosa-city-schools', link: 'https://tuscaloosacityschools.com/news/item' }), true);
assert.equal(isDistrictControlledNewsSource({ source: 'WBMA', district_id: 'tuscaloosa-city-schools', link: 'https://abc3340.com/news/local/item', strategic_priority_profile: { source_urls: ['https://tuscaloosacityschools.com/strategic-plan'] } }), false);
assert.equal(isDistrictControlledNewsSource({ source: 'District News', district_id: 'district-one', link: 'https://news.districtone.org/item', strategic_priority_profile: { source_urls: ['https://districtone.org/plan'] } }), true);
assert.equal(isDistrictControlledNewsSource({ source: 'BoardDocs', district_id: 'district-one', link: 'https://go.boarddocs.com/item', strategic_priority_profile: { source_urls: ['https://go.boarddocs.com/plan'] } }), false);

const fixtures = JSON.parse(await readFile(new URL('../test/fixtures/canary-quality-known-cases.json', import.meta.url), 'utf8'));
const failures = [];

for (const fixture of fixtures) {
  try {
    if (fixture.kind === 'sentiment') {
      const fields = {
        headline: fixture.input.headline,
        summary: fixture.input.summary,
        recommendation: fixture.input.recommendation,
        risk: fixture.input.risk,
        tags: fixture.input.tags,
        author: fixture.input.author,
        source: fixture.input.source,
        district_name: fixture.input.district_name,
        district_id: fixture.input.district_id,
        link: fixture.input.link,
      };
      assert.equal(detectSensitivePersonnelTrustIssue(fields), fixture.expected.sensitive_personnel);
      assert.equal(calibrateSentiment(fixture.input.raw_sentiment, fields), fixture.expected.sentiment);
    } else if (fixture.kind === 'interpretation') {
      const result = normalizeArticleInterpretation(fixture.input.ai, fixture.input.evidence);
      assert.equal(result.summary, fixture.expected.summary);
      assert.equal(result.recommendation, fixture.expected.recommendation);
      assert.equal(result.sentiment, fixture.expected.sentiment);
    } else if (fixture.kind === 'recommendation') {
      assert.equal(normalizeRecommendationContract(fixture.input.value, fixture.input.context), fixture.expected);
    } else if (fixture.kind === 'alignment') {
      const result = canonicalStrategicAlignment(fixture.input.ai, fixture.input.priorities, fixture.input.evidence);
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

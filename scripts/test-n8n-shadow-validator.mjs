import assert from 'node:assert/strict';
import fs from 'node:fs';

const validatorSource = fs.readFileSync(new URL('./n8n/canary-live-validate-shadow-candidate.js', import.meta.url), 'utf8');
const runValidator = new Function('$input', validatorSource);

function validate({ title, snippet = '', source = 'WVTM', district = 'jefferson-county-schools', entities, profile }) {
  const requiredEntities = entities ?? [{ name: 'Jefferson County Schools', aliases: ['JEFCOED'], required: true }];
  const validationProfile = profile ?? {
    primary_city: 'Birmingham',
    state_full: 'Alabama',
    state_abbrev: 'AL',
    county_name: 'Jefferson County',
    trusted_sources: ['WVTM'],
    include_geo_terms: ['Alabama', 'Birmingham'],
    exclude_geo_terms: ['Indiana', 'IN', 'Oregon', 'OR', 'Indianapolis', 'Portland, OR'],
    blocked_sources: [],
  };
  const items = [{ json: {
    id: 'raw-1',
    generated_query_id: 'query-1',
    district_id: district,
    title,
    snippet,
    source_name: source,
    url: 'https://example.com/story',
    raw_payload: {},
    profile: validationProfile,
    entities: requiredEntities,
  } }];
  return runValidator({ all: () => items })[0].json;
}

const jefferson = validate({
  title: 'Jefferson County schools add STEAM magnets at six campuses',
  snippet: 'Jefferson County Schools is expanding magnet options starting in 2027.',
});
assert.equal(jefferson.decision, 'accepted');
assert.deepEqual(jefferson.validation_details.exclusion_matches, []);

const ordinaryOr = validate({
  title: 'Jefferson County Schools adds arts or robotics pathways',
  snippet: 'Families can choose arts or robotics in the next school year.',
});
assert.equal(ordinaryOr.decision, 'accepted');
assert.deepEqual(ordinaryOr.validation_details.exclusion_matches, []);

const actualIndiana = validate({
  title: 'Jefferson County Schools announcement from Indiana',
  snippet: 'The Indianapolis district announced the change.',
});
assert.equal(actualIndiana.decision, 'rejected');
assert.match(actualIndiana.decision_reason, /Indiana|Indianapolis/);

const actualOregon = validate({
  title: 'Jefferson County Schools announcement from Oregon',
  snippet: 'The district near Portland published the update.',
});
assert.equal(actualOregon.decision, 'rejected');
assert.match(actualOregon.decision_reason, /Oregon/);

const blockedShortSource = validate({
  title: 'Jefferson County Schools expands STEAM magnet programs',
  snippet: 'The district announced seven new magnet programs in Birmingham.',
  source: 'IN',
  profile: {
    primary_city: 'Birmingham',
    state_full: 'Alabama',
    state_abbrev: 'AL',
    county_name: 'Jefferson County',
    trusted_sources: ['WVTM'],
    include_geo_terms: ['Alabama', 'Birmingham'],
    exclude_geo_terms: ['Indiana', 'IN'],
    blocked_sources: ['IN'],
  },
});
assert.equal(blockedShortSource.decision, 'rejected');
assert.match(blockedShortSource.decision_reason, /exclusion match: IN/);

const noEntity = validate({
  title: 'A local education story in Birmingham',
  snippet: 'Families have a new option.',
});
assert.equal(noEntity.decision, 'rejected');
assert.match(noEntity.decision_reason, /no required district entity/i);

console.log('PASS: shadow validator ignores ambiguous two-letter exclusion tokens while preserving full-location rejection.');

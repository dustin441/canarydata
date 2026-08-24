import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./n8n/canary-live-validate-shadow-candidate.js', import.meta.url), 'utf8');
const districtContext = {
  profile: {
    primary_city: 'Morenci',
    state_full: 'Michigan',
    state_abbrev: 'MI',
    include_geo_terms: ['Morenci'],
    exclude_geo_terms: [],
    blocked_sources: [],
  },
  entities: [{ name: 'Morenci Area Schools', aliases: ['Morenci Bulldogs'], required: true }],
};
function validate(row) {
  const context = { $input: { all: () => [{ json: { ...districtContext, ...row } }] } };
  vm.createContext(context);
  return vm.runInContext(`(function () {${source}\n})()`, context)[0].json;
}

const youtube = validate({
  id: 'raw-youtube',
  district_id: 'morenci-area-schools',
  title: 'Morenci Bulldogs Marching Band plays at halftime',
  snippet: 'Morenci, Michigan marching band performance.',
  source_name: 'YouTube · R McElhaney',
  url: 'https://www.youtube.com/watch?v=57ZoDjt5oPI',
});
assert.equal(youtube.decision, 'rejected');
assert.match(youtube.decision_reason, /Social monitoring lane/);

const news = validate({
  id: 'raw-news',
  district_id: 'morenci-area-schools',
  title: 'Morenci Area Schools opens new program',
  snippet: 'Morenci, Michigan district leaders announced the program.',
  source_name: 'Local News',
  url: 'https://local.example/morenci-program',
});
assert.equal(news.decision, 'accepted');

console.log('News-lane source classification checks passed.');

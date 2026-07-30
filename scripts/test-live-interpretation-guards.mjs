import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./n8n/canary-live-finalize-story.js', import.meta.url), 'utf8');

function runFinalizer(ai, prepared) {
  const context = {
    $input: { all: () => [{ json: { text: JSON.stringify(ai) } }] },
    $: (name) => {
      assert.equal(name, 'Attach DB Strategic Priorities');
      return { itemMatching: () => ({ json: prepared }) };
    },
    console,
  };
  vm.createContext(context);
  return vm.runInContext(`(function () {${source}\n})()`, context)[0].json;
}

const basePrepared = {
  story_candidate_id: 'candidate-1',
  raw_result_id: 'raw-1',
  profile_version: 1,
  district_id: 'district-1',
  date: '2026-07-28',
  title: 'Example headline',
  link: 'https://example.com/story',
  source: 'Example News',
  source_type: 'news',
  strategic_priority_profile: { district_id: 'district-1' },
};

const incomplete = runFinalizer({
  summary: 'The article content provided is incomplete and does not include details.',
  local_recommendation: 'Await full article text before responding.',
  sentiment: -0.1,
  risk: 'Medium',
  tags: ['Operations & Finance'],
  author: 'Reporter',
  contact_info: 'N/A',
  relevance_score: 5,
}, {
  ...basePrepared,
  title: 'Fort Wayne Community Schools announces transportation changes',
  data: 'Fort Wayne Community Schools announces transportation changes\n\nFWCS will use late starts or early dismissals and is adding ID scanners, cameras and a parent tracking app.',
});
assert.equal(incomplete.summary, 'FWCS will use late starts or early dismissals and is adding ID scanners, cameras and a parent tracking app.');
assert.equal(incomplete.recommendation, 'N/A');

const missingSentiment = runFinalizer({
  summary: 'The school created a forensic science course after a staffing challenge interrupted band instruction.',
  local_recommendation: 'Explain the creative response while acknowledging the staffing challenge.',
  risk: 'Low',
  tags: ['Innovation'],
  author: 'Reporter',
  contact_info: 'N/A',
  relevance_score: 5,
}, {
  ...basePrepared,
  title: 'Musicians Reach for Magnifying Glasses at Rifle Middle School',
  data: 'Musicians Reach for Magnifying Glasses at Rifle Middle School\n\nThe school launched a creative forensic science course and after-school band club.',
});
assert.equal(missingSentiment.sentiment, 0.25);

const truthTelling = runFinalizer({
  summary: 'The superintendent held a news conference to explain legislation and quantify the district budget impact.',
  local_recommendation: 'Prepare a superintendent statement and communicate the fiscal threat transparently.',
  sentiment: -0.45,
  risk: 'Medium',
  tags: ['Operations & Finance'],
  author: 'Reporter',
  contact_info: 'N/A',
  relevance_score: 5,
}, {
  ...basePrepared,
  title: 'Superintendent: district could lose $14.5 million if legislation passes',
  data: 'Superintendent: district could lose $14.5 million if legislation passes\n\nDistrict leaders held a news conference and publicly explained the proposed legislation and funding impact.',
});
assert.equal(truthTelling.sentiment, 0.1);
assert.match(truthTelling.recommendation, /Amplify the district's existing transparent communication/);

const ownedColumn = runFinalizer({
  summary: 'The superintendent documents budget constraints, cost reductions and transparent budgeting.',
  local_recommendation: 'Amplify the column through district channels.',
  sentiment: 0.45,
  risk: 'Low',
  tags: ['Operations & Finance'],
  author: 'Kirk Banghart, Superintendent',
  contact_info: 'N/A',
  relevance_score: 5,
}, {
  ...basePrepared,
  title: "Garfield Re-2 superintendent's column: Maintaining momentum through fiscal responsibility",
  link: 'https://example.com/opinion/superintendent-column',
  data: "Garfield Re-2 superintendent's column\n\nThe superintendent explains the district budget and fiscal responsibility.",
});
assert.equal(ownedColumn.sentiment, 0.25);

console.log('Live ingestion interpretation guard checks passed.');

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
assert.equal(incomplete.recommendation, 'Review the source details before taking communications action.');

const noAction = runFinalizer({
  summary: 'A routine positive athletics scheduling item.',
  local_recommendation: 'N/A',
  sentiment: 0.15,
  risk: 'Low',
  tags: ['Engagement'],
  author: 'Reporter',
  contact_info: 'N/A',
  relevance_score: 0,
}, {
  ...basePrepared,
  title: 'How to watch the high school football game',
  data: 'Routine schedule and viewing information.',
});
assert.equal(noAction.recommendation, 'No immediate communications action recommended. Continue routine monitoring.');
assert.notEqual(noAction.recommendation, 'N/A');

const structuredRecommendation = [
  '## Strategic Intent', 'Amplify the verified result.', '',
  '## Audience Focus', '**Primary:** Families', '**Secondary:** Community', '',
  '## Message Angle', 'Lead with the measurable outcome.', '',
  '## Channel Strategy', 'Website and family email.', '',
  '## Execution Plan', '- Verify the metric', '- Publish approved copy', '',
  '## Guardrails', '- Use sourced figures', '- Avoid unsupported claims', '',
  '## Expected Outcome', 'Clear community understanding.', '',
  '## Next Phase', 'Monitor questions and follow-up coverage.',
].join('\n');
const structured = runFinalizer({
  summary: 'Students improved on the verified measure.',
  local_recommendation: structuredRecommendation,
  sentiment: 0.6,
  risk: 'Low',
  tags: ['Academic Success'],
  author: 'Reporter',
  contact_info: 'N/A',
  relevance_score: 5,
}, basePrepared);
assert.equal(structured.recommendation, structuredRecommendation);

const shortPositiveRecommendation = runFinalizer({
  summary: 'Students earned a statewide academic award.',
  local_recommendation: 'Amplify the student achievement.',
  sentiment: 0.7,
  risk: 'Low',
  tags: ['Academic Success'],
  author: 'Reporter',
  contact_info: 'N/A',
}, {
  ...basePrepared,
  title: 'Students earn statewide academic award',
  data: 'Students earned a statewide academic award.',
});
assert.equal(
  shortPositiveRecommendation.recommendation,
  'Amplify the student achievement. Verify the details before amplification, then monitor for stakeholder questions or follow-up opportunities.',
);

const shortConcernRecommendation = runFinalizer({
  summary: 'A transportation disruption affected afternoon routes.',
  local_recommendation: 'Prepare a family update.',
  sentiment: -0.6,
  risk: 'High',
  tags: ['Operations & Finance'],
  author: 'Reporter',
  contact_info: 'N/A',
}, {
  ...basePrepared,
  title: 'Transportation disruption affects routes',
  data: 'A transportation disruption affected afternoon routes.',
});
assert.equal(
  shortConcernRecommendation.recommendation,
  'Prepare a family update. Confirm the relevant facts and responsible spokesperson before publishing, then monitor for stakeholder questions, misinformation, or material changes.',
);

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

const morenciRoutine = runFinalizer({
  summary: 'Morenci Area Schools announced a routine special board meeting in the Middle School Library.',
  local_recommendation: 'Share the notice with staff and families while protecting children and employee privacy.',
  sentiment: -0.7,
  risk: 'Low',
  tags: ['Operations & Finance'],
  author: 'Morenci Area Schools',
  contact_info: 'N/A',
  relevance_score: 5,
}, {
  ...basePrepared,
  district_id: 'morenci-area-schools',
  title: 'Special Board of Education Meeting - July 30, 2026',
  source: 'Morenci Area Schools',
  link: 'https://morencibulldogs.org/article/3050403',
  strategic_priority_profile: { district_id: 'morenci-area-schools' },
});
assert.equal(morenciRoutine.sentiment, 0);
assert.equal(morenciRoutine.risk_level, 'Low');
assert.equal(morenciRoutine.tags.join('|'), 'Operations & Finance');

const auburnCapitalPlan = runFinalizer({
  summary: 'The district announced a 10-year facilities master plan to address enrollment growth and modernize infrastructure.',
  local_recommendation: 'Explain the project timeline and funding sources.',
  sentiment: -0.7,
  risk: 'Low',
  tags: ['Operations & Finance'],
  author: 'Reporter',
  contact_info: 'N/A',
  relevance_score: 5,
}, {
  ...basePrepared,
  district_id: 'auburn-city-schools',
  district_name: 'Auburn City Schools',
  title: 'Auburn City Schools unveil $383 million expansion plan',
  source: 'Yellowhammer News',
  link: 'https://yellowhammernews.com/auburn-city-schools-unveil-383-million-expansion-plan/',
  strategic_priority_profile: { district_id: 'auburn-city-schools' },
});
assert.equal(auburnCapitalPlan.sentiment, 0);
assert.equal(auburnCapitalPlan.risk_level, 'Low');
assert.equal(auburnCapitalPlan.tags.join('|'), 'Operations & Finance');

const haltedCapitalProject = runFinalizer({
  summary: 'The project is indefinitely suspended after the contractor bankruptcy, leaving classrooms unusable.',
  local_recommendation: 'Explain the disruption and recovery plan.',
  sentiment: -0.8,
  risk: 'High',
  tags: ['Operations & Finance'],
  author: 'Reporter',
  contact_info: 'N/A',
  relevance_score: 5,
}, {
  ...basePrepared,
  district_id: 'example-schools',
  district_name: 'Example Schools',
  title: 'School construction halted after contractor bankruptcy',
  source: 'Local News',
  link: 'https://local.example/halted-school-construction',
  strategic_priority_profile: { district_id: 'example-schools' },
});
assert.equal(haltedCapitalProject.sentiment, -0.8);

const independentWatchdog = runFinalizer({
  summary: 'The watchdog raises concerns about the project.',
  local_recommendation: 'Review the watchdog findings.',
  sentiment: -0.7,
  risk: 'High',
  tags: ['Operations & Finance'],
  author: 'Reporter',
  contact_info: 'N/A',
  relevance_score: 5,
}, {
  ...basePrepared,
  district_id: 'example-schools',
  district_name: 'Example Schools',
  title: 'Independent watchdog criticizes school construction spending',
  source: 'Example Schools Watchdog',
  link: 'https://watchdog.example/construction-spending',
  strategic_priority_profile: { district_id: 'example-schools' },
});
assert.equal(independentWatchdog.sentiment, -0.7);

const afterPromFatality = runFinalizer({
  summary: 'Prom had ended and the students were traveling independently in a personal vehicle. The district offered grief support.',
  local_recommendation: 'Support the affected families and protect student privacy.',
  sentiment: -0.9,
  risk: 'Medium',
  tags: ['Safety & Wellness'],
  strategic_alignment: 'Safe and Supportive Schools',
  alignment_explanation: 'The story concerns students.',
  author: 'Reporter',
  contact_info: 'N/A',
  relevance_score: 5,
}, { ...basePrepared, title: 'Students from Example High killed in crash after prom' });
assert.equal(afterPromFatality.sentiment, -0.1);
assert.equal(afterPromFatality.innovation_flag, false);
assert.equal(afterPromFatality.innovation_reason, 'N/A');
assert.match(afterPromFatality.recommendation, /sensitive community tragedy/);

const fieldTripFatality = runFinalizer({
  summary: 'The fatal incident occurred while students were under district supervision on a school-sponsored field trip.',
  local_recommendation: 'Coordinate a factual response and family support.',
  sentiment: -0.65,
  risk: 'High',
  tags: ['Safety & Wellness'],
  strategic_alignment: 'Safe and Supportive Schools',
  alignment_explanation: 'The story concerns safety.',
  author: 'Reporter',
  contact_info: 'N/A',
  relevance_score: 5,
}, { ...basePrepared, title: 'Student dies during school-sponsored field trip' });
assert.equal(fieldTripFatality.sentiment, -0.65);
assert.equal(fieldTripFatality.innovation_flag, false);

const personalDui = runFinalizer({
  summary: 'The superintendent was off duty, driving a personal vehicle and was not on district business.',
  local_recommendation: 'Monitor stakeholder reaction and distinguish personal conduct from district operations.',
  sentiment: -0.8,
  risk: 'Medium',
  tags: ['Safety & Wellness'],
  strategic_alignment: 'Leadership',
  alignment_explanation: 'The superintendent is a district leader.',
  author: 'Reporter',
  contact_info: 'N/A',
  relevance_score: 5,
}, { ...basePrepared, title: 'Superintendent arrested for DUI Saturday night' });
assert.equal(personalDui.sentiment, -0.1);
assert.equal(personalDui.innovation_flag, false);

const officialDui = runFinalizer({
  summary: 'The superintendent was on the clock, driving a district-owned vehicle on district business.',
  local_recommendation: 'Address the official-capacity conduct and district accountability.',
  sentiment: -0.65,
  risk: 'High',
  tags: ['Safety & Wellness'],
  strategic_alignment: 'Leadership',
  alignment_explanation: 'The superintendent is a district leader.',
  author: 'Reporter',
  contact_info: 'N/A',
  relevance_score: 5,
}, { ...basePrepared, title: 'Superintendent arrested for DUI in district vehicle' });
assert.equal(officialDui.sentiment, -0.65);
assert.equal(officialDui.innovation_flag, false);

const controlsExposeFraud = runFinalizer({
  summary: 'Strengthened internal controls and a new financial review process detected the embezzlement.',
  local_recommendation: 'Explain how the controls worked and what safeguards follow.',
  sentiment: -0.35,
  risk: 'High',
  tags: ['Operations & Finance'],
  strategic_alignment: 'Financial Efficiency',
  alignment_explanation: 'The district audit and strengthened controls uncovered the fraud.',
  author: 'Reporter',
  contact_info: 'N/A',
  relevance_score: 5,
}, { ...basePrepared, title: 'District audit uncovers embezzlement' });
assert.equal(controlsExposeFraud.sentiment, -0.1);
assert.equal(controlsExposeFraud.innovation_flag, true);
assert.match(controlsExposeFraud.innovation_reason, /Financial Efficiency/);

const biasComplaintOnly = runFinalizer({
  summary: 'A parent said anti-Black bias left her son feeling unsafe at school during a community forum.',
  local_recommendation: 'Acknowledge the concern and prepare a factual response.',
  sentiment: -0.6,
  risk: 'High',
  tags: ['Safety & Wellness', 'Engagement'],
  author: 'Reporter',
  contact_info: 'N/A',
  relevance_score: 5,
  strategic_alignment: 'Safe, Supported, Included, and Empowered',
  alignment_explanation: 'The concern relates to the district goal of creating a safe environment.',
}, {
  ...basePrepared,
  title: 'Parent says anti-Black bias left son feeling unsafe at school',
  data: 'A parent described alleged anti-Black bias and said her son felt unsafe. The report documents the family concern but no affirmative district action.',
});
assert.equal(biasComplaintOnly.innovation_flag, false);
assert.equal(biasComplaintOnly.innovation_reason, 'N/A');

const negatedBiasResponse = runFinalizer({
  summary: 'Parents alleged racial bias, and the district has not responded to the complaint.',
  local_recommendation: 'Acknowledge the concern and establish a response plan.',
  sentiment: -0.5,
  risk: 'High',
  tags: ['Safety & Wellness', 'Engagement'],
  author: 'Reporter',
  contact_info: 'N/A',
  relevance_score: 5,
  strategic_alignment: 'Safe, Supported, Included, and Empowered',
  alignment_explanation: 'The concern relates to the district safety goal.',
}, {
  ...basePrepared,
  title: 'Parents allege racial bias; district has not responded',
  data: 'Parents alleged racial bias. The district has not responded to the complaint.',
});
assert.equal(negatedBiasResponse.innovation_flag, false);
assert.equal(negatedBiasResponse.innovation_reason, 'N/A');

const noInvestigationLaunched = runFinalizer({
  summary: 'The district said no investigation was launched after parents alleged racial bias.',
  local_recommendation: 'Clarify whether an investigation will begin.',
  sentiment: -0.5,
  risk: 'High',
  tags: ['Safety & Wellness', 'Engagement'],
  author: 'Reporter',
  contact_info: 'N/A',
  relevance_score: 5,
  strategic_alignment: 'Safe, Supported, Included, and Empowered',
  alignment_explanation: 'The report concerns the district safety goal.',
}, {
  ...basePrepared,
  title: 'Parents allege racial bias; no investigation launched',
  data: 'The district said no investigation was launched after parents alleged racial bias.',
});
assert.equal(noInvestigationLaunched.innovation_flag, false);
assert.equal(noInvestigationLaunched.innovation_reason, 'N/A');

const parentReportedDistrictInactive = runFinalizer({
  summary: 'Parents reported racial bias, and the district has not responded to the complaint.',
  local_recommendation: 'Acknowledge the concern and establish a response plan.',
  sentiment: -0.5,
  risk: 'High',
  tags: ['Safety & Wellness', 'Engagement'],
  author: 'Reporter',
  contact_info: 'N/A',
  relevance_score: 5,
  strategic_alignment: 'Safe, Supported, Included, and Empowered',
  alignment_explanation: 'The report concerns the district safety goal.',
}, {
  ...basePrepared,
  title: 'Parents report racial bias; district has not responded',
  data: 'Parents reported racial bias, and the district has not responded to the complaint.',
});
assert.equal(parentReportedDistrictInactive.innovation_flag, false);
assert.equal(parentReportedDistrictInactive.innovation_reason, 'N/A');

const biasResponseWithAction = runFinalizer({
  summary: 'The district implemented a new anti-bias response protocol and staff training after community feedback.',
  local_recommendation: 'Explain the implementation and publish measurable follow-up milestones.',
  sentiment: 0.1,
  risk: 'Medium',
  tags: ['Safety & Wellness', 'Engagement'],
  author: 'Reporter',
  contact_info: 'N/A',
  relevance_score: 5,
  strategic_alignment: 'Safe, Supported, Included, and Empowered',
  alignment_explanation: 'The district implemented a documented protocol and training program that advances the verified safety goal.',
}, {
  ...basePrepared,
  title: 'District implements anti-bias response protocol and staff training',
  data: 'The district implemented a new anti-bias response protocol and staff training after community feedback.',
});
assert.equal(biasResponseWithAction.innovation_flag, true);
assert.match(biasResponseWithAction.innovation_reason, /Safe, Supported, Included, and Empowered/);

console.log('Live ingestion interpretation guard checks passed.');

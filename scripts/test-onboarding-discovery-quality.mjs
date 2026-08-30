import assert from 'node:assert/strict';
import {
  assessDiscoveredTextQuality,
  sanitizeStrategicDocumentText,
  findMeaningfulSnippets,
  assertConfirmedOnboardingProfileQuality,
} from '../src/lib/onboarding-discovery-quality.mjs';

const centralKitsapNavigation = `
Central Kitsap School District - Strategic Plan Home Skip to main content Welcome Home Close Staff Hub New Student Registration Schools Popular Links
Home Our District Strategic Plan Annual Report Goals and Strategies Mission, Vision, Values Budget Information School Board Agendas and Minutes
School Info Calendar Graduation Safety Procedures Buses Health Services Lunch Breakfast Registration Learning Athletics Activities Employment
${'Popular Links Staff Hub New Student Registration Schools Home Our District '.repeat(55)}
Our Vision A vibrant and inclusive learning community where all students find their passion and achieve their dreams.
Our Mission Provide a high-quality Pre-K through 12th grade education to ensure all students graduate ready for careers, college, and life.
Strategic Goals All Students Achieve Their Full Potential Safe & Welcoming Learning Environments Pathways to Success Communication, Transparency & Stewardship
`;

const badAssessment = assessDiscoveredTextQuality(centralKitsapNavigation, { contentType: 'text/html' });
assert.equal(badAssessment.acceptable, false);
assert.match(badAssessment.reason, /navigation|boilerplate/i);
assert.equal(sanitizeStrategicDocumentText(centralKitsapNavigation, { contentType: 'text/html' }).text, '');
assert.throws(
  () => assertConfirmedOnboardingProfileQuality({
    mission_vision_values: centralKitsapNavigation,
    strategic_priorities: 'All Students Achieve Their Full Potential',
    strategic_plan_text: centralKitsapNavigation,
  }),
  /navigation|boilerplate/i,
);

const genericNavigation = `${'Home About Us Schools Departments Students Families Staff Board Calendar Contact Employment Registration Directory Search Menu '.repeat(18)} Mission Every learner succeeds.`;
assert.equal(
  assessDiscoveredTextQuality(genericNavigation, { contentType: 'text/html' }).acceptable,
  false,
  'generic navigation without vendor-specific markers must fail closed',
);
assert.throws(() => assertConfirmedOnboardingProfileQuality({
  mission_vision_values: genericNavigation,
  strategic_priorities: 'Academic achievement.',
}), /navigation|boilerplate/i);
const genericNavigationSnippets = findMeaningfulSnippets(genericNavigation, ['mission'], 4);
assert.deepEqual(
  genericNavigationSnippets,
  [],
  'generic navigation must fail closed after discovery truncates candidate snippets to 900 characters',
);

const officialPdfText = `Mission\nEvery student succeeds.\nVision\nA safe and welcoming community.\nStrategic Goal 1\nAcademic achievement.\nStrategic Goal 2\nCommunity engagement.`;
const goodAssessment = assessDiscoveredTextQuality(officialPdfText, { contentType: 'application/pdf' });
assert.equal(goodAssessment.acceptable, true);
assert.equal(sanitizeStrategicDocumentText(officialPdfText, { contentType: 'application/pdf' }).text, officialPdfText);
assert.doesNotThrow(() => assertConfirmedOnboardingProfileQuality({
  mission_vision_values: 'Mission: Every student succeeds. Vision: A safe and welcoming community.',
  strategic_priorities: 'Academic achievement. Community engagement.',
  strategic_plan_text: officialPdfText,
}));

const mixedWebsiteText = `${centralKitsapNavigation}\n\nMission: Every learner thrives.\nVision: Graduates ready for life.`;
const snippets = findMeaningfulSnippets(mixedWebsiteText, ['mission', 'vision'], 4);
assert.ok(snippets.every((snippet) => !/Skip to main content|Popular Links/i.test(snippet)));

console.log('Onboarding discovery quality tests passed.');

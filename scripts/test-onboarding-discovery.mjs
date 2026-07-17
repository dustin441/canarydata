import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const actions = await readFile(new URL('../src/app/actions.js', import.meta.url), 'utf8');
const onboarding = await readFile(new URL('../src/app/onboarding/page.js', import.meta.url), 'utf8');
const dashboard = await readFile(new URL('../src/app/dashboard/DashboardClient.js', import.meta.url), 'utf8');

assert.match(actions, /async function assertPublicUrl/);
assert.match(actions, /Private network URLs are not supported/);
assert.match(actions, /redirect: 'manual'/);
assert.match(actions, /await import\('unpdf'\)/);
assert.match(actions, /await import\('mammoth'\)/);
assert.match(actions, /strategic_plan_text: strategicPlanText/);
assert.match(actions, /strategic_plan_characters: strategicPlanText\.length/);
assert.match(actions, /normalizePublicDocumentUrl/);
assert.match(onboarding, /name="strategic_plan_url"/);
assert.match(onboarding, /name="strategic_plan_file"/);
assert.match(onboarding, /Full strategic plan text/);
assert.match(dashboard, /Set Up Your 30-Day Trial/);
assert.match(dashboard, /Start Trial Setup/);
assert.match(dashboard, /href="\/onboarding"/);
assert.doesNotMatch(dashboard, /demo-trial-request/);
assert.doesNotMatch(dashboard, /Notify Me When Canary Data Launches/);

console.log('Onboarding discovery tests passed.');

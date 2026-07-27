import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertStrategicPlanFileSize, MAX_STRATEGIC_PLAN_FILE_BYTES } from '../src/lib/onboarding-upload.mjs';

const actions = await readFile(new URL('../src/app/actions.js', import.meta.url), 'utf8');
const onboarding = await readFile(new URL('../src/app/onboarding/page.js', import.meta.url), 'utf8');
const dashboard = await readFile(new URL('../src/app/dashboard/DashboardClient.js', import.meta.url), 'utf8');
const { default: nextConfig } = await import('../next.config.mjs');

const advertisedFileLimit = 4 * 1024 * 1024;
const productionFailureFileSize = 4_085_975;

assert.match(actions, /async function assertPublicUrl/);
assert.match(actions, /Private network URLs are not supported/);
assert.match(actions, /redirect: 'manual'/);
assert.match(actions, /await import\('unpdf'\)/);
assert.match(actions, /await import\('mammoth'\)/);
assert.match(actions, /strategic_plan_text: strategicPlanText/);
assert.match(actions, /strategic_plan_characters: strategicPlanText\.length/);
assert.match(actions, /normalizePublicDocumentUrl/);
assert.equal(nextConfig.experimental?.serverActions?.bodySizeLimit, '4.5mb');
assert.equal(MAX_STRATEGIC_PLAN_FILE_BYTES, advertisedFileLimit);
assert.ok(productionFailureFileSize <= advertisedFileLimit, 'the known 4,085,975-byte PDF must fit the upload limit');
assert.doesNotThrow(() => assertStrategicPlanFileSize({ size: productionFailureFileSize }));
assert.throws(
  () => assertStrategicPlanFileSize({ size: advertisedFileLimit + 1 }),
  /Document is too large \(4 MB maximum\)/,
);
assert.match(actions, /assertStrategicPlanFileSize\(strategicPlanFile\);\s+try/);
assert.match(onboarding, /assertStrategicPlanFileSize\(strategicPlanFile\)/);
assert.match(onboarding, /PDF, DOCX, TXT, or Markdown · 4 MB maximum/);
assert.match(onboarding, /name="strategic_plan_url"/);
assert.match(onboarding, /name="strategic_plan_file"/);
assert.match(onboarding, /Full strategic plan text/);
assert.match(dashboard, /Set Up Your 30-Day Trial/);
assert.match(dashboard, /Start Trial Setup/);
assert.match(dashboard, /href="\/onboarding"/);
assert.doesNotMatch(dashboard, /demo-trial-request/);
assert.doesNotMatch(dashboard, /Notify Me When Canary Data Launches/);

console.log('Onboarding discovery tests passed.');

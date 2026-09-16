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
assert.match(onboarding, /Full strategic plan, narrative, focus areas, or goals text/);
assert.ok(onboarding.includes('Design Your Canary Data Evaluation'));
assert.match(onboarding, /className="auth-subtitle" style=\{\{ textAlign: 'left', display: 'grid', gap: '0\.85rem' \}\}/, 'intro paragraphs must have explicit visible spacing');
assert.equal((onboarding.match(/<p style=\{\{ margin: 0 \}\}>/g) || []).length, 3, 'each intro paragraph must reset the inherited margin so grid gap controls spacing');
assert.ok(onboarding.includes('Think of this intake as designing your Canary Data evaluation. The schools, accounts, sources and information you provide will determine what Canary monitors during your 30-day trial.'));
assert.ok(onboarding.includes('Please set aside approximately 15–20 minutes to complete this form thoughtfully and accurately. Include the district, schools, social accounts, news sources and other information you want Canary Data to monitor so your trial reflects the communications landscape you want to evaluate.'));
assert.ok(onboarding.includes('Your trial environment will be configured based on this submission. During the trial, we’re happy to correct factual errors or address information that did not populate as submitted. Additional schools, sources, accounts or other preference-based configuration changes can be made if you choose to become a Canary Data customer.'));
assert.ok(onboarding.includes('Before you submit'));
assert.ok(onboarding.includes('I have reviewed the information I’ve provided and understand that my 30-day trial will be configured based on this submission. I understand that factual errors or information that does not populate as submitted can be corrected during the trial, while additional or preference-based configuration changes can be made after purchase.'));
assert.match(onboarding, /Your 30-day trial starts when access is granted/);
assert.match(onboarding, /name="billing_phone"[^>]*required/);
assert.match(onboarding, /full official profile or page URLs/i);
assert.match(onboarding, /name="district_news_url"/);
assert.match(onboarding, /name="frequent_news_outlets"/);
assert.match(onboarding, /strategic plan, narrative, focus areas, or goals/i);
assert.match(onboarding, /name="setup_confirmation"[^>]*required/);
assert.match(actions, /setup_confirmation/);
assert.match(actions, /You must confirm that the setup is accurate/i, 'final confirmation must be enforced by the server action');
assert.match(actions, /billing_phone: cleanFormValue\(formData, 'billing_phone'\)/);
assert.match(actions, /if \(!request\.billing_phone\)/, 'phone must be required server-side');
assert.match(actions, /district_news_url/);
assert.match(actions, /frequent_news_outlets/);
assert.match(dashboard, /Set Up Your 30-Day Trial/);
assert.match(dashboard, /Start Trial Setup/);
assert.match(dashboard, /href="\/onboarding"/);
assert.doesNotMatch(dashboard, /demo-trial-request/);
assert.doesNotMatch(dashboard, /Notify Me When Canary Data Launches/);

console.log('Onboarding discovery tests passed.');

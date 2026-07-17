import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const files = [
  '../src/lib/billing.js',
  '../src/lib/billing-documents.js',
  '../src/lib/payment-state.js',
  '../src/app/payment/actions.js',
  '../src/app/dashboard/page.js',
];
const source = (await Promise.all(files.map(async (file) => readFile(new URL(file, import.meta.url), 'utf8')))).join('\n');
const sensitiveUserMetadata = /user_metadata\?*\.?(?:payment_status|payment_paid_at|paid_through|access_status|trial_status|trial_starts_at|trial_ends_at|stripe_customer_id|stripe_checkout_session_id|district_id)/;
assert.equal(sensitiveUserMetadata.test(source), false, 'security-sensitive state must not be read from user_metadata');
assert.match(source, /app_metadata/, 'protected app_metadata must be used for authorization state');

const dashboard = await readFile(new URL('../src/app/dashboard/page.js', import.meta.url), 'utf8');
assert.match(dashboard, /app_metadata\?\.role === 'admin'/);
assert.match(dashboard, /if \(!userDistrictId && !isAdmin\) redirect/);

const actions = await readFile(new URL('../src/app/actions.js', import.meta.url), 'utf8');
assert.match(actions, /async function requireCanaryActor/);
assert.match(actions, /function assertDistrictAccess/);
for (const action of ['setEarnedMedia', 'saveNote', 'addQuery', 'deleteQuery', 'submitFeedback']) {
  const start = actions.indexOf(`export async function ${action}`);
  assert.notEqual(start, -1, `${action} must exist`);
  assert.match(actions.slice(start, start + 350), /requireCanaryActor/, `${action} must authenticate and authorize the caller`);
}

console.log('Authorization metadata regression tests passed.');

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
for (const action of ['addQuery', 'deleteQuery']) {
  const start = actions.indexOf(`export async function ${action}`);
  assert.match(actions.slice(start, start + 2500), /assertDistrictAccess\(actor,/, `${action} must enforce district access`);
}
const addQueryStart = actions.indexOf('export async function addQuery');
const deleteQueryStart = actions.indexOf('export async function deleteQuery');
assert.match(actions.slice(addQueryStart, deleteQueryStart), /CUSTOMER_SEARCH_QUERY_LIMIT/, 'customer query additions must enforce the account limit');
assert.match(actions.slice(addQueryStart, deleteQueryStart), /customerSearchQuerySlotId/, 'customer additions must claim deterministic query slots so concurrent writes cannot exceed the cap');
assert.match(actions.slice(deleteQueryStart, deleteQueryStart + 700), /update\(\{ active: false \}\)/, 'removing a query must archive it instead of deleting history');
assert.match(actions.slice(deleteQueryStart, deleteQueryStart + 700), /query\.channels !== 'news'/, 'customers must not be able to remove admin-managed advanced queries');

const dashboardClient = await readFile(new URL('../src/app/dashboard/DashboardClient.js', import.meta.url), 'utf8');
assert.match(dashboardClient, /const canManageQueries = !demoMode/);
assert.match(dashboardClient, /News query usage/);
assert.match(dashboardClient, /Query limit reached/);
assert.match(dashboardClient, /Managed by Canary/);
assert.match(dashboardClient, /role="alert"/);

console.log('Authorization metadata regression tests passed.');

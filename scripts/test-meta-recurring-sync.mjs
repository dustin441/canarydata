import assert from 'node:assert/strict';
import fs from 'node:fs';

const routeUrl = new URL('../src/app/api/cron/meta-eic-sync/route.js', import.meta.url);
const helpersUrl = new URL('../src/lib/meta-recurring-sync.mjs', import.meta.url);
const serviceUrl = new URL('../src/lib/meta-sync-service.mjs', import.meta.url);
const ownedSyncUrl = new URL('../src/lib/meta-owned-sync.mjs', import.meta.url);
const middlewareUrl = new URL('../src/lib/supabase/middleware.js', import.meta.url);
const manualRouteUrl = new URL('../src/app/api/integrations/meta/sync/route.js', import.meta.url);
const vercelUrl = new URL('../vercel.json', import.meta.url);

for (const url of [routeUrl, helpersUrl, vercelUrl]) {
  assert.ok(fs.existsSync(url), `${url.pathname.split('/').at(-1)} must exist.`);
}

const route = fs.readFileSync(routeUrl, 'utf8');
const service = fs.readFileSync(serviceUrl, 'utf8');
const middleware = fs.readFileSync(middlewareUrl, 'utf8');
const manualRoute = fs.readFileSync(manualRouteUrl, 'utf8');
const vercel = JSON.parse(fs.readFileSync(vercelUrl, 'utf8'));
const helpers = await import(helpersUrl);
const syncService = await import(serviceUrl);
const ownedSync = await import(ownedSyncUrl);

assert.match(route, /export const runtime = ['"]nodejs['"]/);
assert.match(route, /export const maxDuration = 60/);
assert.match(route, /export const dynamic = ['"]force-dynamic['"]/);
assert.match(route, /export async function GET\(request\)/);
assert.doesNotMatch(route, /export async function POST/);
assert.match(route, /META_EIC_SYNC_CONNECTION_ID/);
assert.match(route, /canary-lesley-test-district/);
assert.match(route, /metaIntegrationEnabledForDistrict\(EIC_DISTRICT_ID\)/);
assert.match(route, /createAdminClient\(\)/);
assert.match(route, /syncSelectedMetaAssets\(\{/);
assert.match(route, /pilotItemLimit: null/);
assert.match(route, /contentMetricRefreshDays: 14/);
assert.doesNotMatch(route, /sourceCutoff:/, 'Cron must not provide a caller-controlled source cutoff.');
assert.doesNotMatch(route, /request\.json|searchParams|get\(['"]district|platforms?:|body\?\./, 'Request input must not control sync scope.');
assert.match(route, /\.eq\(['"]id['"], connectionId\).*\.eq\(['"]district_id['"], EIC_DISTRICT_ID\).*\.eq\(['"]provider['"], ['"]meta['"]\)/s);
assert.match(route, /connection\.status !== ['"]active['"]/);
assert.match(route, /provider_app_id/);
assert.doesNotMatch(route, /runId|provider_user_id|error_summary/, 'Responses and logs must not expose run, provider, or error details.');

assert.equal(helpers.isAuthorizedCronRequest('Bearer top-secret', 'top-secret'), true);
assert.equal(helpers.isAuthorizedCronRequest('Bearer top-secret ', 'top-secret'), false);
assert.equal(helpers.isAuthorizedCronRequest('bearer top-secret', 'top-secret'), false);
assert.equal(helpers.isAuthorizedCronRequest('Bearer wrong', 'top-secret'), false);
assert.equal(helpers.isAuthorizedCronRequest('Bearer anything', ''), false);
assert.equal(helpers.isAuthorizedCronRequest('', undefined), false);

const now = new Date('2026-08-20T12:00:00.000Z');
assert.deepEqual(helpers.recurringMetaSyncDecision({ status: 'success', completed_at: '2026-08-19T17:00:01.000Z' }, now), { run: false, reason: 'healthy_cadence' });
assert.deepEqual(helpers.recurringMetaSyncDecision({ status: 'empty', completed_at: '2026-08-19T16:00:00.000Z' }, now), { run: true });
assert.deepEqual(helpers.recurringMetaSyncDecision({ status: 'partial', completed_at: '2026-08-20T11:59:00.000Z', next_cursor: { facebook: { after: null, completed: [] } } }, now), { run: true });
assert.deepEqual(helpers.recurringMetaSyncDecision({ status: 'partial', completed_at: '2026-08-20T11:59:00.000Z', next_cursor: {} }, now), { run: false, reason: 'partial_without_continuation' });
assert.deepEqual(helpers.recurringMetaSyncDecision({ status: 'failed', completed_at: '2026-08-20T11:45:01.000Z' }, now), { run: false, reason: 'failure_cooldown' });
assert.deepEqual(helpers.recurringMetaSyncDecision({ status: 'failed', completed_at: '2026-08-20T11:45:00.000Z' }, now), { run: true });
assert.deepEqual(helpers.recurringMetaSyncDecision(null, now), { run: true });

const safe = helpers.sanitizeMetaSyncResult({ status: 'partial', accountsAttempted: 2, accountsSucceeded: 1, postsRead: 100, rejectedItems: 1, providerErrors: 0, duplicateItems: 50, metricRowsWritten: 25, continuationRequired: true, runId: 'secret-run', connectionId: 'secret-connection', errors: ['secret'] });
assert.deepEqual(Object.keys(safe).sort(), ['continuation', 'counts', 'status']);
assert.equal(safe.status, 'partial');
assert.equal(safe.continuation, true);
assert.deepEqual(Object.keys(safe.counts).sort(), ['accountsAttempted', 'accountsSucceeded', 'duplicateItems', 'metricRowsWritten', 'postsRead', 'providerErrors', 'rejectedItems']);
assert.doesNotMatch(JSON.stringify(safe), /secret|runId|connectionId|errors/);
assert.deepEqual(helpers.sanitizeMetaSyncResult({ status: 'skipped' }), {
  status: 'skipped',
  counts: { accountsAttempted: 0, accountsSucceeded: 0, postsRead: 0, rejectedItems: 0, providerErrors: 0, duplicateItems: 0, metricRowsWritten: 0 },
  continuation: false,
});
assert.equal(helpers.sanitizeMetaSyncResult({ status: 'failed' }).status, 'failed', 'complete provider failure must remain visible to the cron route');
assert.match(route, /result\.status === ['"]failed['"] \? 503 : 200/, 'a failed provider run must return a non-2xx HTTP status');

assert.match(middleware, /request\.nextUrl\.pathname === ['"]\/api\/cron\/meta-eic-sync['"]/);
assert.doesNotMatch(middleware, /startsWith\(['"]\/api\/cron|\/api\/cron\/meta-eic-sync\//, 'Cron middleware exemption must be exact, not prefix-based.');
assert.match(manualRoute, /Native Meta synchronization is not released\./);
assert.match(manualRoute, /status: 503/);
assert.doesNotMatch(manualRoute, /syncSelectedMetaAssets/);
assert.deepEqual(vercel.crons, [{ path: '/api/cron/meta-eic-sync', schedule: '15 * * * *' }]);

assert.equal(syncService.validateContentMetricRefreshDays(undefined), 14);
assert.equal(syncService.validateContentMetricRefreshDays(1), 1);
assert.equal(syncService.validateContentMetricRefreshDays(30), 30);
for (const invalid of [null, 0, 31, 1.5, '14', Number.NaN]) {
  assert.throws(() => syncService.validateContentMetricRefreshDays(invalid), /content metric refresh days/i);
}
const cutoff = new Date('2026-08-06T12:00:00.000Z');
assert.equal(syncService.shouldRefreshMetaContentInsights({ exists: true, hasContentMetrics: true, publishedAt: '2026-08-06T11:59:59.000Z', cutoff }), false, 'An old duplicate with initial metrics must skip content Insights.');
assert.equal(syncService.shouldRefreshMetaContentInsights({ exists: false, publishedAt: '2026-01-01T00:00:00.000Z', cutoff }), true, 'A newly discovered old post must fetch content Insights.');
assert.equal(syncService.shouldRefreshMetaContentInsights({ exists: true, hasContentMetrics: false, publishedAt: '2026-01-01T00:00:00.000Z', cutoff }), true, 'An old observation whose first metric attempt failed must retry Insights.');
assert.equal(syncService.shouldRefreshMetaContentInsights({ exists: true, hasContentMetrics: true, publishedAt: '2026-08-06T12:00:00.000Z', cutoff }), true, 'A recent duplicate must refresh content Insights.');
assert.equal(syncService.shouldRefreshMetaContentInsights({ exists: true, hasContentMetrics: true, publishedAt: 'invalid', cutoff }), true, 'Unknown dates must fail open to metric refresh.');
assert.deepEqual(syncService.normalizeMetaPageContinuation('legacy-cursor'), { after: 'legacy-cursor', completed: [] });
const completedA = syncService.metaPageItemIdentity('item-a');
const page = syncService.normalizeMetaPageContinuation({ after: 'page-input', completed: [completedA, 'invalid'] });
assert.deepEqual(page, { after: 'page-input', completed: [completedA] });
const continued = syncService.metaPageContinuationAt(page, [syncService.metaPageItemIdentity('item-b')]);
assert.deepEqual(syncService.remainingMetaPageItems([{ id: 'item-new' }, { id: 'item-a' }, { id: 'item-b' }, { id: 'item-c' }], continued).map((item) => item.id), ['item-new', 'item-c'], 'insertions and reorderings must not cause completed identities or new unprocessed identities to be skipped');
assert.equal(ownedSync.continuedMetaSourceCutoff('2026-05-22T12:00:00.000Z', new Date('2026-08-20T12:00:00.000Z')), '2026-05-22T12:00:00.000Z');
assert.equal(ownedSync.continuedMetaSourceCutoff('2026-05-22T12:00:00.000Z', new Date('2026-08-20T13:00:00.000Z')), '2026-05-22T12:00:00.000Z', 'hourly continuation must preserve the exact original source cutoff');
assert.match(service, /social_provider_metric_snapshots/);
assert.match(service, /hasContentMetrics/);
assert.match(service, /remainingMetaPageItems\(providerRows, page\)/);
assert.match(service, /nextCursor\[asset\.id\] = metaPageContinuationAt\(page, \[\.\.\.completedThisPage\]\)/);
assert.match(service, /nextCursor\[asset\.id\] = \{ after: pageNextAfter, completed: \[\] \}/);
assert.match(service, /if \(!shouldRefreshMetaContentInsights\([\s\S]*?writtenCount \+= 1;[\s\S]*?continue;/, 'Old duplicates with metrics must count as written progress after canonical observation refresh and skip content Insights.');

console.log('Meta recurring-sync route, cadence, sanitization, and replay tests passed.');

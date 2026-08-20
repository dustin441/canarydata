import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  EIC_DISTRICT,
  EIC_SINCE,
  EIC_UNTIL,
  buildConfirmation,
  buildScopeFingerprint,
  buildSourceFingerprint,
  exclusiveDayAfter,
  parseBackfillArgs,
  saveCheckpointAtomic,
  validateBackfillOptions,
} from './backfill-meta-owned-social.mjs';

const required = [
  '--district', EIC_DISTRICT,
  '--connection-id', '10000000-0000-4000-8000-000000000001',
  '--expected-provider-user-hash', 'a'.repeat(64),
  '--since', EIC_SINCE,
  '--until', EIC_UNTIL,
  '--checkpoint', '/tmp/eic-meta-backfill.json',
];
const dryRun = parseBackfillArgs(required);
assert.equal(dryRun.execute, false, 'dry-run must be the default');
assert.equal(dryRun.maxItems, 10);
assert.equal(validateBackfillOptions(dryRun).district, EIC_DISTRICT);
assert.equal(exclusiveDayAfter(EIC_UNTIL), '2026-08-21T00:00:00.000Z');
assert.throws(() => validateBackfillOptions({ ...dryRun, district: 'another-district' }), /exact EIC test district/i);
assert.throws(() => validateBackfillOptions({ ...dryRun, since: '2026-01-02' }), /approved EIC YTD window/i);
assert.throws(() => validateBackfillOptions({ ...dryRun, until: '2026-08-19' }), /approved EIC YTD window/i);
assert.throws(() => validateBackfillOptions({ ...dryRun, maxItems: 0 }), /between 1 and 20/i);
assert.throws(() => validateBackfillOptions({ ...dryRun, maxItems: 21 }), /between 1 and 20/i);

const executeOptions = { ...dryRun, expectedScopeHash: 'b'.repeat(64) };
const confirmation = buildConfirmation(executeOptions);
assert.doesNotMatch(confirmation, /a{16}/, 'confirmation must not contain the provider hash');
assert.throws(() => validateBackfillOptions({ ...dryRun, execute: true, confirm: 'wrong' }), /scope hash/i);
assert.throws(() => validateBackfillOptions({ ...executeOptions, execute: true, confirm: 'wrong' }), /confirmation/i);
assert.equal(validateBackfillOptions({ ...executeOptions, execute: true, confirm: confirmation }).execute, true);

const sourceA = [
  { assetKey: 'facebook:page-hash', itemKey: 'facebook:item-hash', publishedAt: '2026-01-03T00:00:00Z', sourceHash: '1'.repeat(64) },
  { assetKey: 'instagram:account-hash', itemKey: 'instagram:item-hash', publishedAt: '2026-08-20T23:59:59Z', sourceHash: '2'.repeat(64) },
];
const sourceB = [...sourceA].reverse();
assert.equal(buildSourceFingerprint(sourceA), buildSourceFingerprint(sourceB), 'fingerprint must be deterministic across pagination ordering');
assert.equal(buildSourceFingerprint(sourceA), buildSourceFingerprint([{ ...sourceA[0], publishedAt: '2026-02-03T00:00:00Z', sourceHash: '3'.repeat(64) }, sourceA[1]]), 'fingerprint must remain identity-only when mutable source values change');
assert.notEqual(buildSourceFingerprint(sourceA), buildSourceFingerprint([{ ...sourceA[0], itemKey: 'facebook:different-item' }, sourceA[1]]), 'fingerprint must cover exact source identities');
const scopeAssets = [{ id:'asset-1', provider_asset_id:'provider-1', parent_provider_asset_id:null, asset_type:'facebook_page', platform:'facebook' }];
const scopeLinks = [{ id:'link-1', provider_asset_id:'asset-1', social_account_id:'account-1' }];
assert.equal(buildScopeFingerprint(scopeAssets, scopeLinks), buildScopeFingerprint(scopeAssets, scopeLinks));
assert.notEqual(buildScopeFingerprint(scopeAssets, scopeLinks), buildScopeFingerprint(scopeAssets, [{ ...scopeLinks[0], social_account_id:'account-2' }]));

const temp = await mkdtemp(path.join(tmpdir(), 'canary-meta-backfill-'));
const checkpointPath = path.join(temp, 'checkpoint.json');
await saveCheckpointAtomic(checkpointPath, { version: 1, status: 'partial', items: {} });
assert.equal((await stat(checkpointPath)).mode & 0o777, 0o600, 'checkpoint must be owner-readable/writable only');
assert.deepEqual(JSON.parse(await readFile(checkpointPath, 'utf8')), { version: 1, status: 'partial', items: {} });

const source = await readFile(new URL('./backfill-meta-owned-social.mjs', import.meta.url), 'utf8');
for (const name of [
  'canary_fenced_link_selected_meta_assets',
  'canary_fenced_ingest_owned_social_observation',
  'canary_fenced_upsert_meta_metric_snapshots',
]) assert.ok(source.includes(name), `operator CLI must call ${name}`);
assert.ok(source.includes("published_posts"));
assert.ok(source.includes("/media"));
assert.ok(source.includes('since: options.since'));
assert.ok(source.includes('until: options.until'));
assert.ok(source.includes('until: exclusiveDayAfter(options.until)'), 'Meta must receive the exclusive next-day boundary for the inclusive approved end date');
assert.ok(source.includes("graphAllFixed('me/accounts', accessToken, { fields: PAGE_FIELDS })"), 'Page-grant discovery must not receive content-window parameters');
assert.ok(source.includes('.map(({ assetKey, itemKey }) => ({ assetKey, itemKey }))'), 'checkpoint fingerprinting must use stable identities only');
assert.ok(!source.includes('sha256(canonical(row))'), 'mutable provider rows must not invalidate a resumable checkpoint');
assert.ok(source.includes('source: rawByItem.get(item.itemKey).row'), 'the owner-only checkpoint must freeze the first provider source snapshot');
assert.ok(source.includes('checkpoint.activeRunId = runId'));
assert.ok(source.indexOf("checkpoint.status = 'finalizing'") < source.indexOf('await finishRun(admin, runId'), 'checkpoint must enter finalizing before the database run is finalized');
assert.ok(!source.includes('boundedMetaSourceCutoff'), 'operator backfill must never use the recurring 90-day helper');
assert.ok(source.includes("open(tempPath, 'wx', 0o600)"));
assert.ok(source.includes('rename(tempPath, checkpointPath)'), 'checkpoint replacement must be atomic');
assert.ok(source.includes('debugMetaToken'));
assert.ok(source.includes('metaGrantedScopes'));
assert.ok(source.includes('lease_expires_at'));
assert.ok(source.includes('heartbeat_at'));
assert.ok(source.includes('already complete'));
assert.doesNotMatch(source, /console\.(?:log|error)\([^\n]*(?:accessToken|provider_user_id|connectionId|external_thread_id|body)/, 'stdout/stderr must not print secrets, provider IDs, connection IDs, or bodies');

console.log('Meta EIC checkpointed backfill tests passed.');

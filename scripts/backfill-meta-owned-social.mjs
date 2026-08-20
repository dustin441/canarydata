#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { debugMetaToken, decryptMetaToken, metaGrantedScopes, metaGraph, metaGraphBatch } from '../src/lib/meta-integration.mjs';
import { mapFacebookPagePosts, mapInstagramMedia, validateMetaSyncSelection } from '../src/lib/meta-owned-sync.mjs';
import {
  facebookAccountInsightRequests,
  facebookContentInsightRequests,
  instagramAccountInsightRequests,
  instagramContentInsightRequests,
  isMetaUnsupportedMetricError,
  normalizeMetaInsightBatch,
  sevenDayInsightWindow,
} from '../src/lib/meta-insights.mjs';

export const EIC_DISTRICT = 'canary-lesley-test-district';
export const EIC_SINCE = '2026-01-01';
export const EIC_UNTIL = '2026-08-20';
const CHECKPOINT_VERSION = 1;
const PAGE_FIELDS = 'id,access_token,tasks';
const POST_FIELDS = 'id,message,story,created_time,permalink_url,from';
const MEDIA_FIELDS = 'id,caption,media_type,media_product_type,permalink,timestamp,username,comments_count,like_count';
const REQUIRED = ['district', 'connectionId', 'expectedProviderUserHash', 'since', 'until', 'checkpoint'];

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function assetKeyFor(asset) {
  return `${asset.platform}:${sha256(asset.provider_asset_id)}`;
}

export function exclusiveDayAfter(date) {
  const boundary = new Date(`${date}T00:00:00.000Z`);
  boundary.setUTCDate(boundary.getUTCDate() + 1);
  return boundary.toISOString();
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function buildSourceFingerprint(records) {
  const sorted = records
    .map(({ assetKey, itemKey }) => ({ assetKey, itemKey }))
    .sort((a, b) => canonical(a).localeCompare(canonical(b)));
  return sha256(canonical(sorted));
}

export function buildScopeFingerprint(assets, links) {
  const linkByAsset = new Map(links.map((link) => [link.provider_asset_id, link]));
  return sha256(canonical(assets.map((asset) => {
    const link = linkByAsset.get(asset.id);
    return {
      assetId: asset.id,
      providerAssetId: asset.provider_asset_id,
      parentProviderAssetId: asset.parent_provider_asset_id || null,
      assetType: asset.asset_type,
      platform: asset.platform,
      linkId: link?.id || null,
      socialAccountId: link?.social_account_id || null,
    };
  }).sort((a, b) => canonical(a).localeCompare(canonical(b)))));
}

export function buildConfirmation(options) {
  return `EIC_META_BACKFILL:${options.district}:${options.connectionId}:${options.since}:${options.until}:${options.expectedScopeHash}`;
}

export function parseBackfillArgs(argv) {
  const values = { execute: false, confirm: null, maxItems: 10 };
  const names = {
    '--district': 'district', '--connection-id': 'connectionId',
    '--expected-provider-user-hash': 'expectedProviderUserHash', '--since': 'since',
    '--until': 'until', '--checkpoint': 'checkpoint', '--confirm': 'confirm', '--max-items': 'maxItems',
    '--expected-scope-hash': 'expectedScopeHash',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--execute') { values.execute = true; continue; }
    const name = names[arg];
    if (!name) throw new Error('Unknown operator option.');
    const value = argv[index += 1];
    if (!value || value.startsWith('--')) throw new Error(`A value is required for ${arg}.`);
    values[name] = name === 'maxItems' ? Number(value) : value;
  }
  return values;
}

export function validateBackfillOptions(input) {
  const options = { ...input };
  for (const name of REQUIRED) if (!options[name]) throw new Error(`Required operator option is missing: ${name}.`);
  if (options.district !== EIC_DISTRICT) throw new Error('Backfill is restricted to the exact EIC test district.');
  if (options.since !== EIC_SINCE || options.until !== EIC_UNTIL) throw new Error('Backfill is restricted to the approved EIC YTD window.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(options.connectionId)) throw new Error('Connection ID must be a UUID.');
  options.expectedProviderUserHash = String(options.expectedProviderUserHash).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(options.expectedProviderUserHash)) throw new Error('Expected provider-user hash must be SHA-256 hex.');
  for (const name of ['since', 'until']) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(options[name]) || Number.isNaN(Date.parse(`${options[name]}T00:00:00.000Z`))) throw new Error(`${name} must be an ISO calendar date.`);
  }
  if (options.until < options.since) throw new Error('Backfill until must not precede since.');
  if (!Number.isInteger(options.maxItems) || options.maxItems < 1 || options.maxItems > 20) throw new Error('Max items must be between 1 and 20.');
  if (options.expectedScopeHash != null && !/^[0-9a-f]{64}$/i.test(options.expectedScopeHash)) throw new Error('Expected scope hash must be SHA-256 hex.');
  if (options.execute && !options.expectedScopeHash) throw new Error('Execute requires the dry-run selected-asset scope hash.');
  if (options.expectedScopeHash) options.expectedScopeHash = options.expectedScopeHash.toLowerCase();
  options.checkpoint = path.resolve(options.checkpoint);
  if (options.execute && options.confirm !== buildConfirmation(options)) throw new Error('Execute confirmation does not match the exact district/connection/window binding.');
  return options;
}

export async function saveCheckpointAtomic(checkpointPath, checkpoint) {
  await mkdir(path.dirname(checkpointPath), { recursive: true });
  const tempPath = `${checkpointPath}.tmp-${process.pid}-${Date.now()}`;
  let handle;
  try {
    handle = await open(tempPath, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await chmod(tempPath, 0o600);
    await rename(tempPath, checkpointPath);
    await chmod(checkpointPath, 0o600);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await rm(tempPath, { force: true }).catch(() => {});
  }
}

async function loadCheckpoint(checkpointPath) {
  try {
    const raw = await readFile(checkpointPath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new Error('Checkpoint could not be read.');
  }
}

function requireData(result, message) {
  if (result.error) throw new Error(message, { cause: result.error });
  if (result.data == null) throw new Error(message);
  return result.data;
}

async function graphAllFixed(pathname, token, options) {
  const rows = [];
  const cursors = new Set();
  const params = {
    fields: options.fields,
    limit: '100',
    ...(options.since && options.until ? { since: options.since, until: options.until } : {}),
  };
  let after = null;
  for (let page = 0; page < 1000; page += 1) {
    const payload = await metaGraph(pathname, token, { ...params, ...(after ? { after } : {}) });
    rows.push(...(Array.isArray(payload?.data) ? payload.data : []));
    if (!payload?.paging?.next) return rows;
    const next = payload?.paging?.cursors?.after;
    if (!next || cursors.has(next)) throw new Error('Meta source pagination did not converge deterministically.');
    cursors.add(next);
    after = next;
  }
  throw new Error('Meta source pagination exceeded the fixed safety ceiling.');
}

function inFixedWindow(value, since, until) {
  const day = new Date(value).toISOString().slice(0, 10);
  return day >= since && day <= until;
}

async function persistMetrics({ admin, link, threadId = null, platform, metricScope, providerObjectId, requests, token, observedAt }) {
  const results = await metaGraphBatch(requests, token);
  const fatal = results.find((result) => !result.ok && !isMetaUnsupportedMetricError(result));
  if (fatal) throw new Error('Meta authorization or metric request failed.');
  const metrics = normalizeMetaInsightBatch({ platform, metricScope, providerObjectId, requests, results, observedAt });
  if (!metrics.length) return 0;
  const result = await admin.rpc('canary_fenced_upsert_meta_metric_snapshots', {
    p_provider_account_link_id: link.id, p_social_thread_id: threadId, p_metrics: metrics,
  });
  const count = requireData(result, 'Fenced metric persistence failed.');
  if (Number(count) !== metrics.length) throw new Error('Metric persistence count did not converge.');
  return metrics.length;
}

async function heartbeat(admin, runId, checkpoint, counts) {
  const now = new Date();
  const result = await admin.from('social_sync_runs').update({
    heartbeat_at: now.toISOString(), lease_expires_at: new Date(now.getTime() + 300_000).toISOString(),
    posts_read: counts.items, metric_rows_written: counts.metrics,
    diagnostics: { mode: 'eic_checkpointed_ytd_backfill', checkpoint_status: checkpoint.status },
  }).eq('id', runId).eq('status', 'running').select('id').maybeSingle();
  requireData(result, 'Backfill heartbeat failed.');
}

async function finishRun(admin, runId, status, counts, options) {
  const result = await admin.from('social_sync_runs').update({
    completed_at: new Date().toISOString(), status, accounts_succeeded: counts.accounts,
    posts_read: counts.items, metric_rows_written: counts.metrics, lease_expires_at: null,
    heartbeat_at: new Date().toISOString(), next_cursor: status === 'partial' ? { checkpoint: true } : {},
    diagnostics: { mode: 'eic_checkpointed_ytd_backfill', checkpoint_status: status, continuation_required: status === 'partial', source_window: { since: options.since, until: options.until } },
  }).eq('id', runId).eq('status', 'running').select('id').maybeSingle();
  requireData(result, 'Backfill run finalization failed.');
}

async function finalizeRecoveredRun(admin, runId, status) {
  const now = new Date().toISOString();
  const result = await admin.from('social_sync_runs').update({
    completed_at: now,
    status,
    lease_expires_at: null,
    heartbeat_at: now,
  }).eq('id', runId).eq('status', 'running').select('id').maybeSingle();
  if (result.error) throw new Error('Checkpointed run recovery failed.', { cause: result.error });
  if (!result.data) {
    const existing = requireData(await admin.from('social_sync_runs').select('status')
      .eq('id', runId).maybeSingle(), 'Checkpointed run could not be reconciled.');
    if (!['success', 'partial', 'failed', 'empty'].includes(existing.status)) throw new Error('Checkpointed run is still active and could not be finalized.');
  }
}

function newCheckpoint(options, scopeHash, fingerprint, inventory, rawByItem, assets) {
  return {
    version: CHECKPOINT_VERSION, district: options.district, connectionId: options.connectionId,
    providerUserHash: options.expectedProviderUserHash, since: options.since, until: options.until,
    scopeHash, fingerprint, status: inventory.length ? 'partial' : 'complete', activeRunId: null,
    accounts: Object.fromEntries(assets.map((asset) => [assetKeyFor(asset), { metrics: false }])),
    items: Object.fromEntries(inventory.map((item) => [item.itemKey, {
      assetKey: item.assetKey,
      observation: false,
      metrics: false,
      source: rawByItem.get(item.itemKey).row,
    }])),
  };
}

function assertCheckpointBinding(checkpoint, options, scopeHash, fingerprint, inventory) {
  const expected = {
    version: CHECKPOINT_VERSION, district: options.district, connectionId: options.connectionId,
    providerUserHash: options.expectedProviderUserHash, since: options.since, until: options.until, scopeHash, fingerprint,
  };
  for (const [name, value] of Object.entries(expected)) if (checkpoint?.[name] !== value) throw new Error('Checkpoint binding or source fingerprint drift was detected.');
  const existingKeys = Object.keys(checkpoint.items || {}).sort();
  if (canonical(existingKeys) !== canonical(inventory.map((item) => item.itemKey).sort())) throw new Error('Checkpoint item inventory drift was detected.');
  const inventoryByKey = new Map(inventory.map((item) => [item.itemKey, item]));
  for (const [itemKey, progress] of Object.entries(checkpoint.items || {})) {
    if (!progress?.source || progress.assetKey !== inventoryByKey.get(itemKey)?.assetKey) throw new Error('Checkpoint source snapshot is incomplete or outside the approved asset scope.');
    if (`${inventoryByKey.get(itemKey).assetKey.split(':')[0]}:${sha256(progress.source.id)}` !== itemKey) throw new Error('Checkpoint source identity does not match its bound item key.');
  }
}

export async function runBackfill(rawOptions, dependencies = {}) {
  const options = validateBackfillOptions(rawOptions);
  const admin = dependencies.admin || createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const connection = requireData(await admin.from('social_provider_connections')
    .select('id,district_id,provider_app_id,provider_user_id,status,granted_scopes')
    .eq('id', options.connectionId).eq('district_id', options.district).eq('provider', 'meta').maybeSingle(), 'Expected active Meta connection was not found.');
  if (connection.status !== 'active' || String(connection.provider_app_id) !== String(process.env.META_APP_ID)) throw new Error('Expected active Meta connection/app validation failed.');
  if (sha256(connection.provider_user_id) !== options.expectedProviderUserHash) throw new Error('Provider-user hash validation failed.');
  const credential = requireData(await admin.from('social_provider_credentials').select('encrypted_access_token,key_version')
    .eq('connection_id', options.connectionId).eq('district_id', options.district).maybeSingle(), 'Meta credential was not found.');
  if (credential.key_version !== 1) throw new Error('Unsupported Meta credential key version.');
  const accessToken = decryptMetaToken(credential.encrypted_access_token, `${options.connectionId}:${options.district}:meta`);
  const tokenData = await debugMetaToken(accessToken);
  if (tokenData?.is_valid !== true || String(tokenData.app_id) !== String(process.env.META_APP_ID) || String(tokenData.user_id) !== String(connection.provider_user_id)) throw new Error('Meta debug-token app/user validation failed.');
  const granted = metaGrantedScopes(tokenData);
  for (const scope of ['pages_show_list', 'pages_read_engagement']) if (!granted.includes(scope)) throw new Error('Required Meta grant validation failed.');

  const assets = requireData(await admin.from('social_provider_assets')
    .select('id,district_id,connection_id,provider_asset_id,asset_type,platform,name,handle,parent_provider_asset_id,selected,active')
    .eq('district_id', options.district).eq('connection_id', options.connectionId).eq('selected', true).eq('active', true), 'Selected Meta assets could not be loaded.')
    .sort((a, b) => `${a.platform}:${a.provider_asset_id}`.localeCompare(`${b.platform}:${b.provider_asset_id}`));
  const selection = validateMetaSyncSelection(assets);
  if (selection.facebookPages !== 1 || selection.instagramAccounts !== 1 || assets.length !== 2) throw new Error('Backfill requires the pinned EIC Facebook Page and Instagram account selection.');
  if (assets.some((asset) => asset.platform === 'facebook') && !granted.includes('read_insights')) throw new Error('Facebook Insights grant validation failed.');
  if (assets.some((asset) => asset.platform === 'instagram') && (!granted.includes('instagram_basic') || !granted.includes('instagram_manage_insights'))) throw new Error('Instagram grant validation failed.');
  const links = requireData(await admin.from('social_provider_account_links').select('id,provider_asset_id,social_account_id,active')
    .eq('district_id', options.district).eq('provider', 'meta').eq('active', true), 'Active Meta links could not be loaded.');
  const linkByAsset = new Map(links.map((link) => [link.provider_asset_id, link]));
  if (assets.some((asset) => !linkByAsset.has(asset.id))) throw new Error('Every selected active Meta asset must already have an active canonical link.');
  const scopeHash = buildScopeFingerprint(assets, links);
  if (options.expectedScopeHash && options.expectedScopeHash !== scopeHash) throw new Error('Selected Meta asset/link scope does not match the approved dry-run hash.');

  const pageGrants = await graphAllFixed('me/accounts', accessToken, { fields: PAGE_FIELDS });
  const grantByPage = new Map(pageGrants.map((grant) => [String(grant.id), grant]));
  const inventory = [];
  const rawByItem = new Map();
  const tokenByAsset = new Map();
  for (const asset of assets) {
    const pageId = asset.asset_type === 'facebook_page' ? asset.provider_asset_id : asset.parent_provider_asset_id;
    const grant = grantByPage.get(String(pageId));
    if (!grant?.access_token || !(grant.tasks || []).some((task) => ['ANALYZE', 'MANAGE'].includes(task))) throw new Error('Selected asset no longer has an analytics-capable Page grant.');
    tokenByAsset.set(asset.id, grant.access_token);
    const pathname = asset.asset_type === 'facebook_page' ? `${asset.provider_asset_id}/published_posts` : `${asset.provider_asset_id}/media`;
    const fields = asset.asset_type === 'facebook_page' ? POST_FIELDS : MEDIA_FIELDS;
    const rows = (await graphAllFixed(pathname, grant.access_token, {
      fields,
      since: `${options.since}T00:00:00.000Z`,
      until: exclusiveDayAfter(options.until),
    }))
      .filter((row) => inFixedWindow(asset.asset_type === 'facebook_page' ? row.created_time : row.timestamp, options.since, options.until));
    for (const row of rows) {
      const assetKey = assetKeyFor(asset);
      const itemKey = `${asset.platform}:${sha256(row.id)}`;
      const publishedAt = asset.asset_type === 'facebook_page' ? row.created_time : row.timestamp;
      const sourceHash = sha256(canonical({ assetKey, itemKey }));
      const item = { assetKey, itemKey, publishedAt, sourceHash };
      inventory.push(item);
      rawByItem.set(itemKey, { asset, row });
    }
  }
  inventory.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.itemKey.localeCompare(b.itemKey));
  const fingerprint = buildSourceFingerprint(inventory);
  let checkpoint = await loadCheckpoint(options.checkpoint);
  if (!checkpoint) checkpoint = newCheckpoint(options, scopeHash, fingerprint, inventory, rawByItem, assets);
  else assertCheckpointBinding(checkpoint, options, scopeHash, fingerprint, inventory);
  await saveCheckpointAtomic(options.checkpoint, checkpoint);

  const pending = inventory.filter((item) => !checkpoint.items[item.itemKey]?.observation || !checkpoint.items[item.itemKey]?.metrics);
  if (!options.execute) return { status: 'dry-run', since: options.since, until: options.until, assets: assets.length, scopeHash, sourceItems: inventory.length, pendingItems: pending.length };
  if (checkpoint.activeRunId) {
    await finalizeRecoveredRun(admin, checkpoint.activeRunId, pending.length ? 'partial' : 'success');
    checkpoint.activeRunId = null;
    checkpoint.status = pending.length ? 'partial' : 'complete';
    await saveCheckpointAtomic(options.checkpoint, checkpoint);
  }
  if (checkpoint.status === 'complete' && pending.length === 0) return { status: 'already complete', since: options.since, until: options.until, assets: assets.length, sourceItems: inventory.length, pendingItems: 0 };

  requireData(await admin.rpc('canary_fenced_link_selected_meta_assets', { p_district_id: options.district, p_connection_id: options.connectionId }), 'Fenced canonical link validation failed.');
  const runId = requireData(await admin.rpc('canary_claim_meta_sync_run', {
    p_district_id: options.district, p_connection_id: options.connectionId, p_accounts_attempted: assets.length,
    p_source_cutoff: `${options.since}T00:00:00.000Z`,
    p_diagnostics: { mode: 'eic_checkpointed_ytd_backfill', since: options.since, until: options.until, max_items: options.maxItems },
  }), 'Backfill run lease could not be claimed.');
  const counts = { accounts: 0, items: 0, metrics: 0 };
  checkpoint.activeRunId = runId;
  checkpoint.status = 'running';
  await saveCheckpointAtomic(options.checkpoint, checkpoint);
  try {
    await heartbeat(admin, runId, checkpoint, counts);
    for (const asset of assets) {
      const assetKey = assetKeyFor(asset);
      if (checkpoint.accounts?.[assetKey]?.metrics) continue;
      const link = linkByAsset.get(asset.id);
      const observedAt = new Date().toISOString();
      const requests = asset.platform === 'facebook'
        ? facebookAccountInsightRequests(asset.provider_asset_id)
        : instagramAccountInsightRequests(asset.provider_asset_id, sevenDayInsightWindow(new Date(`${options.until}T23:59:59.999Z`)));
      counts.metrics += await persistMetrics({ admin, link, platform: asset.platform, metricScope: 'account', providerObjectId: asset.provider_asset_id, requests, token: tokenByAsset.get(asset.id), observedAt });
      counts.accounts += 1;
      checkpoint.accounts[assetKey].metrics = true;
      await saveCheckpointAtomic(options.checkpoint, checkpoint);
      await heartbeat(admin, runId, checkpoint, counts);
    }
    for (const item of pending.slice(0, options.maxItems)) {
      const progress = checkpoint.items[item.itemKey];
      const asset = assets.find((candidate) => assetKeyFor(candidate) === progress.assetKey);
      if (!asset) throw new Error('Checkpoint item no longer belongs to the approved selected-asset scope.');
      const row = progress.source;
      const link = linkByAsset.get(asset.id);
      await heartbeat(admin, runId, checkpoint, counts);
      const batch = asset.asset_type === 'facebook_page'
        ? mapFacebookPagePosts({ districtId: options.district, asset, rows: [row] })
        : mapInstagramMedia({ districtId: options.district, asset, rows: [row] });
      if (batch.threads.length !== 1 || batch.rejected.length) throw new Error('A source item did not normalize safely.');
      const thread = batch.threads[0];
      if (!progress.observation) {
        requireData(await admin.rpc('canary_fenced_ingest_owned_social_observation', {
          p_provider_account_link_id: link.id,
          p_thread: { ...thread, social_account_id: link.social_account_id, first_seen_at: new Date().toISOString(), last_seen_at: new Date().toISOString() },
        }), 'Fenced observation persistence failed.');
        progress.observation = true;
        await saveCheckpointAtomic(options.checkpoint, checkpoint);
      }
      if (!progress.metrics) {
        const persisted = requireData(await admin.from('social_threads').select('id').eq('district_id', options.district)
          .eq('social_account_id', link.social_account_id).eq('platform', thread.platform)
          .eq('external_thread_id', thread.external_thread_id).maybeSingle(), 'Canonical thread lookup failed.');
        const requests = thread.platform === 'facebook'
          ? facebookContentInsightRequests(thread.external_thread_id)
          : instagramContentInsightRequests(thread.external_thread_id, { mediaProductType: thread.provider_metadata?.media_product_type });
        counts.metrics += await persistMetrics({ admin, link, threadId: persisted.id, platform: thread.platform, metricScope: 'content', providerObjectId: thread.external_thread_id, requests, token: tokenByAsset.get(asset.id), observedAt: new Date().toISOString() });
        progress.metrics = true;
        await saveCheckpointAtomic(options.checkpoint, checkpoint);
      }
      counts.items += 1;
      const remaining = inventory.some((candidate) => !checkpoint.items[candidate.itemKey].observation || !checkpoint.items[candidate.itemKey].metrics);
      checkpoint.status = remaining ? 'partial' : 'complete';
      await saveCheckpointAtomic(options.checkpoint, checkpoint);
      await heartbeat(admin, runId, checkpoint, counts);
    }
    const remaining = inventory.filter((item) => !checkpoint.items[item.itemKey].observation || !checkpoint.items[item.itemKey].metrics).length;
    checkpoint.status = 'finalizing';
    await saveCheckpointAtomic(options.checkpoint, checkpoint);
    await finishRun(admin, runId, remaining ? 'partial' : 'success', counts, options);
    checkpoint.activeRunId = null;
    checkpoint.status = remaining ? 'partial' : 'complete';
    await saveCheckpointAtomic(options.checkpoint, checkpoint);
    return { status: remaining ? 'partial' : 'success', since: options.since, until: options.until, assets: assets.length, processedItems: counts.items, remainingItems: remaining, metricRows: counts.metrics };
  } catch (error) {
    const failed = await admin.from('social_sync_runs').update({ completed_at: new Date().toISOString(), status: 'failed', provider_errors: 1, lease_expires_at: null, error_summary: { code: 'EIC_BACKFILL_STOPPED', message: 'Operator backfill stopped; checkpoint retained.' } }).eq('id', runId).eq('status', 'running').select('id').maybeSingle();
    if (failed.error || !failed.data) throw new Error('Backfill stopped and its run could not be finalized.', { cause: failed.error || error });
    checkpoint.activeRunId = null;
    checkpoint.status = 'partial';
    await saveCheckpointAtomic(options.checkpoint, checkpoint);
    throw error;
  }
}

function sanitizedResult(result) {
  return JSON.stringify(result);
}

async function main() {
  try {
    const result = await runBackfill(parseBackfillArgs(process.argv.slice(2)));
    process.stdout.write(`${sanitizedResult(result)}\n`);
  } catch {
    process.stderr.write('{"status":"failed","message":"Meta backfill stopped; inspect the retained checkpoint and protected logs."}\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();

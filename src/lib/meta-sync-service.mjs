import { decryptMetaToken, debugMetaToken, metaGraph, metaGraphAll } from './meta-integration.mjs';
import { boundedMetaSourceCutoff, mapFacebookPagePosts, mapInstagramMedia, summarizeMetaSyncOutcome, validateMetaSyncSelection } from './meta-owned-sync.mjs';

const PAGE_FIELDS = 'id,access_token,tasks';
const POST_FIELDS = 'id,message,story,created_time,permalink_url,from,comments.limit(0).summary(true),reactions.limit(0).summary(true),shares';
const MEDIA_FIELDS = 'id,caption,media_type,permalink,timestamp,username,comments_count,like_count';

function safeError(error) {
  return { code: String(error?.code || error?.type || 'META_SYNC_ERROR'), message: String(error?.message || 'Meta synchronization failed.').slice(0, 300) };
}

async function requireOne(query, message) {
  const { data, error } = await query;
  if (error) throw error;
  if (!data) throw new Error(message);
  return data;
}

export async function syncSelectedMetaAssets({ admin, districtId, connectionId, sourceCutoff = null, now = () => new Date() }) {
  if (process.env.META_NATIVE_SYNC_ENABLED !== 'true') throw Object.assign(new Error('Native Meta synchronization is disabled.'), { status: 503 });
  const connection = await requireOne(admin.from('social_provider_connections')
    .select('id,district_id,provider_app_id,provider_user_id,status,granted_scopes,token_expires_at')
    .eq('id', connectionId).eq('district_id', districtId).eq('provider', 'meta').maybeSingle(), 'Meta connection not found.');
  if (!['active', 'needs_permissions'].includes(connection.status)) throw new Error('Meta connection requires authorization before synchronization.');
  if (String(connection.provider_app_id) !== String(process.env.META_APP_ID)) throw new Error('Meta connection was issued by a different application.');

  const credential = await requireOne(admin.from('social_provider_credentials')
    .select('encrypted_access_token,key_version').eq('connection_id', connectionId).eq('district_id', districtId).maybeSingle(), 'Meta credential not found.');
  if (credential.key_version !== 1) throw new Error('Unsupported Meta credential key version.');
  const accessToken = decryptMetaToken(credential.encrypted_access_token, `${connectionId}:${districtId}:meta`);
  const deadline = Date.now() + 45_000;
  const executionSignal = AbortSignal.timeout(45_000);

  const tokenData = await debugMetaToken(accessToken, { signal: executionSignal });
  if (tokenData?.is_valid !== true || String(tokenData.app_id) !== String(process.env.META_APP_ID)
    || String(tokenData.user_id) !== String(connection.provider_user_id)) throw new Error('Meta authorization is no longer valid for this connection.');
  const permissionPayload = await metaGraph('me/permissions', accessToken, {}, { signal: executionSignal });
  const granted = (permissionPayload?.data || []).filter((row) => row.status === 'granted').map((row) => row.permission);
  for (const required of ['pages_show_list', 'pages_read_engagement']) {
    if (!granted.includes(required)) throw new Error(`Meta permission ${required} is required for synchronization.`);
  }

  const { data: assets, error: assetError } = await admin.from('social_provider_assets')
    .select('id,district_id,connection_id,provider_asset_id,asset_type,platform,name,handle,parent_provider_asset_id,selected,active')
    .eq('district_id', districtId).eq('connection_id', connectionId).eq('selected', true).eq('active', true);
  if (assetError) throw assetError;
  validateMetaSyncSelection(assets || []);
  const { error: linkError } = await admin.rpc('canary_link_selected_meta_assets', { p_district_id: districtId, p_connection_id: connectionId });
  if (linkError) throw linkError;
  const { data: links, error: linksError } = await admin.from('social_provider_account_links')
    .select('id,provider_asset_id,social_account_id,active').eq('district_id', districtId).eq('provider', 'meta').eq('active', true);
  if (linksError) throw linksError;
  const linkByAsset = new Map((links || []).map((link) => [link.provider_asset_id, link]));
  if ((assets || []).some((asset) => !linkByAsset.has(asset.id))) throw new Error('A selected Meta asset is not linked to a canonical Social account.');

  const { data: previousRun, error: previousRunError } = await admin.from('social_sync_runs')
    .select('next_cursor,status,source_cutoff').eq('district_id', districtId).eq('connection_id', connectionId)
    .neq('status', 'running').order('started_at', { ascending: false }).limit(1).maybeSingle();
  if (previousRunError) throw previousRunError;
  const continuation = previousRun?.status === 'partial' && previousRun?.next_cursor ? previousRun.next_cursor : {};
  const boundedCutoff = boundedMetaSourceCutoff(previousRun?.status === 'partial' ? previousRun.source_cutoff : sourceCutoff, now());
  const { data: runId, error: runError } = await admin.rpc('canary_claim_meta_sync_run', {
    p_district_id: districtId,
    p_connection_id: connectionId,
    p_accounts_attempted: assets.length,
    p_source_cutoff: boundedCutoff,
    p_diagnostics: { mode: 'bounded_selected_asset_sync', baseline_days: 90, platforms: [...new Set(assets.map((a) => a.platform))] },
  });
  if (runError || !runId) throw runError || new Error('Meta sync lease could not be claimed.');
  const run = { id: runId };

  const batches = [];
  const nextCursor = {};
  let duplicateItems = 0;
  try {
    const needsPageGrant = assets.some((asset) => asset.asset_type === 'facebook_page' || asset.asset_type === 'instagram_account');
    const pageGrants = needsPageGrant ? await metaGraphAll('me/accounts', accessToken, { fields: PAGE_FIELDS, limit: '100' }, 2, { signal: executionSignal }) : [];
    const grantByPage = new Map(pageGrants.map((page) => [String(page.id), page]));
    for (const asset of assets) {
      if (Date.now() >= deadline) {
        nextCursor[asset.id] = continuation[asset.id] || null;
        batches.push({ status: 'partial', threads: [], rejected: [], providerErrors: 0, errorCode: 'EXECUTION_BUDGET' });
        continue;
      }
      let batch;
      try {
        if (asset.asset_type === 'facebook_page') {
          const grant = grantByPage.get(String(asset.provider_asset_id));
          if (!grant?.access_token || !(grant.tasks || []).some((task) => ['ANALYZE', 'MANAGE'].includes(task))) throw new Error('The authorizing person no longer has an analytics-capable Page task.');
          const payload = await metaGraph(`${asset.provider_asset_id}/published_posts`, grant.access_token, { fields: POST_FIELDS, limit: '100', since: boundedCutoff, ...(continuation[asset.id] ? { after: continuation[asset.id] } : {}) }, { signal: executionSignal });
          const rows = Array.isArray(payload?.data) ? payload.data : [];
          if (payload?.paging?.cursors?.after && payload?.paging?.next) nextCursor[asset.id] = payload.paging.cursors.after;
          batch = mapFacebookPagePosts({ districtId, asset, rows });
        } else {
          if (!granted.includes('instagram_basic')) throw new Error('Meta permission instagram_basic is required for the selected Instagram account.');
          const parentGrant = grantByPage.get(String(asset.parent_provider_asset_id));
          if (!parentGrant?.access_token) throw new Error('The parent Facebook Page grant is unavailable for Instagram synchronization.');
          const payload = await metaGraph(`${asset.provider_asset_id}/media`, parentGrant.access_token, { fields: MEDIA_FIELDS, limit: '100', since: boundedCutoff, ...(continuation[asset.id] ? { after: continuation[asset.id] } : {}) }, { signal: executionSignal });
          const rows = Array.isArray(payload?.data) ? payload.data : [];
          if (payload?.paging?.cursors?.after && payload?.paging?.next) nextCursor[asset.id] = payload.paging.cursors.after;
          batch = mapInstagramMedia({ districtId, asset, rows });
        }
      } catch (error) {
        if (executionSignal.aborted) {
          nextCursor[asset.id] = continuation[asset.id] || null;
          batch = { status: 'partial', threads: [], rejected: [], providerErrors: 0, errorCode: 'EXECUTION_BUDGET' };
        } else {
          batch = asset.asset_type === 'facebook_page'
            ? mapFacebookPagePosts({ districtId, asset, providerError: safeError(error) })
            : mapInstagramMedia({ districtId, asset, providerError: safeError(error) });
        }
      }
      batches.push(batch);
      const link = linkByAsset.get(asset.id);
      let writtenCount = 0;
      for (const thread of batch.threads) {
        if (Date.now() >= deadline) {
          nextCursor[asset.id] = continuation[asset.id] || null;
          batch = { ...batch, status: 'partial', errorCode: 'EXECUTION_BUDGET', threads: batch.threads.slice(0, writtenCount) };
          batches[batches.length - 1] = batch;
          break;
        }
        const existing = await admin.from('social_threads').select('id').eq('district_id', districtId)
          .eq('platform', thread.platform).eq('external_thread_id', thread.external_thread_id).maybeSingle();
        if (existing.error) throw existing.error;
        if (existing.data) duplicateItems += 1;
        const payload = { ...thread, social_account_id: link.social_account_id, first_seen_at: now().toISOString(), last_seen_at: now().toISOString() };
        const { error } = await admin.rpc('canary_ingest_owned_social_observation', { p_provider_account_link_id: link.id, p_thread: payload });
        if (error) throw error;
        writtenCount += 1;
      }
    }
    const summary = summarizeMetaSyncOutcome(batches);
    const finalStatus = Object.keys(nextCursor).length ? 'partial' : summary.status;
    const { data: completed, error: completeError } = await admin.from('social_sync_runs').update({
      completed_at: now().toISOString(), status: finalStatus, accounts_succeeded: summary.accountsSucceeded,
      posts_read: summary.postsRead, provider_errors: summary.providerErrors, rejected_items: summary.rejectedItems,
      duplicate_items: duplicateItems, next_cursor: nextCursor, lease_expires_at: null, heartbeat_at: now().toISOString(), diagnostics: { mode: 'bounded_selected_asset_sync', outcomes: batches.map((batch, index) => ({ asset_id: assets[index].id, platform: assets[index].platform, status: batch.status, accepted: batch.threads.length, rejected: batch.rejected.length, error_code: batch.errorCode })) },
    }).eq('id', run.id).eq('status', 'running').select('id,status').maybeSingle();
    if (completeError || !completed) throw completeError || new Error('Meta sync run completion was not persisted.');
    return { runId: run.id, ...summary, status: finalStatus, duplicateItems, continuationRequired: Object.keys(nextCursor).length > 0 };
  } catch (error) {
    const failedAt = now().toISOString();
    const { data: failed, error: failureError } = await admin.from('social_sync_runs').update({
      completed_at: failedAt,
      status: 'failed',
      provider_errors: 1,
      error_summary: safeError(error),
      lease_expires_at: null,
    }).eq('id', run.id).eq('status', 'running').select('id,status').maybeSingle();
    if (failureError || !failed) {
      const terminalError = new Error('Meta synchronization failed and its run could not be finalized.');
      terminalError.cause = failureError || error;
      throw terminalError;
    }
    throw error;
  }
}

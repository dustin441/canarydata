import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { normalizeProviderBatch } from '../src/lib/socialIngestion.mjs';

export function parseArgs(argv) {
  const args = { commit: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--commit') args.commit = true;
    else if (token.startsWith('--')) args[token.slice(2)] = argv[index += 1];
  }
  if (!args.input) throw new Error('--input is required.');
  if (!args.provider) throw new Error('--provider is required.');
  if (!args.district) throw new Error('--district is required.');
  return args;
}

export function environment(processEnv = process.env) {
  const url = processEnv.CANARY_PROD_SUPABASE_URL;
  const key = processEnv.CANARY_PROD_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Canonical Canary Supabase URL and service-role key are required.');
  return { url: url.replace(/\/$/, ''), key };
}

function redactSecrets(value, env) {
  let message = String(value || '');
  for (const secret of [env?.key, env?.url].filter(Boolean)) {
    message = message.split(secret).join('[REDACTED]');
  }
  return message;
}

export async function supabaseRequest(env, method, path, body, prefer, fetchImpl = fetch) {
  const response = await fetchImpl(`${env.url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: env.key,
      Authorization: `Bearer ${env.key}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const message = redactSecrets(data?.message || `Supabase request failed (${response.status}).`, env);
    const error = new Error(message);
    error.code = redactSecrets(data?.code || `HTTP_${response.status}`, env);
    throw error;
  }
  return data;
}

function singleRpcRow(data) {
  const row = Array.isArray(data) ? (data.length === 1 ? data[0] : null) : data;
  if (!row || typeof row !== 'object' || !row.id) {
    throw new Error('Atomic Social ingestion RPC did not return a stored thread.');
  }
  return row;
}

export async function runSocialPilot({
  argv = process.argv.slice(2),
  processEnv = process.env,
  fsImpl = fs,
  fetchImpl = fetch,
  log = console.log,
  now = () => new Date(),
} = {}) {
  const args = parseArgs(argv);
  const payload = JSON.parse(await fsImpl.readFile(args.input, 'utf8'));
  const batch = normalizeProviderBatch({
    provider: args.provider,
    districtId: args.district,
    items: Array.isArray(payload) ? payload : (payload.items || []),
    providerError: Array.isArray(payload) ? null : payload.providerError,
  });

  if (!args.commit) {
    const result = { mode: 'dry-run', ...batch };
    log(JSON.stringify(result, null, 2));
    return result;
  }

  const env = environment(processEnv);
  const request = (method, path, body, prefer) => supabaseRequest(env, method, path, body, prefer, fetchImpl);
  const completedAt = () => now().toISOString();
  const accounts = await request(
    'GET',
    `social_accounts?district_id=eq.${encodeURIComponent(args.district)}&active=eq.true&select=id,provider,platform,handle,profile_url,active`,
  );
  const trustedAccountByPlatform = new Map((Array.isArray(accounts) ? accounts : [])
    .filter((account) => account.active === true
      && account.provider === batch.provider
      && (String(account.handle || '').trim() || String(account.profile_url || '').trim()))
    .map((account) => [account.platform, account.id]));
  const runRows = await request('POST', 'social_collection_runs', {
    district_id: args.district,
    provider: batch.provider,
    run_type: args.runType || 'backfill',
    status: 'running',
    raw_items: Array.isArray(payload) ? payload.length : (payload.items || []).length,
    diagnostics: { pilot: true, source_file: args.input, writer: 'atomic RPC, lifecycle-preserving' },
  }, 'return=representation');
  const runRecord = Array.isArray(runRows) ? runRows[0] : runRows;
  if (!runRecord?.id) throw new Error('Social collection run could not be created.');

  let duplicates = 0;
  const stored = [];
  try {
    for (const thread of batch.threads) {
      const existing = await request(
        'GET',
        `social_threads?district_id=eq.${encodeURIComponent(thread.district_id)}&platform=eq.${encodeURIComponent(thread.platform)}&external_thread_id=eq.${encodeURIComponent(thread.external_thread_id)}&select=id`,
      );
      if (Array.isArray(existing) && existing.length > 0) duplicates += 1;

      const trustedAccountId = trustedAccountByPlatform.get(thread.platform) || null;
      const threadPayload = {
        ...thread,
        social_account_id: trustedAccountId,
        visibility_status: thread.relationship_type === 'owned' && trustedAccountId
          ? 'active'
          : (thread.visibility_status === 'excluded' ? 'excluded' : 'review'),
        last_seen_at: completedAt(),
        provider_metadata: { ...thread.provider_metadata, pilot_ingestion: true },
      };
      const record = singleRpcRow(await request(
        'POST',
        'rpc/canary_ingest_social_thread',
        { p_thread: threadPayload },
      ));
      stored.push(record);
    }

    const activeThreads = stored.filter((thread) => thread.visibility_status === 'active').length;
    const reviewThreads = stored.filter((thread) => thread.visibility_status === 'review').length;
    const excludedThreads = stored.filter((thread) => thread.visibility_status === 'excluded').length;
    const diagnostics = {
      pilot: true,
      writer: 'atomic RPC, lifecycle-preserving',
      visibility_policy: 'verified matching owned posts auto-active; excluded input remains excluded; other public records remain review-only',
      active_threads: activeThreads,
      review_threads: reviewThreads,
      excluded_threads: excludedThreads,
      rejected: batch.rejected,
      stored_thread_ids: stored.map((thread) => thread.id),
    };
    await request('PATCH', `social_collection_runs?id=eq.${runRecord.id}`, {
      status: batch.status,
      completed_at: completedAt(),
      accepted_threads: stored.length,
      duplicate_items: duplicates,
      rejected_items: batch.rejected.length,
      provider_errors: batch.providerErrors,
      error_code: batch.errorCode,
      error_message: batch.errorMessage,
      diagnostics,
    }, 'return=minimal');

    const result = {
      mode: 'commit',
      runId: runRecord.id,
      status: batch.status,
      acceptedThreads: stored.length,
      duplicateItems: duplicates,
      rejectedItems: batch.rejected.length,
      visibilityStatuses: stored.reduce((counts, thread) => ({ ...counts, [thread.visibility_status]: (counts[thread.visibility_status] || 0) + 1 }), {}),
      threadIds: stored.map((thread) => thread.id),
    };
    log(JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    const safeMessage = redactSecrets(error.message, env);
    await request('PATCH', `social_collection_runs?id=eq.${runRecord.id}`, {
      status: 'failed',
      completed_at: completedAt(),
      accepted_threads: stored.length,
      duplicate_items: duplicates,
      rejected_items: batch.rejected.length,
      provider_errors: Math.max(1, batch.providerErrors),
      error_code: redactSecrets(error.code || 'STORAGE_ERROR', env),
      error_message: safeMessage,
      diagnostics: {
        pilot: true,
        writer: 'atomic RPC, lifecycle-preserving',
        visibility_policy: 'verified matching owned posts auto-active; excluded input remains excluded; other public records remain review-only',
        rejected: batch.rejected,
      },
    }, 'return=minimal');
    const safeError = new Error(safeMessage);
    safeError.code = redactSecrets(error.code || 'STORAGE_ERROR', env);
    throw safeError;
  }
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  runSocialPilot().catch((error) => {
    console.error(`Social pilot failed: ${error.message}`);
    process.exitCode = 1;
  });
}

import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { normalizeProviderBatch } from '../src/lib/socialIngestion.mjs';

const APPROVED_SUPABASE_ORIGIN = 'https://fehdonfrlsrrkzaemkxp.supabase.co';
const FAILED_RUN_PATCH_ATTEMPTS = 3;

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
  if (url !== APPROVED_SUPABASE_ORIGIN && url !== `${APPROVED_SUPABASE_ORIGIN}/`) {
    throw new Error('Canonical Canary Supabase configuration is invalid.');
  }
  return { url: APPROVED_SUPABASE_ORIGIN, key };
}

function redactSecrets(value, env) {
  let message = String(value || '');
  for (const secret of [env?.key, env?.url].filter(Boolean)) {
    message = message.split(secret).join('[REDACTED]');
  }
  return message;
}

function sanitizedError(error, env, fallbackCode = 'STORAGE_ERROR') {
  const safeError = new Error(redactSecrets(error?.message || 'Social pilot processing failed.', env));
  safeError.code = redactSecrets(error?.code || fallbackCode, env);
  return safeError;
}

export async function supabaseRequest(env, method, path, body, prefer, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(`${env.url}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: env['key'],
        Authorization: ['Bearer', env['key']].join(' '),
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
      const error = new Error(data?.message || `Supabase request failed (${response.status}).`);
      error.code = data?.code || `HTTP_${response.status}`;
      throw error;
    }
    return data;
  } catch (error) {
    throw sanitizedError(error, env, 'SUPABASE_REQUEST_FAILED');
  }
}

function singleRpcRow(data) {
  const row = Array.isArray(data) ? (data.length === 1 ? data[0] : null) : data;
  if (!row || typeof row !== 'object' || !row.id) {
    throw new Error('Atomic Social ingestion RPC did not return a stored thread.');
  }
  return row;
}

function singleRunRow(data) {
  const row = Array.isArray(data) ? (data.length === 1 ? data[0] : null) : data;
  if (!row || typeof row !== 'object' || Array.isArray(row) || !row.id) {
    throw new Error('Social collection run could not be created.');
  }
  return row;
}

function failureRunPayload({ batch, completedAt, duplicates, error, stored }) {
  return {
    status: 'failed',
    completed_at: completedAt(),
    accepted_threads: stored.length,
    duplicate_items: duplicates,
    rejected_items: batch.rejected.length,
    provider_errors: Math.max(1, batch.providerErrors),
    error_code: error.code,
    error_message: error.message,
    diagnostics: {
      pilot: true,
      writer: 'atomic RPC, lifecycle-preserving',
      visibility_policy: 'verified matching owned posts auto-active; excluded input remains excluded; other public records remain review-only',
      rejected: batch.rejected,
    },
  };
}

async function finalizeFailedRun({ request, runId, payload, attempts = FAILED_RUN_PATCH_ATTEMPTS }) {
  let finalizationError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await request('PATCH', `social_collection_runs?id=eq.${encodeURIComponent(runId)}`, payload, 'return=minimal');
      return;
    } catch (error) {
      finalizationError = error;
    }
  }
  throw finalizationError;
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
  if (!Array.isArray(accounts)) throw new Error('Social account lookup returned an invalid response.');
  const ownedPlatforms = new Set(batch.threads
    .filter((thread) => thread.relationship_type === 'owned')
    .map((thread) => thread.platform));
  const trustedCandidatesByPlatform = new Map();
  for (const account of accounts) {
    if (account?.active !== true
      || account.provider !== batch.provider
      || !ownedPlatforms.has(account.platform)
      || !(String(account.handle || '').trim() || String(account.profile_url || '').trim())) continue;
    const candidates = trustedCandidatesByPlatform.get(account.platform) || [];
    candidates.push(account.id);
    trustedCandidatesByPlatform.set(account.platform, candidates);
  }
  for (const [platform, candidates] of trustedCandidatesByPlatform) {
    if (candidates.length > 1) {
      throw new Error('Multiple verified Social accounts match an owned thread platform.');
    }
  }
  const trustedAccountByPlatform = new Map([...trustedCandidatesByPlatform]
    .map(([platform, candidates]) => [platform, candidates[0]]));
  const runRows = await request('POST', 'social_collection_runs', {
    district_id: args.district,
    provider: batch.provider,
    run_type: args.runType || 'backfill',
    status: 'running',
    raw_items: Array.isArray(payload) ? payload.length : (payload.items || []).length,
    diagnostics: { pilot: true, source_file: args.input, writer: 'atomic RPC, lifecycle-preserving' },
  }, 'return=representation');
  const runRecord = singleRunRow(runRows);

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
    await request('PATCH', `social_collection_runs?id=eq.${encodeURIComponent(runRecord.id)}`, {
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
    const primaryError = sanitizedError(error, env);
    try {
      await finalizeFailedRun({
        request,
        runId: runRecord.id,
        payload: failureRunPayload({ batch, completedAt, duplicates, error: primaryError, stored }),
      });
    } catch (finalizationError) {
      const safeFinalizationError = sanitizedError(finalizationError, env, 'RUN_FINALIZATION_FAILED');
      const compositeError = new Error(`${primaryError.message} Failed to finalize the Social collection run as failed: ${safeFinalizationError.message}`);
      compositeError.code = primaryError.code;
      compositeError.cause = primaryError;
      throw compositeError;
    }
    throw primaryError;
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

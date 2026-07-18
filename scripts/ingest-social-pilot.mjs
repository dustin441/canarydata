import fs from 'node:fs/promises';
import { normalizeProviderBatch } from '../src/lib/socialIngestion.mjs';

function parseArgs(argv) {
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

function environment() {
  const url = process.env.CANARY_PROD_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.CANARY_PROD_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Canonical Canary Supabase URL and service-role key are required.');
  return { url: url.replace(/\/$/, ''), key };
}

async function supabaseRequest(env, method, path, body, prefer) {
  const response = await fetch(`${env.url}/rest/v1/${path}`, {
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
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(data?.message || `Supabase request failed (${response.status}).`);
    error.code = data?.code || `HTTP_${response.status}`;
    throw error;
  }
  return data;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const payload = JSON.parse(await fs.readFile(args.input, 'utf8'));
  const batch = normalizeProviderBatch({
    provider: args.provider,
    districtId: args.district,
    items: Array.isArray(payload) ? payload : (payload.items || []),
    providerError: Array.isArray(payload) ? null : payload.providerError,
  });

  if (!args.commit) {
    console.log(JSON.stringify({ mode: 'dry-run', ...batch }, null, 2));
    return;
  }

  const env = environment();
  const completedAt = () => new Date().toISOString();
  const accounts = await supabaseRequest(
    env,
    'GET',
    `social_accounts?district_id=eq.${encodeURIComponent(args.district)}&active=eq.true&select=id,platform`,
  );
  const accountByPlatform = new Map(accounts.map((account) => [account.platform, account.id]));
  const [runRecord] = await supabaseRequest(env, 'POST', 'social_collection_runs', {
    district_id: args.district,
    provider: batch.provider,
    run_type: args.runType || 'backfill',
    status: 'running',
    raw_items: Array.isArray(payload) ? payload.length : (payload.items || []).length,
    diagnostics: { pilot: true, source_file: args.input },
  }, 'return=representation');

  let duplicates = 0;
  const stored = [];
  try {
    for (const thread of batch.threads) {
      const existing = await supabaseRequest(
        env,
        'GET',
        `social_threads?district_id=eq.${encodeURIComponent(thread.district_id)}&platform=eq.${encodeURIComponent(thread.platform)}&external_thread_id=eq.${encodeURIComponent(thread.external_thread_id)}&select=id`,
      );
      if (existing.length > 0) duplicates += 1;
      const [record] = await supabaseRequest(
        env,
        'POST',
        'social_threads?on_conflict=district_id,platform,external_thread_id',
        {
          ...thread,
          social_account_id: accountByPlatform.get(thread.platform) || null,
          visibility_status: 'review',
          last_seen_at: completedAt(),
          provider_metadata: { ...thread.provider_metadata, pilot_ingestion: true },
        },
        'resolution=merge-duplicates,return=representation',
      );
      stored.push(record);
    }

    const diagnostics = {
      pilot: true,
      review_only: true,
      rejected: batch.rejected,
      stored_thread_ids: stored.map((thread) => thread.id),
    };
    await supabaseRequest(env, 'PATCH', `social_collection_runs?id=eq.${runRecord.id}`, {
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

    console.log(JSON.stringify({
      mode: 'commit',
      runId: runRecord.id,
      status: batch.status,
      acceptedThreads: stored.length,
      duplicateItems: duplicates,
      rejectedItems: batch.rejected.length,
      visibilityStatus: 'review',
      threadIds: stored.map((thread) => thread.id),
    }, null, 2));
  } catch (error) {
    await supabaseRequest(env, 'PATCH', `social_collection_runs?id=eq.${runRecord.id}`, {
      status: 'failed',
      completed_at: completedAt(),
      accepted_threads: stored.length,
      duplicate_items: duplicates,
      rejected_items: batch.rejected.length,
      provider_errors: Math.max(1, batch.providerErrors),
      error_code: error.code || 'STORAGE_ERROR',
      error_message: error.message,
      diagnostics: { pilot: true, review_only: true, rejected: batch.rejected },
    }, 'return=minimal');
    throw error;
  }
}

run().catch((error) => {
  console.error(`Social pilot failed: ${error.message}`);
  process.exit(1);
});

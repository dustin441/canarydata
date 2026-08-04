import { createHash, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const EXPECTED_SUPABASE_ORIGIN = 'https://fehdonfrlsrrkzaemkxp.supabase.co';
const VERCEL_PROJECT_ID = 'prj_Y9Gbzajz4KVgDD1tYnUXKcyHMdOl';
const VERCEL_TEAM_ID = 'team_Sxyeod3LY9PSUrI7F0cev2lN';
const VERCEL_API_BASE = `https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/env`;

const REQUIRED_ENVIRONMENT = [
  'CANARY_PROD_SUPABASE_URL',
  'CANARY_PROD_SUPABASE_ANON_KEY',
  'CANARY_PROD_SUPABASE_SERVICE_ROLE_KEY',
  'VERCEL_TOKEN',
];

const VERCEL_ENVIRONMENT_CHECKS = [
  ['NEXT_PUBLIC_SUPABASE_URL', 'CANARY_PROD_SUPABASE_URL'],
  ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'CANARY_PROD_SUPABASE_ANON_KEY'],
  ['SUPABASE_SERVICE_ROLE_KEY', 'CANARY_PROD_SUPABASE_SERVICE_ROLE_KEY'],
];

function reporter(logger) {
  const pass = (check, status = 'pass') => logger.log(`${check}: ${status}`);
  const fail = (check, reason) => {
    logger.error(`${check}: fail`);
    throw new Error(`${check}: fail (${reason})`);
  };
  return { pass, fail };
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest();
}

function valuesMatch(left, right) {
  return timingSafeEqual(sha256(left), sha256(right));
}

async function getJson({ fetchImpl, url, headers, check, fail }) {
  let response;
  try {
    response = await fetchImpl(url, { method: 'GET', headers });
  } catch {
    fail(check, 'request failed');
  }

  if (!response || !response.ok) {
    const status = Number.isInteger(response?.status) ? `HTTP ${response.status}` : 'invalid response';
    fail(check, status);
  }

  try {
    return await response.json();
  } catch {
    fail(check, 'invalid JSON response');
  }
}

function isExpectedSupabaseOrigin(urlValue) {
  return urlValue === EXPECTED_SUPABASE_ORIGIN || urlValue === `${EXPECTED_SUPABASE_ORIGIN}/`;
}

export async function runProductionAuthPreflight({
  env = process.env,
  fetchImpl = globalThis.fetch,
  logger = console,
} = {}) {
  const { pass, fail } = reporter(logger);

  for (const name of REQUIRED_ENVIRONMENT) {
    if (typeof env[name] !== 'string' || env[name].trim() === '') {
      fail('canonical credentials', `missing ${name}`);
    }
  }
  pass('canonical credentials');

  if (!isExpectedSupabaseOrigin(env.CANARY_PROD_SUPABASE_URL)) {
    fail('Supabase project reference', 'project mismatch');
  }
  const supabaseUrl = EXPECTED_SUPABASE_ORIGIN;
  pass('Supabase project reference');

  const anonHeaders = {
    apikey: env.CANARY_PROD_SUPABASE_ANON_KEY,
    Authorization: `Bearer ${env.CANARY_PROD_SUPABASE_ANON_KEY}`,
  };
  const serviceHeaders = {
    apikey: env.CANARY_PROD_SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.CANARY_PROD_SUPABASE_SERVICE_ROLE_KEY}`,
  };
  const vercelHeaders = {
    Authorization: `Bearer ${env.VERCEL_TOKEN}`,
  };

  await getJson({
    fetchImpl,
    url: `${supabaseUrl}/auth/v1/settings`,
    headers: anonHeaders,
    check: 'Supabase anon settings',
    fail,
  });
  pass('Supabase anon settings');

  const list = await getJson({
    fetchImpl,
    url: `${supabaseUrl}/auth/v1/admin/users?page=1&per_page=1`,
    headers: serviceHeaders,
    check: 'Supabase admin user list',
    fail,
  });
  const userId = list?.users?.[0]?.id;
  if (typeof userId !== 'string' || userId === '') {
    fail('Supabase admin user list', 'empty verification set');
  }
  pass('Supabase admin user list');

  const user = await getJson({
    fetchImpl,
    url: `${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
    headers: serviceHeaders,
    check: 'Supabase existing user',
    fail,
  });
  if (user?.id !== userId) {
    fail('Supabase existing user', 'invalid response');
  }
  pass('Supabase existing user');

  const metadata = await getJson({
    fetchImpl,
    url: `${VERCEL_API_BASE}?teamId=${VERCEL_TEAM_ID}`,
    headers: vercelHeaders,
    check: 'Vercel environment metadata',
    fail,
  });
  if (!Array.isArray(metadata?.envs)) {
    fail('Vercel environment metadata', 'invalid response');
  }
  pass('Vercel environment metadata');

  const entriesByKey = new Map();
  for (const entry of metadata.envs) {
    const entries = entriesByKey.get(entry?.key) ?? [];
    entries.push(entry);
    entriesByKey.set(entry?.key, entries);
  }

  const selectedEntries = [];
  for (const [vercelName, localName] of VERCEL_ENVIRONMENT_CHECKS) {
    const check = `Vercel ${vercelName} metadata`;
    const matches = entriesByKey.get(vercelName) ?? [];
    if (matches.length === 0) fail(check, 'missing production entry');
    if (matches.length !== 1) fail(check, 'duplicate entries');
    const [entry] = matches;
    if (!Array.isArray(entry.target) || !entry.target.includes('production')) {
      fail(check, 'missing production target');
    }
    if (typeof entry.id !== 'string' || entry.id === '') fail(check, 'invalid response');
    selectedEntries.push({ entryId: entry.id, vercelName, localName });
    pass(check);
  }

  for (const { entryId, vercelName, localName } of selectedEntries) {
    const check = `Vercel ${vercelName} value`;
    const detail = await getJson({
      fetchImpl,
      url: `${VERCEL_API_BASE}/${encodeURIComponent(entryId)}?teamId=${VERCEL_TEAM_ID}&decrypt=true`,
      headers: vercelHeaders,
      check,
      fail,
    });
    if (typeof detail?.value !== 'string') fail(check, 'invalid response');
    if (!valuesMatch(detail.value, env[localName])) fail(check, 'mismatch');
    pass(check, 'match');
  }

  return { ok: true };
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  try {
    await runProductionAuthPreflight();
  } catch {
    process.exitCode = 1;
  }
}

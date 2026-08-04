import assert from 'node:assert/strict';
import { runProductionAuthPreflight } from './preflight-production-auth.mjs';

const PROJECT_REF = 'fehdonfrlsrrkzaemkxp';
const VERCEL_PROJECT = 'prj_Y9Gbzajz4KVgDD1tYnUXKcyHMdOl';
const VERCEL_TEAM = 'team_Sxyeod3LY9PSUrI7F0cev2lN';
const secrets = {
  url: `https://${PROJECT_REF}.supabase.co`,
  anon: 'anon-secret-unit-test-value',
  service: 'service-secret-unit-test-value',
  vercel: 'vercel-secret-unit-test-value',
};

function canonicalEnv(overrides = {}) {
  return {
    CANARY_PROD_SUPABASE_URL: secrets.url,
    CANARY_PROD_SUPABASE_ANON_KEY: secrets.anon,
    CANARY_PROD_SUPABASE_SERVICE_ROLE_KEY: secrets.service,
    VERCEL_TOKEN: secrets.vercel,
    ...overrides,
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function validVercelEntries(overrides = {}) {
  const entries = [
    { id: 'env-url', key: 'NEXT_PUBLIC_SUPABASE_URL', target: ['production'] },
    { id: 'env-anon', key: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', target: ['production'] },
    { id: 'env-service', key: 'SUPABASE_SERVICE_ROLE_KEY', target: ['production'] },
  ];
  return overrides.entries ?? entries;
}

function createHarness({ env = canonicalEnv(), routeOverrides = {} } = {}) {
  const calls = [];
  const logs = [];
  const valuesById = {
    'env-url': secrets.url,
    'env-anon': secrets.anon,
    'env-service': secrets.service,
    ...(routeOverrides.valuesById ?? {}),
  };

  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });

    if (url === `${secrets.url}/auth/v1/settings`) {
      return routeOverrides.settings ?? jsonResponse({ disable_signup: false });
    }
    if (url === `${secrets.url}/auth/v1/admin/users?page=1&per_page=1`) {
      return routeOverrides.userList ?? jsonResponse({ users: [{ id: 'existing-user-id' }] });
    }
    if (url === `${secrets.url}/auth/v1/admin/users/existing-user-id`) {
      return routeOverrides.user ?? jsonResponse({ id: 'existing-user-id' });
    }
    if (url === `https://api.vercel.com/v9/projects/${VERCEL_PROJECT}/env?teamId=${VERCEL_TEAM}`) {
      return routeOverrides.vercelList ?? jsonResponse({ envs: validVercelEntries(routeOverrides) });
    }

    const match = url.match(new RegExp(`^https://api\\.vercel\\.com/v9/projects/${VERCEL_PROJECT}/env/([^?]+)\\?teamId=${VERCEL_TEAM}&decrypt=true$`));
    if (match) return jsonResponse({ value: valuesById[decodeURIComponent(match[1])] });

    throw new Error(`Unexpected mocked URL: ${url}`);
  };

  const logger = {
    log: (message) => logs.push(String(message)),
    error: (message) => logs.push(String(message)),
  };

  return { env, fetchImpl, logger, calls, logs };
}

async function expectFailure(harness, pattern) {
  let error;
  try {
    await runProductionAuthPreflight(harness);
  } catch (caught) {
    error = caught;
  }
  assert.ok(error instanceof Error, 'preflight must fail closed');
  assert.match(error.message, pattern);
  return error;
}

async function testSuccess() {
  const harness = createHarness();
  const result = await runProductionAuthPreflight(harness);
  assert.deepEqual(result, { ok: true });
  assert.equal(harness.calls.length, 7);
  assert.ok(harness.calls.every(({ init }) => init.method === 'GET'), 'every network call must explicitly use GET');
  assert.ok(harness.logs.every((line) => /: (pass|match)$/.test(line)), 'success logs must contain check names and status only');
  assert.ok(harness.calls[0].init.headers.Authorization.endsWith(secrets.anon));
  assert.ok(harness.calls[1].init.headers.Authorization.endsWith(secrets.service));
  assert.equal(harness.calls[3].init.headers.Authorization, `Bearer ${secrets.vercel}`);
}

async function testGenericOnlyEnvironmentFailsBeforeRequests() {
  const genericSecrets = {
    url: 'https://generic-only-project.supabase.co',
    anon: 'generic-only-anon-secret',
    service: 'generic-only-service-secret',
  };
  const env = {
    VERCEL_TOKEN: secrets.vercel,
    NEXT_PUBLIC_SUPABASE_URL: genericSecrets.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: genericSecrets.anon,
    SUPABASE_SERVICE_ROLE_KEY: genericSecrets.service,
  };
  const harness = createHarness({ env });
  const error = await expectFailure(harness, /^canonical credentials: fail \(missing CANARY_PROD_SUPABASE_URL\)$/);
  assert.equal(harness.calls.length, 0);
  const output = [error.message, ...harness.logs].join('\n');
  for (const value of Object.values(genericSecrets)) {
    assert.equal(output.includes(value), false, 'generic Supabase values must not leak');
  }
}

async function testProjectMismatch() {
  const wrongUrl = 'https://wrongprojectref00000.supabase.co';
  const harness = createHarness({ env: canonicalEnv({ CANARY_PROD_SUPABASE_URL: wrongUrl }) });
  await expectFailure(harness, /^Supabase project reference: fail \(project mismatch\)$/);
  assert.equal(harness.calls.length, 0);
}

async function testSupabaseUrlPathRejectedWithoutLeakage() {
  const contaminatedUrl = `${secrets.url}/auth/v1`;
  const harness = createHarness({ env: canonicalEnv({ CANARY_PROD_SUPABASE_URL: contaminatedUrl }) });
  const error = await expectFailure(harness, /^Supabase project reference: fail \(project mismatch\)$/);
  assert.equal(harness.calls.length, 0);
  assert.equal([error.message, ...harness.logs].join('\n').includes(contaminatedUrl), false);
}

async function testSupabaseUrlCredentialsAndCustomOriginRejectedWithoutLeakage() {
  const contaminatedUrl = `https://user:password@${PROJECT_REF}.supabase.co:8443`;
  const harness = createHarness({ env: canonicalEnv({ CANARY_PROD_SUPABASE_URL: contaminatedUrl }) });
  const error = await expectFailure(harness, /^Supabase project reference: fail \(project mismatch\)$/);
  assert.equal(harness.calls.length, 0);
  assert.equal([error.message, ...harness.logs].join('\n').includes(contaminatedUrl), false);
}

async function testAnon401() {
  const harness = createHarness({ routeOverrides: { settings: jsonResponse({ leak: secrets.anon }, 401) } });
  await expectFailure(harness, /^Supabase anon settings: fail \(HTTP 401\)$/);
}

async function testServiceAdmin401() {
  const harness = createHarness({ routeOverrides: { userList: jsonResponse({ leak: secrets.service }, 401) } });
  await expectFailure(harness, /^Supabase admin user list: fail \(HTTP 401\)$/);
}

async function testEmptyAdminList() {
  const harness = createHarness({ routeOverrides: { userList: jsonResponse({ users: [] }) } });
  await expectFailure(harness, /^Supabase admin user list: fail \(empty verification set\)$/);
}

async function testMissingVercelEntry() {
  const entries = validVercelEntries().filter(({ key }) => key !== 'SUPABASE_SERVICE_ROLE_KEY');
  const harness = createHarness({ routeOverrides: { entries } });
  await expectFailure(harness, /^Vercel SUPABASE_SERVICE_ROLE_KEY metadata: fail \(missing production entry\)$/);
}

async function testDuplicateVercelEntry() {
  const entries = [...validVercelEntries(), { id: 'env-anon-copy', key: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', target: ['production'] }];
  const harness = createHarness({ routeOverrides: { entries } });
  await expectFailure(harness, /^Vercel NEXT_PUBLIC_SUPABASE_ANON_KEY metadata: fail \(duplicate entries\)$/);
}

async function testProductionAndPreviewVercelDuplicate() {
  const entries = [...validVercelEntries(), { id: 'env-anon-preview', key: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', target: ['preview'] }];
  const harness = createHarness({ routeOverrides: { entries } });
  await expectFailure(harness, /^Vercel NEXT_PUBLIC_SUPABASE_ANON_KEY metadata: fail \(duplicate entries\)$/);
}

async function testNonProductionVercelEntry() {
  const entries = validVercelEntries().map((entry) => entry.key === 'NEXT_PUBLIC_SUPABASE_URL' ? { ...entry, target: ['preview'] } : entry);
  const harness = createHarness({ routeOverrides: { entries } });
  await expectFailure(harness, /^Vercel NEXT_PUBLIC_SUPABASE_URL metadata: fail \(missing production target\)$/);
}

async function testVercelValueMismatch() {
  const harness = createHarness({ routeOverrides: { valuesById: { 'env-service': 'different-secret-value' } } });
  await expectFailure(harness, /^Vercel SUPABASE_SERVICE_ROLE_KEY value: fail \(mismatch\)$/);
}

async function testSecretsNeverAppearInLogsOrErrors() {
  const harnesses = [
    createHarness(),
    createHarness({ routeOverrides: { settings: jsonResponse({ leaked: secrets.anon }, 500) } }),
    createHarness({ routeOverrides: { valuesById: { 'env-anon': 'decrypted-secret-that-must-not-leak' } } }),
  ];
  const output = [];
  for (const harness of harnesses) {
    try {
      await runProductionAuthPreflight(harness);
    } catch (error) {
      output.push(error.message);
    }
    output.push(...harness.logs);
  }
  const text = output.join('\n');
  for (const secret of [...Object.values(secrets), 'decrypted-secret-that-must-not-leak']) {
    assert.equal(text.includes(secret), false, 'logs and errors must not expose secret values');
  }
  assert.equal(text.includes('existing-user-id'), false, 'logs and errors must not expose user IDs');
}

await testSuccess();
await testGenericOnlyEnvironmentFailsBeforeRequests();
await testProjectMismatch();
await testSupabaseUrlPathRejectedWithoutLeakage();
await testSupabaseUrlCredentialsAndCustomOriginRejectedWithoutLeakage();
await testAnon401();
await testServiceAdmin401();
await testEmptyAdminList();
await testMissingVercelEntry();
await testDuplicateVercelEntry();
await testProductionAndPreviewVercelDuplicate();
await testNonProductionVercelEntry();
await testVercelValueMismatch();
await testSecretsNeverAppearInLogsOrErrors();

console.log('Production auth preflight tests passed.');

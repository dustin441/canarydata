import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { loadBindings } from 'next/dist/build/swc/index.js';
import {
  buildSocialCorrectionIdempotencyKey,
  buildSocialCorrectionRpcArgs,
  requireSocialCorrectionExpectedVersion,
} from '../src/lib/socialLifecycle.mjs';
import { environment, runSocialPilot } from './ingest-social-pilot.mjs';

const require = createRequire(import.meta.url);
const ACTOR_ID = '11111111-1111-1111-1111-111111111111';
const THREAD_ID = '22222222-2222-2222-2222-222222222222';
const RUN_ID = '33333333-3333-4333-8333-333333333333';
const ACCOUNT_ID = '44444444-4444-4444-8444-444444444444';
const STORED_THREAD_ID = '55555555-5555-4555-8555-555555555555';
const STORED_THREAD_ID_2 = '66666666-6666-4666-8666-666666666666';
const DISTRICT_ID = 'district-a';
const expectedCorrectionArgs = {
  p_actor_user_id: ACTOR_ID,
  p_expected_district_id: DISTRICT_ID,
  p_social_thread_id: THREAD_ID,
  p_action: 'exclude',
  p_expected_version: 7,
  p_idempotency_key: `social:${THREAD_ID}:exclude:v7`,
};
assert.equal(requireSocialCorrectionExpectedVersion(0), 0);
assert.equal(buildSocialCorrectionIdempotencyKey({ socialThreadId: THREAD_ID, action: 'exclude', expectedVersion: 7 }), expectedCorrectionArgs.p_idempotency_key);
assert.deepEqual(buildSocialCorrectionRpcArgs({
  actorId: ACTOR_ID,
  districtId: DISTRICT_ID,
  socialThreadId: THREAD_ID,
  action: 'exclude',
  expectedVersion: 7,
}), expectedCorrectionArgs);
for (const invalidVersion of [undefined, null, -1, 1.5, '7']) {
  assert.throws(() => requireSocialCorrectionExpectedVersion(invalidVersion), /non-negative integer/);
}
assert.throws(() => buildSocialCorrectionIdempotencyKey({ socialThreadId: 'x'.repeat(120), action: 'restore', expectedVersion: 1 }), /8 to 128/);
assert.throws(() => buildSocialCorrectionRpcArgs({ actorId: ACTOR_ID, districtId: DISTRICT_ID, socialThreadId: THREAD_ID, action: 'approve', expectedVersion: 1 }), /Unsupported social correction/);

const actionsSource = await readFile(new URL('../src/app/actions.js', import.meta.url), 'utf8');
const pilotSource = await readFile(new URL('./ingest-social-pilot.mjs', import.meta.url), 'utf8');

async function compileActionsHarness({
  isAdmin = true,
  actorDistrictId = DISTRICT_ID,
  thread = {
    id: THREAD_ID,
    district_id: DISTRICT_ID,
    social_account_id: 'account-1',
    platform: 'facebook',
    relationship_type: 'owned',
    visibility_status: 'active',
    review_version: 7,
  },
  rpcError = null,
  rpcData = { id: THREAD_ID, visibility_status: 'excluded', review_version: 8 },
} = {}) {
  const calls = { tables: [], rpcs: [], revalidated: [] };
  const admin = {
    auth: { admin: { getUserById: async () => ({ data: { user: {
      id: ACTOR_ID,
      app_metadata: { role: isAdmin ? 'admin' : 'customer', district_id: actorDistrictId },
    } } }) } },
    from(table) {
      const call = { table, select: null, predicates: [] };
      calls.tables.push(call);
      const query = {
        select(columns) { call.select = columns; return query; },
        eq(column, value) { call.predicates.push([column, value]); return query; },
        maybeSingle: async () => {
          if (table === 'social_threads') return { data: thread, error: null };
          if (table === 'social_accounts') return { data: {
            id: 'account-1', district_id: DISTRICT_ID, platform: 'facebook', handle: 'district', profile_url: null, active: true,
          }, error: null };
          throw new Error(`Unexpected maybeSingle table: ${table}`);
        },
        single: async () => {
          if (table === 'social_threads') return { data: { visibility_status: 'active', review_version: thread.review_version + 1 }, error: null };
          throw new Error(`Unexpected single table: ${table}`);
        },
      };
      return query;
    },
    async rpc(name, args) {
      calls.rpcs.push({ name, args });
      return { data: rpcData, error: rpcError };
    },
  };
  const lifecycle = await import('../src/lib/socialLifecycle.mjs');
  const modules = {
    '@/lib/supabase/admin': { createAdminClient: () => admin },
    '@/lib/supabase/server': { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: ACTOR_ID } } }) } }) },
    '@/lib/clickup': {
      createClickUpFeedbackTask() {}, createClickUpOnboardingTask() {}, createClickUpQueryReviewTask() {}, isClickUpConfigured: () => false,
    },
    'next/cache': { revalidatePath: (path) => calls.revalidated.push(path) },
    '@/lib/storyCorrections.mjs': { canonicalizeStoryUrl: (value) => value, requireCorrectionReason: (value) => value },
    '@/lib/queryPolicy.mjs': {
      CUSTOMER_SEARCH_QUERY_LIMIT: 10,
      applySearchQuerySnapshotFilters: (value) => value,
      buildSearchQueryUpdate: () => ({}),
      hasActiveSearchQueryDuplicate: () => false,
      reconcileActiveSearchQueryWrite: () => ({}),
      searchQueryFingerprint: (value) => value,
      searchQuerySnapshot: (value) => value,
      validateSearchQueryText: (value) => value,
    },
    '@/lib/onboarding-upload.mjs': { assertStrategicPlanFileSize() {} },
    '@/lib/socialLifecycle.mjs': lifecycle,
  };
  const bindings = await loadBindings();
  const compiled = await bindings.transform(actionsSource, {
    filename: 'actions.js',
    jsc: { parser: { syntax: 'ecmascript' }, target: 'es2022' },
    module: { type: 'commonjs' },
  });
  const moduleRecord = { exports: {} };
  const controlledRequire = (specifier) => {
    if (specifier.startsWith('node:')) return require(specifier);
    assert.ok(specifier in modules, `Unexpected module import in actions harness: ${specifier}`);
    return modules[specifier];
  };
  new Function('require', 'module', 'exports', compiled.code)(controlledRequire, moduleRecord, moduleRecord.exports);
  return { reviewSocialThread: moduleRecord.exports.reviewSocialThread, calls };
}

for (const action of ['exclude', 'restore']) {
  const thread = {
    id: THREAD_ID, district_id: DISTRICT_ID, social_account_id: 'account-1', platform: 'facebook',
    relationship_type: 'owned', visibility_status: action === 'exclude' ? 'active' : 'excluded', review_version: 7,
  };
  const returned = { id: THREAD_ID, visibility_status: action === 'exclude' ? 'excluded' : 'active', review_version: 8 };
  const harness = await compileActionsHarness({ thread, rpcData: returned });
  assert.deepEqual(await harness.reviewSocialThread({ socialThreadId: THREAD_ID, action, expectedVersion: 7 }), returned);
  assert.equal(harness.calls.tables.length, 1, `${action} must read the target thread once.`);
  assert.equal(harness.calls.tables[0].table, 'social_threads');
  assert.deepEqual(harness.calls.tables[0].predicates, [['id', THREAD_ID]]);
  assert.deepEqual(harness.calls.rpcs, [{
    name: 'canary_apply_social_correction',
    args: { ...expectedCorrectionArgs, p_action: action, p_idempotency_key: `social:${THREAD_ID}:${action}:v7` },
  }]);
  assert.deepEqual(harness.calls.revalidated, ['/dashboard']);
}

for (const invalidVersion of [undefined, -1, 2.5, '7']) {
  const harness = await compileActionsHarness();
  await assert.rejects(
    harness.reviewSocialThread({ socialThreadId: THREAD_ID, action: 'exclude', expectedVersion: invalidVersion }),
    /non-negative integer/,
  );
  assert.equal(harness.calls.rpcs.length, 0, 'Invalid lifecycle versions must fail before RPC execution.');
  assert.equal(harness.calls.tables.length, 0, 'Invalid lifecycle versions must fail before the thread query.');
}

const rpcFailure = new Error('atomic correction failed');
const failingActionHarness = await compileActionsHarness({ rpcError: rpcFailure });
await assert.rejects(
  failingActionHarness.reviewSocialThread({ socialThreadId: THREAD_ID, action: 'exclude', expectedVersion: 7 }),
  (error) => error === rpcFailure,
);
assert.deepEqual(failingActionHarness.calls.revalidated, []);

const nonAdminHarness = await compileActionsHarness({ isAdmin: false, actorDistrictId: 'district-b' });
await assert.rejects(
  nonAdminHarness.reviewSocialThread({ socialThreadId: THREAD_ID, action: 'exclude', expectedVersion: 7 }),
  /Canary reviewer access is required/,
);
assert.equal(nonAdminHarness.calls.rpcs.length, 0, 'A non-admin cross-district caller must not reach an RPC.');
assert.equal(nonAdminHarness.calls.tables.length, 0, 'Reviewer denial must precede cross-district thread access.');

const unsupportedApprovalHarness = await compileActionsHarness();
await assert.rejects(
  unsupportedApprovalHarness.reviewSocialThread({ socialThreadId: THREAD_ID, action: 'approve', expectedVersion: 7 }),
  /Unsupported social correction action/,
);
assert.equal(unsupportedApprovalHarness.calls.rpcs.length, 0, 'The N application must not call the legacy approval RPC.');
assert.equal(unsupportedApprovalHarness.calls.tables.length, 0, 'Unsupported legacy actions must fail before thread access.');

const baseItem = {
  platform: 'facebook',
  external_thread_id: 'post-1',
  canonical_url: 'https://facebook.test/post-1',
  relationship_type: 'owned',
  body: 'District update',
  published_at: '2026-08-04T12:00:00Z',
};
const fsFor = (items) => ({ readFile: async () => JSON.stringify({ items }) });
const canonicalEnv = {
  CANARY_PROD_SUPABASE_URL: 'https://fehdonfrlsrrkzaemkxp.supabase.co/',
  CANARY_PROD_SUPABASE_SERVICE_ROLE_KEY: 'canonical-secret-key',
};
const APPROVED_ORIGIN = 'https://fehdonfrlsrrkzaemkxp.supabase.co';
const contaminatedUrls = [
  'http://fehdonfrlsrrkzaemkxp.supabase.co',
  'https://evil.example',
  'https://fehdonfrlsrrkzaemkxp.supabase.co.evil.example',
  'https://evil-fehdonfrlsrrkzaemkxp.supabase.co',
  'https://user@fehdonfrlsrrkzaemkxp.supabase.co',
  'https://fehdonfrlsrrkzaemkxp.supabase.co:443',
  'https://fehdonfrlsrrkzaemkxp.supabase.co/rest/v1',
  'https://fehdonfrlsrrkzaemkxp.supabase.co/?query=1',
  'https://fehdonfrlsrrkzaemkxp.supabase.co/#fragment',
];
assert.deepEqual(environment(canonicalEnv), {
  url: APPROVED_ORIGIN,
  key: canonicalEnv.CANARY_PROD_SUPABASE_SERVICE_ROLE_KEY,
});
for (const contaminatedUrl of contaminatedUrls) {
  assert.throws(
    () => environment({ ...canonicalEnv, CANARY_PROD_SUPABASE_URL: contaminatedUrl }),
    (error) => {
      assert.doesNotMatch(error.message, new RegExp(contaminatedUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.doesNotMatch(error.message, /canonical-secret-key/);
      return true;
    },
  );
}

const dryFetchCalls = [];
const dryLogs = [];
const dryResult = await runSocialPilot({
  argv: ['--input', 'fixture.json', '--provider', 'apify', '--district', DISTRICT_ID],
  processEnv: {},
  fsImpl: fsFor([baseItem]),
  fetchImpl: async (...args) => { dryFetchCalls.push(args); throw new Error('dry-run fetched'); },
  log: (value) => dryLogs.push(value),
});
assert.equal(dryResult.mode, 'dry-run');
assert.equal(dryFetchCalls.length, 0, 'Dry-run must not perform any fetch.');
assert.match(dryLogs[0], /"mode": "dry-run"/);

function response(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => data === null ? '' : JSON.stringify(data) };
}

function createPilotFetch({
  accounts = [],
  accountError = null,
  runResponse = [{ id: RUN_ID, status: 'running' }],
  duplicate = [],
  rpcResults = [],
  storedRows = [],
  patchResults = [],
} = {}) {
  const calls = [];
  let rpcIndex = 0;
  let patchIndex = 0;
  const fetchImpl = async (url, options) => {
    const call = {
      url,
      method: options.method,
      headers: options.headers,
      body: options.body ? JSON.parse(options.body) : undefined,
    };
    calls.push(call);
    const path = new URL(url).pathname + new URL(url).search;
    if (call.method === 'GET' && path.includes('/social_accounts?')) {
      if (accountError) throw accountError;
      return response(accounts);
    }
    if (call.method === 'POST' && path.endsWith('/social_collection_runs')) return response(runResponse);
    if (call.method === 'GET' && path.includes('/social_threads?')) return response(duplicate);
    if (call.method === 'POST' && path.endsWith('/rpc/canary_ingest_social_thread')) {
      const configured = rpcResults[rpcIndex];
      if (configured?.throw) throw configured.throw;
      if (configured && Object.hasOwn(configured, 'data')) {
        rpcIndex += 1;
        return response(configured.data, configured.status || 200);
      }
      const stored = {
        ...call.body.p_thread,
        id: rpcIndex === 0 ? STORED_THREAD_ID : STORED_THREAD_ID_2,
        review_version: 0,
        ...(storedRows[rpcIndex] || {}),
      };
      rpcIndex += 1;
      return response(stored);
    }
    if (call.method === 'PATCH' && path.includes('/social_collection_runs?')) {
      const configured = patchResults[patchIndex++];
      if (configured?.throw) throw configured.throw;
      if (configured && Object.hasOwn(configured, 'data')) return response(configured.data, configured.status || 200);
      return response([{
        id: RUN_ID,
        status: call.body.status,
        completed_at: call.body.completed_at,
      }]);
    }
    throw new Error(`Unexpected pilot request: ${call.method} ${url}`);
  };
  return { calls, fetchImpl };
}

async function runCommittedPilot({ items = [baseItem], processEnv = canonicalEnv, ...mockOptions } = {}) {
  const mock = createPilotFetch(mockOptions);
  const logs = [];
  const promise = runSocialPilot({
    argv: ['--input', 'fixture.json', '--provider', 'apify', '--district', DISTRICT_ID, '--commit'],
    processEnv,
    fsImpl: fsFor(items),
    fetchImpl: mock.fetchImpl,
    log: (value) => logs.push(value),
    now: () => new Date('2026-08-04T13:00:00.000Z'),
  });
  return { mock, logs, promise };
}

const matchingAccount = {
  id: ACCOUNT_ID, provider: 'apify', platform: 'facebook', handle: 'district', profile_url: null, active: true,
};
const matchingRun = await runCommittedPilot({
  items: [baseItem, { ...baseItem, external_thread_id: 'post-2', canonical_url: 'https://facebook.test/post-2' }],
  accounts: [matchingAccount],
  duplicate: [{ id: 'diagnostic-duplicate' }],
  rpcResults: [undefined, { data: [{
    id: STORED_THREAD_ID_2,
    district_id: DISTRICT_ID,
    provider: 'apify',
    platform: 'facebook',
    external_thread_id: 'post-2',
    visibility_status: 'active',
    review_version: 0,
  }] }],
});
const matchingResult = await matchingRun.promise;
const matchingRpcCalls = matchingRun.mock.calls.filter((call) => call.url.endsWith('/rest/v1/rpc/canary_ingest_social_thread'));
assert.equal(matchingRpcCalls.length, 2, 'Duplicate diagnostics must not suppress atomic mutation calls.');
for (const call of matchingRpcCalls) {
  assert.equal(call.body.p_thread.social_account_id, ACCOUNT_ID);
  assert.equal(call.body.p_thread.visibility_status, 'active');
  assert.equal(call.body.p_thread.provider_metadata.pilot_ingestion, true);
  assert.equal(call.body.p_thread.last_seen_at, '2026-08-04T13:00:00.000Z');
}
assert.equal(matchingResult.duplicateItems, 2);
assert.equal(matchingResult.acceptedThreads, 2);
assert.deepEqual(matchingResult.threadIds, [STORED_THREAD_ID, STORED_THREAD_ID_2]);

const untrustedRun = await runCommittedPilot({
  items: [baseItem],
  accounts: [
    { ...matchingAccount, id: '77777777-7777-4777-8777-777777777777', provider: 'other' },
    { ...matchingAccount, id: '88888888-8888-4888-8888-888888888888', platform: 'instagram' },
    { ...matchingAccount, id: '99999999-9999-4999-8999-999999999999', active: false },
    { ...matchingAccount, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', handle: '', profile_url: '' },
  ],
});
await untrustedRun.promise;
const untrustedRpc = untrustedRun.mock.calls.find((call) => call.url.endsWith('/rest/v1/rpc/canary_ingest_social_thread'));
assert.equal(untrustedRpc.body.p_thread.social_account_id, null);
assert.equal(untrustedRpc.body.p_thread.visibility_status, 'active');
const accountLookup = untrustedRun.mock.calls.find((call) => call.url.includes('/social_accounts?'));
assert.match(accountLookup.url, /active=eq\.true/);
assert.match(accountLookup.url, /select=id,provider,platform,handle,profile_url,active/);

const excludedRun = await runCommittedPilot({
  items: [{ ...baseItem, relationship_type: 'ambient', visibility_status: 'excluded' }],
  accounts: [],
});
await excludedRun.promise;
const excludedRpc = excludedRun.mock.calls.find((call) => call.url.endsWith('/rest/v1/rpc/canary_ingest_social_thread'));
assert.equal(excludedRpc.body.p_thread.social_account_id, null);
assert.equal(excludedRpc.body.p_thread.visibility_status, 'excluded');

const publicRun = await runCommittedPilot({
  items: [{ ...baseItem, relationship_type: 'ambient' }],
  accounts: [matchingAccount],
});
await publicRun.promise;
const publicRpc = publicRun.mock.calls.find((call) => call.url.endsWith('/rest/v1/rpc/canary_ingest_social_thread'));
assert.equal(publicRpc.body.p_thread.social_account_id, null);
assert.equal(publicRpc.body.p_thread.visibility_status, 'active');

const lifecyclePreservedRun = await runCommittedPilot({
  items: [baseItem],
  accounts: [matchingAccount],
  duplicate: [{ id: 'already-there' }],
  storedRows: [{ id: STORED_THREAD_ID, visibility_status: 'excluded', review_version: 4 }],
});
const lifecyclePreservedResult = await lifecyclePreservedRun.promise;
const lifecycleRequest = lifecyclePreservedRun.mock.calls.find((call) => call.url.endsWith('/rest/v1/rpc/canary_ingest_social_thread'));
assert.equal(lifecycleRequest.body.p_thread.visibility_status, 'active', 'N-1 input policy should still request active for a trusted owned post.');
assert.deepEqual(lifecyclePreservedResult.visibilityStatuses, { excluded: 1 }, 'The writer must report the lifecycle-preserving RPC result, not infer mutation state from the duplicate GET.');
assert.equal(lifecyclePreservedRun.mock.calls.filter((call) => call.method === 'POST' && call.url.includes('/social_threads')).length, 0);

const genericOnlyEnv = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://generic.supabase.test',
  SUPABASE_SERVICE_ROLE_KEY: 'generic-secret',
};
assert.throws(() => environment(genericOnlyEnv), /Canonical Canary Supabase/);
const genericRun = await runCommittedPilot({ items: [baseItem], accounts: [], processEnv: genericOnlyEnv });
await assert.rejects(genericRun.promise, (error) => {
  assert.match(error.message, /Canonical Canary Supabase/);
  assert.doesNotMatch(error.message, /generic\.supabase\.test|generic-secret/);
  return true;
});
assert.equal(genericRun.mock.calls.length, 0, 'Generic-only credentials must be rejected before fetch.');
assert.doesNotMatch(genericRun.logs.join('\n'), /generic\.supabase\.test|generic-secret/);

for (const contaminatedUrl of contaminatedUrls) {
  const contaminatedRun = await runCommittedPilot({
    processEnv: { ...canonicalEnv, CANARY_PROD_SUPABASE_URL: contaminatedUrl },
  });
  await assert.rejects(contaminatedRun.promise, (error) => {
    assert.doesNotMatch(error.message, new RegExp(contaminatedUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(error.message, /canonical-secret-key/);
    return true;
  });
  assert.equal(contaminatedRun.mock.calls.length, 0, 'Contaminated origins must fail before fetch.');
  assert.doesNotMatch(contaminatedRun.logs.join('\n'), /canonical-secret-key|fehdonfrlsrrkzaemkxp/);
}

const ambiguousAccounts = [matchingAccount, { ...matchingAccount, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', profile_url: 'https://facebook.test/district' }];
const ambiguityMessages = [];
for (const accounts of [ambiguousAccounts, [...ambiguousAccounts].reverse()]) {
  const ambiguousRun = await runCommittedPilot({ accounts });
  await assert.rejects(ambiguousRun.promise, (error) => {
    assert.match(error.message, /Multiple verified Social accounts/);
    ambiguityMessages.push(error.message);
    return true;
  });
  assert.equal(ambiguousRun.mock.calls.length, 1, 'Ambiguity must stop after account lookup.');
  assert.equal(ambiguousRun.mock.calls.filter((call) => call.method === 'POST').length, 0);
  assert.equal(ambiguousRun.mock.calls.filter((call) => call.method === 'PATCH').length, 0);
}
assert.equal(ambiguityMessages[0], ambiguityMessages[1], 'Account response order must not affect ambiguity rejection.');

for (const malformedAccounts of [null, {}]) {
  const malformedAccountRun = await runCommittedPilot({ accounts: malformedAccounts });
  await assert.rejects(malformedAccountRun.promise, /invalid response/);
  assert.equal(malformedAccountRun.mock.calls.length, 1);
  assert.equal(malformedAccountRun.mock.calls.filter((call) => call.method === 'PATCH').length, 0);
}

for (const malformedAccount of [
  {},
  { ...matchingAccount, id: 'truthy-not-a-uuid' },
  { ...matchingAccount, provider: '' },
  { ...matchingAccount, platform: 'mastodon' },
  { ...matchingAccount, active: 'true' },
  Object.fromEntries(Object.entries(matchingAccount).filter(([key]) => key !== 'handle')),
  Object.fromEntries(Object.entries(matchingAccount).filter(([key]) => key !== 'profile_url')),
  { ...matchingAccount, handle: 42 },
  { ...matchingAccount, profile_url: {} },
]) {
  const malformedAccountRun = await runCommittedPilot({ accounts: [malformedAccount] });
  await assert.rejects(malformedAccountRun.promise, /invalid response/);
  assert.equal(malformedAccountRun.mock.calls.length, 1, 'Every account row must be validated before run creation.');
}

const accountNetworkRun = await runCommittedPilot({
  accountError: new Error(`lookup failed ${APPROVED_ORIGIN} canonical-secret-key`),
});
await assert.rejects(accountNetworkRun.promise, (error) => {
  assert.equal(error.code, 'SUPABASE_REQUEST_FAILED');
  assert.match(error.message, /lookup failed \[REDACTED\] \[REDACTED\]/);
  return true;
});
assert.equal(accountNetworkRun.mock.calls.length, 1);
assert.equal(accountNetworkRun.mock.calls.filter((call) => call.method === 'PATCH').length, 0);

for (const malformedRunResponse of [
  null,
  {},
  [],
  [{}],
  [{ id: 'truthy-not-a-uuid', status: 'running' }],
  [{ id: RUN_ID }],
  [{ id: RUN_ID, status: 'success' }],
  [{ id: RUN_ID, status: 'running' }, { id: '77777777-7777-4777-8777-777777777777', status: 'running' }],
]) {
  const malformedRun = await runCommittedPilot({ runResponse: malformedRunResponse });
  await assert.rejects(malformedRun.promise, /could not be created/);
  assert.equal(malformedRun.mock.calls.length, 2, 'Malformed run creation must stop before processing.');
  assert.equal(malformedRun.mock.calls.filter((call) => call.method === 'PATCH').length, 0);
}

const objectRunResponse = await runCommittedPilot({ runResponse: { id: RUN_ID, status: 'running' } });
assert.equal((await objectRunResponse.promise).runId, RUN_ID);

const failingRun = await runCommittedPilot({
  accounts: [matchingAccount],
  rpcResults: [{ data: { code: 'RPC_FAILURE', message: `atomic failure ${canonicalEnv.CANARY_PROD_SUPABASE_SERVICE_ROLE_KEY}` }, status: 500 }],
});
await assert.rejects(failingRun.promise, (error) => {
  assert.equal(error.code, 'RPC_FAILURE');
  assert.match(error.message, /atomic failure \[REDACTED\]/);
  assert.doesNotMatch(error.message, /canonical-secret-key/);
  return true;
});
const failedPatch = failingRun.mock.calls.find((call) => call.method === 'PATCH');
assert.equal(failingRun.mock.calls.length, 5);
assert.equal(failedPatch.body.status, 'failed');
assert.equal(failedPatch.body.error_message, 'atomic failure [REDACTED]');
assert.doesNotMatch(JSON.stringify(failedPatch.body), /canonical-secret-key/);
assert.doesNotMatch(failingRun.logs.join('\n'), /canonical-secret-key/);

const transientFinalizationRun = await runCommittedPilot({
  accounts: [matchingAccount],
  rpcResults: [{ throw: new Error('RPC network primary') }],
  patchResults: [
    { data: { code: 'PATCH_TEMP', message: 'temporary patch failure' }, status: 503 },
    { data: [{ id: RUN_ID, status: 'failed', completed_at: '2026-08-04T13:00:00.000Z' }] },
  ],
});
await assert.rejects(transientFinalizationRun.promise, (error) => {
  assert.equal(error.code, 'SUPABASE_REQUEST_FAILED');
  assert.match(error.message, /RPC network primary/);
  return true;
});
assert.equal(transientFinalizationRun.mock.calls.filter((call) => call.method === 'PATCH').length, 2);
assert.equal(transientFinalizationRun.mock.calls.length, 6);
assert.ok(transientFinalizationRun.mock.calls.filter((call) => call.method === 'PATCH').every((call) => call.body.status === 'failed'));

const persistentFinalizationRun = await runCommittedPilot({
  accounts: [matchingAccount],
  rpcResults: [{ data: { code: 'PRIMARY_SAFE', message: 'primary RPC failure' }, status: 500 }],
  patchResults: [1, 2, 3].map(() => ({
    throw: new Error(`patch failure ${APPROVED_ORIGIN} canonical-secret-key`),
  })),
});
await assert.rejects(persistentFinalizationRun.promise, (error) => {
  assert.equal(error.code, 'PRIMARY_SAFE');
  assert.equal(error.cause?.code, 'PRIMARY_SAFE');
  assert.match(error.message, /^primary RPC failure Failed to finalize/);
  assert.doesNotMatch(error.message, /canonical-secret-key|fehdonfrlsrrkzaemkxp/);
  return true;
});
assert.equal(persistentFinalizationRun.mock.calls.filter((call) => call.method === 'PATCH').length, 3);
assert.equal(persistentFinalizationRun.mock.calls.length, 7);

const successPatchFailureRun = await runCommittedPilot({
  accounts: [matchingAccount],
  patchResults: [
    { data: { code: 'SUCCESS_PATCH_FAILED', message: 'success finalization failed' }, status: 500 },
    { data: [{ id: RUN_ID, status: 'failed', completed_at: '2026-08-04T13:00:00.000Z' }] },
  ],
});
await assert.rejects(successPatchFailureRun.promise, (error) => {
  assert.equal(error.code, 'SUCCESS_PATCH_FAILED');
  assert.match(error.message, /success finalization failed/);
  return true;
});
const successThenFailurePatches = successPatchFailureRun.mock.calls.filter((call) => call.method === 'PATCH');
assert.deepEqual(successThenFailurePatches.map((call) => call.body.status), ['success', 'failed']);
assert.equal(successPatchFailureRun.mock.calls.length, 6);

const zeroRowSuccessRun = await runCommittedPilot({
  accounts: [matchingAccount],
  patchResults: [
    { data: [] },
    { data: [{ id: RUN_ID, status: 'failed', completed_at: '2026-08-04T13:00:00.000Z' }] },
  ],
});
await assert.rejects(zeroRowSuccessRun.promise, /finalization response/i);
const zeroRowSuccessPatches = zeroRowSuccessRun.mock.calls.filter((call) => call.method === 'PATCH');
assert.deepEqual(zeroRowSuccessPatches.map((call) => call.body.status), ['success', 'failed']);
assert.equal(zeroRowSuccessPatches.length, 2);
assert.ok(zeroRowSuccessPatches.every((call) => call.headers.Prefer === 'return=representation'));

const noContentSuccessRun = await runCommittedPilot({
  accounts: [matchingAccount],
  patchResults: [
    { data: null, status: 204 },
    { data: [{ id: RUN_ID, status: 'failed', completed_at: '2026-08-04T13:00:00.000Z' }] },
  ],
});
await assert.rejects(noContentSuccessRun.promise, /finalization response/i);
assert.deepEqual(
  noContentSuccessRun.mock.calls.filter((call) => call.method === 'PATCH').map((call) => call.body.status),
  ['success', 'failed'],
);

const terminalMalformedRows = [
  null,
  [],
  {},
  [{ id: '77777777-7777-4777-8777-777777777777', status: 'success', completed_at: '2026-08-04T13:00:00.000Z' }],
  [{ id: RUN_ID, status: 'failed', completed_at: '2026-08-04T13:00:00.000Z' }],
  [
    { id: RUN_ID, status: 'success', completed_at: '2026-08-04T13:00:00.000Z' },
    { id: RUN_ID, status: 'success', completed_at: '2026-08-04T13:00:00.000Z' },
  ],
  [{ id: RUN_ID, status: 'success', completed_at: '' }],
  [{ id: RUN_ID, status: 'success', completed_at: 'not-a-date' }],
];
for (const malformedTerminalResponse of terminalMalformedRows) {
  const malformedTerminalRun = await runCommittedPilot({
    accounts: [matchingAccount],
    patchResults: [
      { data: malformedTerminalResponse },
      { data: [{ id: RUN_ID, status: 'failed', completed_at: '2026-08-04T13:00:00.000Z' }] },
    ],
  });
  await assert.rejects(malformedTerminalRun.promise, /finalization response/i);
  const patches = malformedTerminalRun.mock.calls.filter((call) => call.method === 'PATCH');
  assert.equal(patches.length, 2);
  assert.deepEqual(patches.map((call) => call.body.status), ['success', 'failed']);
}

const invalidThenValidFailureFinalizationRun = await runCommittedPilot({
  accounts: [matchingAccount],
  rpcResults: [{ throw: new Error('primary RPC network failure') }],
  patchResults: [
    { data: [] },
    { data: [{ id: RUN_ID, status: 'failed', completed_at: '2026-08-04T13:00:00.000Z' }] },
  ],
});
await assert.rejects(invalidThenValidFailureFinalizationRun.promise, /primary RPC network failure/);
const invalidThenValidPatches = invalidThenValidFailureFinalizationRun.mock.calls.filter((call) => call.method === 'PATCH');
assert.equal(invalidThenValidPatches.length, 2);
assert.ok(invalidThenValidPatches.every((call) => call.headers.Prefer === 'return=representation'));

const zeroRowFailureFinalizationRun = await runCommittedPilot({
  accounts: [matchingAccount],
  rpcResults: [{ data: { code: 'PRIMARY_ZERO_ROWS', message: 'primary zero-row failure' }, status: 500 }],
  patchResults: [{ data: [] }, { data: [] }, { data: [] }],
});
await assert.rejects(zeroRowFailureFinalizationRun.promise, (error) => {
  assert.equal(error.code, 'PRIMARY_ZERO_ROWS');
  assert.equal(error.cause?.code, 'PRIMARY_ZERO_ROWS');
  assert.match(error.message, /^primary zero-row failure Failed to finalize/);
  assert.doesNotMatch(error.message, /canonical-secret-key|fehdonfrlsrrkzaemkxp/);
  return true;
});
const zeroRowFailurePatches = zeroRowFailureFinalizationRun.mock.calls.filter((call) => call.method === 'PATCH');
assert.equal(zeroRowFailurePatches.length, 3);
assert.ok(zeroRowFailurePatches.every((call) => call.body.status === 'failed'));
assert.ok(zeroRowFailurePatches.every((call) => call.headers.Prefer === 'return=representation'));

const rpcNetworkRun = await runCommittedPilot({
  accounts: [matchingAccount],
  rpcResults: [{ throw: new Error(`RPC network ${APPROVED_ORIGIN} canonical-secret-key`) }],
});
await assert.rejects(rpcNetworkRun.promise, (error) => {
  assert.match(error.message, /RPC network \[REDACTED\] \[REDACTED\]/);
  assert.doesNotMatch(error.message, /canonical-secret-key|fehdonfrlsrrkzaemkxp/);
  return true;
});
assert.equal(rpcNetworkRun.mock.calls.filter((call) => call.method === 'PATCH' && call.body.status === 'failed').length, 1);
assert.equal(rpcNetworkRun.mock.calls.length, 5);

for (const malformedRpcResponse of [
  null,
  [],
  [{ id: STORED_THREAD_ID }, { id: STORED_THREAD_ID_2 }],
  {},
  { id: STORED_THREAD_ID },
  { id: 'truthy-not-a-uuid', district_id: DISTRICT_ID, provider: 'apify', platform: 'facebook', external_thread_id: 'post-1', visibility_status: 'active', review_version: 0 },
  { id: STORED_THREAD_ID, district_id: DISTRICT_ID, provider: 'apify', platform: 'facebook', external_thread_id: 'post-1', visibility_status: 'invalid', review_version: 0 },
  { id: STORED_THREAD_ID, district_id: DISTRICT_ID, provider: 'apify', platform: 'facebook', external_thread_id: 'post-1', visibility_status: 'active', review_version: -1 },
  { id: STORED_THREAD_ID, district_id: 'wrong-district', provider: 'apify', platform: 'facebook', external_thread_id: 'post-1', visibility_status: 'active', review_version: 0 },
  { id: STORED_THREAD_ID, district_id: DISTRICT_ID, provider: 'wrong-provider', platform: 'facebook', external_thread_id: 'post-1', visibility_status: 'active', review_version: 0 },
  { id: STORED_THREAD_ID, district_id: DISTRICT_ID, provider: 'apify', platform: 'instagram', external_thread_id: 'post-1', visibility_status: 'active', review_version: 0 },
  { id: STORED_THREAD_ID, district_id: DISTRICT_ID, provider: 'apify', platform: 'facebook', external_thread_id: 'wrong-thread', visibility_status: 'active', review_version: 0 },
]) {
  const malformedRpcRun = await runCommittedPilot({
    accounts: [matchingAccount],
    rpcResults: [{ data: malformedRpcResponse }],
  });
  await assert.rejects(malformedRpcRun.promise, /did not return a stored thread/);
  assert.equal(malformedRpcRun.mock.calls.filter((call) => call.method === 'PATCH' && call.body.status === 'failed').length, 1);
  assert.equal(malformedRpcRun.mock.calls.length, 5);
}

for (const mock of [
  matchingRun.mock, untrustedRun.mock, excludedRun.mock, publicRun.mock, lifecyclePreservedRun.mock, objectRunResponse.mock, failingRun.mock,
  transientFinalizationRun.mock, persistentFinalizationRun.mock, successPatchFailureRun.mock, rpcNetworkRun.mock,
]) {
  assert.ok(mock.calls.every((call) => new URL(call.url).origin === APPROVED_ORIGIN), 'Runtime requests must stay on the canonical Supabase REST origin.');
  assert.ok(mock.calls.every((call) => call.url.startsWith(`${APPROVED_ORIGIN}/rest/v1/`)), 'Runtime requests must use the canonical Supabase REST root.');
  assert.ok(mock.calls.every((call) => !/n8n/i.test(call.url)), 'Runtime must make no n8n calls.');
  assert.equal(mock.calls.filter((call) => call.method === 'POST' && /\/social_threads(?:\?|$)/.test(call.url)).length, 0, 'No direct social_threads mutation is allowed.');
}
assert.doesNotMatch(pilotSource, /NEXT_PUBLIC_SUPABASE_URL|(?<!CANARY_PROD_)SUPABASE_SERVICE_ROLE_KEY/);
assert.doesNotMatch(pilotSource, /social_threads\?on_conflict/);
assert.match(pilotSource, /rpc\/canary_ingest_social_thread/);
assert.doesNotMatch(pilotSource, /n8n/i);
assert.match(actionsSource, /canary_apply_social_correction/);

console.log('Offline Social runtime wiring tests passed.');

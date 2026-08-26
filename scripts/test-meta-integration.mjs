import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.META_APP_ID = 'test-app-id';
process.env.META_APP_SECRET = 'test-app-secret';
process.env.META_CONFIG_ID = 'test-config-id';
process.env.META_REDIRECT_URI = 'https://www.canarydata.media/api/integrations/meta/callback';
process.env.META_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.META_INTEGRATION_ENABLED = 'true';
process.env.META_INTEGRATION_PILOT_DISTRICT_IDS = 'district-pilot,district-second';

const meta = await import('../src/lib/meta-integration.mjs');

assert.equal(meta.metaIntegrationEnabledForDistrict('district-pilot'), true, 'Explicit pilot district must be enabled when configuration is complete.');
assert.equal(meta.metaIntegrationEnabledForDistrict('district-outside'), false, 'A configured global flag must not enable an unlisted district.');
process.env.META_INTEGRATION_PILOT_DISTRICT_IDS = '';
assert.equal(meta.metaIntegrationEnabledForDistrict('district-pilot'), false, 'An empty pilot allowlist must fail closed.');
process.env.META_INTEGRATION_PILOT_DISTRICT_IDS = 'district-pilot,district-second';

const { state, stateHash, attemptId } = meta.createOauthState();
assert.ok(state.length >= 40, 'OAuth state must have high entropy.');
assert.equal(meta.hashOauthState(state), stateHash, 'OAuth state hash must be deterministic.');
assert.notEqual(state, stateHash, 'Raw OAuth state must not be stored as its hash.');
assert.match(attemptId, /^[0-9a-f-]{36}$/i, 'Each OAuth state must carry a distinct attempt identity.');
assert.equal(meta.constantTimeEqualText(stateHash, stateHash), true);
assert.equal(meta.constantTimeEqualText(stateHash, `${stateHash}x`), false);

const tokenContext = 'connection-id:district-id:meta';
const encrypted = meta.encryptMetaToken('sensitive-token', tokenContext);
assert.ok(!encrypted.includes('sensitive-token'), 'Encrypted token must not contain plaintext.');
assert.equal(meta.decryptMetaToken(encrypted, tokenContext), 'sensitive-token', 'Encrypted Meta token must round-trip.');
assert.throws(() => meta.decryptMetaToken(encrypted, 'wrong-context'), 'Wrong AAD must fail authentication.');
const tampered = `${encrypted.slice(0, -1)}${encrypted.endsWith('A') ? 'B' : 'A'}`;
assert.throws(() => meta.decryptMetaToken(tampered, tokenContext), 'Tampered ciphertext must fail authentication.');

assert.deepEqual(meta.META_CONFIGURATION_PERMISSIONS, [
  'pages_show_list',
  'pages_read_engagement',
  'instagram_basic',
  'read_insights',
  'instagram_manage_insights',
]);
assert.deepEqual(meta.META_REQUIRED_SCOPES, [
  'pages_show_list',
  'pages_read_engagement',
  'instagram_basic',
  'read_insights',
  'instagram_manage_insights',
]);
for (const forbidden of ['business_management', 'ads_read', 'ads_management', 'pages_manage_posts']) {
  assert.ok(!meta.META_REQUIRED_SCOPES.includes(forbidden), `Read-only owned-account release must not request ${forbidden}.`);
}
assert.equal(meta.metaEpochExpiry(1_800_000_000), '2027-01-15T08:00:00.000Z');
assert.equal(meta.metaEpochExpiry(0), null);
assert.equal(meta.earliestMetaReconnectDeadline('2027-02-01T00:00:00Z', '2027-01-15T00:00:00Z'), '2027-01-15T00:00:00.000Z');
assert.equal(meta.earliestMetaReconnectDeadline(null, null), null);

const authUrl = new URL(meta.buildMetaAuthorizationUrl(state));
assert.equal(authUrl.hostname, 'www.facebook.com');
assert.equal(authUrl.searchParams.get('client_id'), 'test-app-id');
assert.equal(authUrl.searchParams.get('config_id'), 'test-config-id');
assert.equal(authUrl.searchParams.get('redirect_uri'), process.env.META_REDIRECT_URI);
assert.equal(authUrl.searchParams.get('state'), state);
assert.equal(authUrl.searchParams.get('response_type'), 'code');
assert.equal(authUrl.searchParams.get('override_default_response_type'), 'true');
assert.equal(authUrl.searchParams.has('scope'), false, 'Business Login configuration must replace the scope query parameter.');
assert.equal(authUrl.searchParams.has('auth_type'), false, 'Business Login configuration must not use the legacy rerequest parameter.');
assert.ok(!authUrl.toString().includes('test-app-secret'), 'Meta app secret must never enter the browser authorization URL.');
assert.equal(meta.sanitizeReturnPath('/dashboard/integrations?districtId=abc'), '/dashboard/integrations?districtId=abc');
assert.equal(meta.sanitizeReturnPath('https://evil.example/steal'), '/dashboard/integrations');
assert.deepEqual(meta.metaGrantedScopes({
  scopes: ['business_management', 'pages_show_list', 'pages_show_list'],
  granular_scopes: [{ scope: 'pages_read_engagement', target_ids: ['page-1'] }, { scope: 'instagram_basic' }],
}), ['business_management', 'pages_show_list', 'pages_read_engagement', 'instagram_basic']);
assert.deepEqual(meta.metaGrantedScopes(null), []);

const originalFetch = globalThis.fetch;
let graphRequest;
globalThis.fetch = async (url, options) => {
  graphRequest = { url: String(url), options };
  return { ok: true, json: async () => [{ code: 200, body: JSON.stringify({ id: 'meta-user-1' }) }] };
};
assert.equal((await meta.metaGraph('me', 'url-sensitive-token', { fields: 'id' })).id, 'meta-user-1');
assert.ok(!graphRequest.url.includes('url-sensitive-token'), 'Meta access tokens must not appear in Graph request URLs.');
assert.ok(!graphRequest.url.includes('appsecret_proof'), 'Meta app-secret proofs must not appear in Graph request URLs.');
assert.equal(graphRequest.options.method, 'POST');
assert.ok(String(graphRequest.options.body).includes('batch='), 'Read requests must use a body-authenticated Graph batch call.');
const aborted = new AbortController();
aborted.abort(new Error('execution budget'));
await meta.metaGraph('me', 'url-sensitive-token', { fields: 'id' }, { signal: aborted.signal });
assert.equal(graphRequest.options.signal.aborted, true, 'Native sync must propagate an already-aborted execution signal into Graph fetch.');
globalThis.fetch = async (url, options) => {
  graphRequest = { url: String(url), options };
  return { ok: true, json: async () => [{
    code: 200,
    body: JSON.stringify({ data: { is_valid: true, app_id: 'test-app-id', user_id: 'meta-user-1', scopes: ['pages_show_list'] } }),
  }] };
};
assert.equal((await meta.debugMetaToken('url-sensitive-token')).is_valid, true);
assert.ok(!graphRequest.url.includes('url-sensitive-token'), 'Meta debug input tokens must not appear in request URLs.');
assert.ok(!graphRequest.url.includes('test-app-secret'), 'Meta app credentials must not appear in debug request URLs.');
assert.equal(graphRequest.options.method, 'POST');
assert.ok(String(graphRequest.options.body).includes('batch='), 'Token introspection must use a body-authenticated Graph Batch GET.');
await meta.debugMetaToken('url-sensitive-token', { signal: aborted.signal });
assert.equal(graphRequest.options.signal.aborted, true, 'Token introspection must share the native-sync execution signal.');
globalThis.fetch = async (url, options) => {
  graphRequest = { url: String(url), options };
  return { ok: true, json: async () => ({ success: true }) };
};
await meta.revokeMetaPermissions('url-sensitive-token');
assert.ok(!graphRequest.url.includes('url-sensitive-token'), 'Revocation tokens must not appear in URLs.');
assert.ok(!graphRequest.url.includes('appsecret_proof'), 'Revocation proofs must not appear in URLs.');
assert.equal(graphRequest.options.method, 'DELETE');
globalThis.fetch = originalFetch;

const deletionNow = new Date('2026-08-26T13:00:00.000Z');
const signedPayload = Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: 'meta-user-1', issued_at: Math.floor(deletionNow.getTime() / 1000) })).toString('base64url');
const signedSignature = (await import('node:crypto')).createHmac('sha256', process.env.META_APP_SECRET).update(signedPayload).digest('base64url');
const verifiedSignedPayload = meta.verifyMetaSignedRequest(`${signedSignature}.${signedPayload}`, deletionNow);
assert.equal(verifiedSignedPayload.user_id, 'meta-user-1');
const paddedSignaturePayload = meta.verifyMetaSignedRequest(`${signedSignature}==.${signedPayload}`, deletionNow);
assert.equal(paddedSignaturePayload.signed_request_hash, verifiedSignedPayload.signed_request_hash, 'Equivalent signature encodings must deduplicate to one canonical request identity.');
assert.throws(() => meta.verifyMetaSignedRequest(`invalid.${signedPayload}`, deletionNow), 'Invalid signed requests must be rejected.');
for (const issued_at of [Math.floor(deletionNow.getTime() / 1000) - meta.META_DELETION_MAX_AGE_SECONDS - 1, Math.floor(deletionNow.getTime() / 1000) + meta.META_DELETION_FUTURE_SKEW_SECONDS + 1]) {
  const payload = Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: 'meta-user-1', issued_at })).toString('base64url');
  const signature = (await import('node:crypto')).createHmac('sha256', process.env.META_APP_SECRET).update(payload).digest('base64url');
  assert.throws(() => meta.verifyMetaSignedRequest(`${signature}.${payload}`, deletionNow), /Expired Meta signed request/);
}

const sql = fs.readFileSync(new URL('../supabase/meta_social_integration.sql', import.meta.url), 'utf8');
for (const table of ['social_provider_oauth_states', 'social_provider_connections', 'social_provider_credentials', 'social_provider_assets', 'social_account_mappings', 'social_sync_runs', 'social_provider_deletion_requests']) {
  assert.ok(sql.includes(`alter table public.${table} enable row level security`), `${table} must enable RLS.`);
  assert.ok(sql.includes(`revoke all on public.${table} from anon, authenticated`), `${table} must revoke browser roles.`);
}
assert.ok(sql.includes('district_id text not null references public.districts(id)'), 'District IDs must match the existing text schema.');
assert.ok(sql.includes("asset_type in ('facebook_page','instagram_account','ad_account')"));
assert.ok(sql.includes('canary_consume_meta_oauth_state'), 'OAuth state consumption must be atomic.');
assert.ok(sql.includes('canary_replace_meta_asset_mappings'), 'Asset mapping replacement must be transactional.');
assert.ok(sql.includes('canary_finalize_meta_connection'), 'Connection, credential, and asset persistence must be transactional.');
assert.ok(sql.includes('canary_disconnect_meta_connection'), 'Local disconnect must be transactional.');
assert.ok(sql.includes('provider_app_id text not null'), 'Each connection must record the Meta app that issued it.');
assert.ok(sql.includes('unique (district_id, provider)'), 'The first release must enforce one Meta connection per district.');
assert.ok(sql.includes('connected_by uuid references auth.users(id) on delete set null'));
assert.ok(sql.includes('mapped_by uuid references auth.users(id) on delete set null'));

const callback = fs.readFileSync(new URL('../src/app/api/integrations/meta/callback/route.js', import.meta.url), 'utf8');
assert.ok(!callback.includes('exchangeLongLivedMetaToken'), 'BISU code exchange already returns the configured system-user token and must not use the legacy user-token extension flow.');
assert.ok(callback.includes("admin.rpc('canary_consume_meta_oauth_state'"), 'Callback must atomically consume state.');
assert.ok(callback.includes('canary_meta_oauth_binding'), 'Callback must require the OAuth binding cookie.');
assert.ok(callback.includes("admin.rpc('canary_prepare_meta_connection_v2'"), 'Callback must use the issuance-aware versioned prepare RPC.');
assert.ok(callback.includes("admin.rpc('canary_finalize_meta_connection_v2'"), 'Callback persistence must be transactional and include data-access expiry.');
assert.ok(callback.includes('p_data_access_expires_at'), 'Callback must persist Meta data-access expiration separately from token expiry.');
assert.ok(!callback.includes(".from('social_provider_credentials')"), 'Callback must not write credentials outside the finalization transaction.');
assert.ok(callback.includes("p_provider_app_id: process.env.META_APP_ID"), 'Callback must bind persisted connections to the configured Meta app.');
assert.ok(callback.includes('encryptMetaToken(accessToken, tokenContext)'), 'User token must be encrypted with AAD before storage.');
assert.ok(callback.includes('debugMetaToken(accessToken)'), 'OAuth exchange must introspect and bind the grant to the configured app and provider identity.');
assert.ok(callback.includes('metaIntegrationEnabledForDistrict(actor.districtId)'), 'Callback must re-check the exact pilot district after atomic state consumption and before code exchange.');
assert.ok(!callback.includes('revokeMetaPermissions(accessToken)'), 'A failed OAuth attempt must not perform app/user-wide compensating revocation.');
assert.ok(callback.includes("admin.rpc('canary_abandon_meta_connection_attempt'"), 'A failed callback must clean up only its attempt-bound local state.');
assert.ok(callback.includes('p_expected_lifecycle_version'), 'Callback preparation must use the state-recorded lifecycle version.');
assert.ok(callback.includes('p_attempt_id: preparedAttemptId'), 'Finalization must compare-and-set the exact consumed OAuth attempt.');
assert.ok(callback.includes('metaGrantedScopes(tokenData)'), 'BISU permissions must come from token introspection.');
assert.ok(!callback.includes("metaGraph('me/permissions'"), 'BISU callback must not call the legacy personal-user permissions edge.');
assert.ok(callback.includes("const providerUserId = String(tokenData.user_id)"), 'BISU provider identity must come from the validated token subject.');
assert.ok(callback.includes("status: declined.length ? 'needs_permissions' : 'active'"), 'Denied permissions must remain a visible connection state.');
assert.ok(!callback.includes("granted.includes('ads_read')"), 'Owned-Social authorization must not request or discover ad accounts.');
assert.ok(callback.includes("granted.includes('pages_show_list')"), 'Page discovery must tolerate denied pages_show_list.');
assert.ok(!callback.includes("fields: 'id,name,category,tasks,access_token"), 'Page access tokens must not be requested during discovery.');
assert.ok(!callback.includes('access_token: accessToken,'), 'Callback database payload must not store plaintext user token.');

const disconnectRoute = fs.readFileSync(new URL('../src/app/api/integrations/meta/disconnect/route.js', import.meta.url), 'utf8');
assert.ok(disconnectRoute.includes("admin.rpc('canary_disconnect_meta_connection'"), 'Disconnect mutations must be transactional.');
assert.ok(!disconnectRoute.includes(".from('social_provider_assets')"), 'Disconnect must not mutate assets outside the transaction.');
assert.ok(!disconnectRoute.includes('revokeMetaPermissions'), 'Per-district disconnect must never call Meta app/user-wide permission revocation.');
assert.ok(disconnectRoute.includes("disconnectScope: 'district_local'"), 'Disconnect must disclose its safe local-only boundary.');

const actorRoute = fs.readFileSync(new URL('../src/lib/integration-auth.js', import.meta.url), 'utf8');
assert.ok(actorRoute.includes("permissions.includes('manage_integrations')"), 'Integration access must require protected capability metadata.');
assert.ok(!actorRoute.includes('user_metadata'), 'Integration authorization must not use editable user_metadata.');
assert.ok(actorRoute.includes('const districtId = isAdmin ? requestedDistrictId : assignedDistrictId'), 'Admins must provide an explicit district to every integration API route.');

const deletionRoute = fs.readFileSync(new URL('../src/app/api/integrations/meta/data-deletion/route.js', import.meta.url), 'utf8');
assert.ok(deletionRoute.includes('export async function GET()'), 'Meta must be able to validate the public deletion callback URL without a signed deletion payload.');
assert.ok(deletionRoute.includes("method: 'POST'"), 'Deletion callback validation must state that mutations require POST.');
assert.ok(deletionRoute.includes("admin.rpc('canary_complete_meta_data_deletion_v2'"), 'Meta deletion, deduplication, and its confirmation record must be transactional.');
assert.ok(deletionRoute.includes('p_signed_request_hash') && deletionRoute.includes('p_issued_at'), 'Deletion callback must bind a fresh signed request to its durable receipt.');
assert.ok(!deletionRoute.includes(".from('social_provider_connections')"), 'Meta deletion must not delete connections outside the transaction.');
assert.ok(deletionRoute.includes('metaDeletionConfigured()'), 'Meta deletion must depend only on deletion-specific configuration.');
assert.ok(sql.includes('canary_complete_meta_data_deletion'), 'Meta data deletion must have a transactional RPC.');

const authMiddleware = fs.readFileSync(new URL('../src/lib/supabase/middleware.js', import.meta.url), 'utf8');
assert.ok(authMiddleware.includes("request.nextUrl.pathname === '/api/integrations/meta/data-deletion'"), 'Meta deletion callback must be public for Meta.');
assert.ok(authMiddleware.includes("request.nextUrl.pathname === '/api/integrations/meta/data-deletion/status'"), 'Meta deletion status URL must be public.');

const statusRoute = fs.readFileSync(new URL('../src/app/api/integrations/meta/route.js', import.meta.url), 'utf8');
const startRoute = fs.readFileSync(new URL('../src/app/api/integrations/meta/start/route.js', import.meta.url), 'utf8');
const accountsRoute = fs.readFileSync(new URL('../src/app/api/integrations/meta/accounts/route.js', import.meta.url), 'utf8');
const syncRoute = fs.readFileSync(new URL('../src/app/api/integrations/meta/sync/route.js', import.meta.url), 'utf8');
for (const [label, source] of [['status', statusRoute], ['start', startRoute], ['accounts', accountsRoute], ['sync', syncRoute]]) {
  assert.ok(source.includes('metaIntegrationEnabledForDistrict'), `${label} route must enforce the exact pilot-district allowlist.`);
}
assert.ok(startRoute.includes(".select('id,lifecycle_version')"), 'OAuth start must snapshot the current connection identity and lifecycle version.');
assert.ok(startRoute.includes('expected_connection_id: expectedConnection?.id || null'), 'OAuth state must persist its expected connection identity.');
assert.ok(!statusRoute.includes('encrypted_access_token'), 'Browser status route must not select encrypted connection tokens.');
assert.ok(!statusRoute.includes('social_provider_credentials'), 'Browser status route must not query credentials.');

const integrationPage = fs.readFileSync(new URL('../src/app/dashboard/integrations/page.js', import.meta.url), 'utf8');
const integrationClient = fs.readFileSync(new URL('../src/app/dashboard/integrations/MetaIntegrationClient.js', import.meta.url), 'utf8');
assert.ok(integrationPage.includes('const districtId = isAdmin\n    ? (requestedDistrictId'), 'Administrators must not receive an implicit first-district selection.');
assert.ok(integrationClient.includes('<option value="" disabled>Select one district</option>'), 'Admin district picker must require an explicit selection.');
assert.ok(integrationClient.includes('if (!districtId)'), 'Integration client must avoid loading Meta data before an admin selects a district.');

const dashboardClient = fs.readFileSync(new URL('../src/app/dashboard/DashboardClient.js', import.meta.url), 'utf8');
assert.ok(dashboardClient.includes('Facebook & Instagram'), 'Settings must identify the Meta owned-social connection clearly.');
assert.ok(dashboardClient.includes('Manage Meta connection'), 'Settings must expose the Meta connection action.');
assert.ok(dashboardClient.includes('metaIntegrationEnabled={metaIntegrationEnabled}'), 'Settings must receive server-verified Meta configuration status.');
assert.ok(!dashboardClient.includes('<span className="sidebar-link-icon">🔗</span>'), 'Meta integration must live in Settings rather than as a standalone sidebar item.');
assert.ok(dashboardClient.includes(": '/dashboard/integrations'}>Manage Meta connection</a>"), 'Administrator Settings navigation must enter integrations without a reporting-filter district.');
assert.ok(!dashboardClient.includes('metaIntegrationEnabled={metaIntegrationEnabled} selectedDistrictId={districtFilter}'), 'Settings must not receive the dashboard reporting district as integration intent.');
const lifecycleMigration = fs.readFileSync(new URL('../supabase/migrations/20260818190000_meta_oauth_attempt_lifecycle.sql', import.meta.url), 'utf8');
const hardenedLifecycleMigration = fs.readFileSync(new URL('../supabase/migrations/20260826133000_meta_deletion_and_selection_lifecycle.sql', import.meta.url), 'utf8');
assert.ok(lifecycleMigration.includes('lifecycle_version = lifecycle_version + 1'), 'Terminal and successful lifecycle transitions must invalidate stale callbacks.');
assert.ok(lifecycleMigration.includes('social_provider_connection_attempts_one_pending_idx'), 'Only one pending OAuth attempt may own a district.');
assert.ok(lifecycleMigration.includes('canary_abandon_meta_connection_attempt'), 'Migration must provide attempt-local cleanup.');
assert.ok(lifecycleMigration.includes("raise exception 'Stale Meta OAuth callback"), 'Migration must reject stale callback interleavings.');
assert.ok(lifecycleMigration.includes("'canary-meta-provider-user:' || p_provider_user_id_hash"), 'Callbacks and deletion must share a provider-user-global lock.');
assert.ok(hardenedLifecycleMigration.includes('coalesce(issued_at, completed_at) >= v_state_created_at'), 'Versioned prepare must fence by provider issuance time without redefining completion time.');
assert.ok(lifecycleMigration.includes("raise exception 'A different Meta identity is already associated with this district'"), 'Reconnect must not erase the old provider identity needed for deletion provenance.');
assert.ok(hardenedLifecycleMigration.includes("'completed',clock_timestamp()"), 'V2 deletion receipts must record actual processing completion time.');
assert.ok(callback.includes('p_provider_user_id_hash: providerUserIdHash'), 'Callback prepare/finalize must use the same provider identity hash as deletion.');
assert.ok(syncRoute.includes('syncSelectedMetaAssets'), 'Bounded pilot route must use transactionally deletion-fenced canonical writes.');
assert.ok(syncRoute.includes('pilotItemLimit: 2'), 'Bounded pilot route must hard-cap each selected platform read.');
assert.ok(syncRoute.includes('platforms: [platform]'), 'Bounded pilot route must require one explicit platform.');
assert.ok(!syncRoute.includes('pilotItemLimit: null'), 'Customer pilot route must not expose unbounded synchronization.');
assert.ok(!accountsRoute.includes('canary_link_selected_meta_assets'), 'Asset selection must not create canonical Social rows before an approved bounded sync.');
assert.ok(statusRoute.includes('connections: presentConnections(connections)'), 'Disabled-first status must retain local disconnect visibility for existing connections.');
for (const status of ['pending', 'expired', 'error']) {
  assert.ok(integrationClient.includes(`'${status}'`), `Disabled-first UI must expose disconnect for credential-bearing ${status} connections.`);
}
assert.ok(integrationClient.includes('manageableConnections.map'), 'Disconnect controls must render for every manageable credential-bearing connection.');
const syncService = fs.readFileSync(new URL('../src/lib/meta-sync-service.mjs', import.meta.url), 'utf8');
assert.ok(syncService.includes('metaGrantedScopes(tokenData)'), 'Native sync must validate BISU scopes through token introspection.');
assert.ok(!syncService.includes("metaGraph('me/permissions'"), 'Native sync must not call the legacy personal-user permissions edge.');
assert.ok(!fs.readFileSync(new URL('../src/lib/meta-integration.mjs', import.meta.url), 'utf8').includes('fetch(nextUrl'), 'Provider pagination URLs containing credentials must never be fetched directly.');

console.log('Meta integration security and structure tests passed.');

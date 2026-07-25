import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.META_APP_ID = 'test-app-id';
process.env.META_APP_SECRET = 'test-app-secret';
process.env.META_REDIRECT_URI = 'https://www.canarydata.media/api/integrations/meta/callback';
process.env.META_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

const meta = await import('../src/lib/meta-integration.mjs');

const { state, stateHash } = meta.createOauthState();
assert.ok(state.length >= 40, 'OAuth state must have high entropy.');
assert.equal(meta.hashOauthState(state), stateHash, 'OAuth state hash must be deterministic.');
assert.notEqual(state, stateHash, 'Raw OAuth state must not be stored as its hash.');
assert.equal(meta.constantTimeEqualText(stateHash, stateHash), true);
assert.equal(meta.constantTimeEqualText(stateHash, `${stateHash}x`), false);

const tokenContext = 'connection-id:district-id:meta';
const encrypted = meta.encryptMetaToken('sensitive-token', tokenContext);
assert.ok(!encrypted.includes('sensitive-token'), 'Encrypted token must not contain plaintext.');
assert.equal(meta.decryptMetaToken(encrypted, tokenContext), 'sensitive-token', 'Encrypted Meta token must round-trip.');
assert.throws(() => meta.decryptMetaToken(encrypted, 'wrong-context'), 'Wrong AAD must fail authentication.');
const tampered = `${encrypted.slice(0, -1)}${encrypted.endsWith('A') ? 'B' : 'A'}`;
assert.throws(() => meta.decryptMetaToken(tampered, tokenContext), 'Tampered ciphertext must fail authentication.');

assert.deepEqual(meta.META_REQUIRED_SCOPES, [
  'pages_show_list',
  'pages_read_engagement',
  'instagram_basic',
  'ads_read',
]);
for (const forbidden of ['ads_management', 'business_management', 'pages_manage_posts', 'read_insights', 'instagram_manage_insights']) {
  assert.ok(!meta.META_REQUIRED_SCOPES.includes(forbidden), `Discovery release must not request ${forbidden}.`);
}

const authUrl = new URL(meta.buildMetaAuthorizationUrl(state));
assert.equal(authUrl.hostname, 'www.facebook.com');
assert.equal(authUrl.searchParams.get('client_id'), 'test-app-id');
assert.equal(authUrl.searchParams.get('redirect_uri'), process.env.META_REDIRECT_URI);
assert.equal(authUrl.searchParams.get('state'), state);
assert.ok(!authUrl.toString().includes('test-app-secret'), 'Meta app secret must never enter the browser authorization URL.');
assert.equal(meta.sanitizeReturnPath('/dashboard/integrations?districtId=abc'), '/dashboard/integrations?districtId=abc');
assert.equal(meta.sanitizeReturnPath('https://evil.example/steal'), '/dashboard/integrations');

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
globalThis.fetch = async (url, options) => {
  graphRequest = { url: String(url), options };
  return { ok: true, json: async () => ({ success: true }) };
};
await meta.revokeMetaPermissions('url-sensitive-token');
assert.ok(!graphRequest.url.includes('url-sensitive-token'), 'Revocation tokens must not appear in URLs.');
assert.ok(!graphRequest.url.includes('appsecret_proof'), 'Revocation proofs must not appear in URLs.');
assert.equal(graphRequest.options.method, 'DELETE');
globalThis.fetch = originalFetch;

const signedPayload = Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: 'meta-user-1' })).toString('base64url');
const signedSignature = (await import('node:crypto')).createHmac('sha256', process.env.META_APP_SECRET).update(signedPayload).digest('base64url');
assert.equal(meta.verifyMetaSignedRequest(`${signedSignature}.${signedPayload}`).user_id, 'meta-user-1');
assert.throws(() => meta.verifyMetaSignedRequest(`invalid.${signedPayload}`), 'Invalid signed requests must be rejected.');

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
assert.ok(callback.includes("admin.rpc('canary_consume_meta_oauth_state'"), 'Callback must atomically consume state.');
assert.ok(callback.includes('canary_meta_oauth_binding'), 'Callback must require the OAuth binding cookie.');
assert.ok(callback.includes("admin.rpc('canary_prepare_meta_connection'"), 'Callback must use a stable pending connection identity.');
assert.ok(callback.includes("admin.rpc('canary_finalize_meta_connection'"), 'Callback persistence must be transactional.');
assert.ok(!callback.includes(".from('social_provider_credentials')"), 'Callback must not write credentials outside the finalization transaction.');
assert.ok(callback.includes("p_provider_app_id: process.env.META_APP_ID"), 'Callback must bind persisted connections to the configured Meta app.');
assert.ok(callback.includes('encryptMetaToken(accessToken, tokenContext)'), 'User token must be encrypted with AAD before storage.');
assert.ok(callback.includes("status: declined.length ? 'needs_permissions' : 'active'"), 'Denied permissions must remain a visible connection state.');
assert.ok(callback.includes("granted.includes('ads_read')"), 'Ad-account discovery must tolerate denied ads_read.');
assert.ok(callback.includes("granted.includes('pages_show_list')"), 'Page discovery must tolerate denied pages_show_list.');
assert.ok(!callback.includes("fields: 'id,name,category,tasks,access_token"), 'Page access tokens must not be requested during discovery.');
assert.ok(!callback.includes('access_token: accessToken,'), 'Callback database payload must not store plaintext user token.');

const disconnectRoute = fs.readFileSync(new URL('../src/app/api/integrations/meta/disconnect/route.js', import.meta.url), 'utf8');
assert.ok(disconnectRoute.includes("admin.rpc('canary_disconnect_meta_connection'"), 'Disconnect mutations must be transactional.');
assert.ok(!disconnectRoute.includes(".from('social_provider_assets')"), 'Disconnect must not mutate assets outside the transaction.');

const actorRoute = fs.readFileSync(new URL('../src/lib/integration-auth.js', import.meta.url), 'utf8');
assert.ok(actorRoute.includes("permissions.includes('manage_integrations')"), 'Integration access must require protected capability metadata.');
assert.ok(!actorRoute.includes('user_metadata'), 'Integration authorization must not use editable user_metadata.');
assert.ok(actorRoute.includes('const districtId = isAdmin ? requestedDistrictId : assignedDistrictId'), 'Admins must provide an explicit district to every integration API route.');

const deletionRoute = fs.readFileSync(new URL('../src/app/api/integrations/meta/data-deletion/route.js', import.meta.url), 'utf8');
assert.ok(deletionRoute.includes("admin.rpc('canary_complete_meta_data_deletion'"), 'Meta deletion and its confirmation record must be transactional.');
assert.ok(!deletionRoute.includes(".from('social_provider_connections')"), 'Meta deletion must not delete connections outside the transaction.');
assert.ok(deletionRoute.includes('metaDeletionConfigured()'), 'Meta deletion must depend only on deletion-specific configuration.');
assert.ok(sql.includes('canary_complete_meta_data_deletion'), 'Meta data deletion must have a transactional RPC.');

const statusRoute = fs.readFileSync(new URL('../src/app/api/integrations/meta/route.js', import.meta.url), 'utf8');
assert.ok(!statusRoute.includes('encrypted_access_token'), 'Browser status route must not select encrypted connection tokens.');
assert.ok(!statusRoute.includes('social_provider_credentials'), 'Browser status route must not query credentials.');

const integrationPage = fs.readFileSync(new URL('../src/app/dashboard/integrations/page.js', import.meta.url), 'utf8');
const integrationClient = fs.readFileSync(new URL('../src/app/dashboard/integrations/MetaIntegrationClient.js', import.meta.url), 'utf8');
assert.ok(integrationPage.includes('const districtId = isAdmin\n    ? (requestedDistrictId'), 'Administrators must not receive an implicit first-district selection.');
assert.ok(integrationClient.includes('<option value="" disabled>Select one district</option>'), 'Admin district picker must require an explicit selection.');
assert.ok(integrationClient.includes('if (!districtId)'), 'Integration client must avoid loading Meta data before an admin selects a district.');

const dashboardClient = fs.readFileSync(new URL('../src/app/dashboard/DashboardClient.js', import.meta.url), 'utf8');
assert.ok(dashboardClient.includes("href={isAdmin ? '/dashboard/integrations'"), 'Admin navigation must not attach an implicitly selected district.');
assert.ok(!fs.readFileSync(new URL('../src/lib/meta-integration.mjs', import.meta.url), 'utf8').includes('fetch(nextUrl'), 'Provider pagination URLs containing credentials must never be fetched directly.');

console.log('Meta integration security and structure tests passed.');

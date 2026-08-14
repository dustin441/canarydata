import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('../supabase/migrations/20260813224000_meta_owned_social_sync.sql', import.meta.url), 'utf8');
const insightsMigration = fs.readFileSync(new URL('../supabase/migrations/20260814223000_meta_owned_social_insights.sql', import.meta.url), 'utf8');
const preflight = fs.readFileSync(new URL('../supabase/preflight_meta_owned_social_insights.sql', import.meta.url), 'utf8');
const service = fs.readFileSync(new URL('../src/lib/meta-sync-service.mjs', import.meta.url), 'utf8');
const route = fs.readFileSync(new URL('../src/app/api/integrations/meta/sync/route.js', import.meta.url), 'utf8');
const accountsRoute = fs.readFileSync(new URL('../src/app/api/integrations/meta/accounts/route.js', import.meta.url), 'utf8');
const disconnectRoute = fs.readFileSync(new URL('../src/app/api/integrations/meta/disconnect/route.js', import.meta.url), 'utf8');

for (const table of ['social_provider_account_links', 'social_thread_provider_observations']) {
  assert.ok(migration.includes(`create table public.${table}`));
  assert.ok(migration.includes(`alter table public.${table} enable row level security`));
}
assert.ok(migration.includes('foreign key (social_account_id, district_id) references public.social_accounts(id, district_id)'));
assert.ok(migration.includes('foreign key (provider_asset_id, district_id) references public.social_provider_assets(id, district_id)'));
assert.ok(migration.includes('foreign key (social_thread_id, district_id) references public.social_threads(id, district_id)'));
assert.ok(migration.includes("where status = 'running'"), 'Only one running native sync may exist per connection.');
assert.ok(migration.includes('canary_link_selected_meta_assets'));
assert.ok(migration.includes("status in ('active','needs_permissions')\n  for update"), 'Asset linking must lock the connection lifecycle row before derived writes.');
assert.ok(migration.includes('canary_ingest_owned_social_observation'));
assert.ok(migration.includes('canary_claim_meta_sync_run'));
assert.ok(migration.includes("'LEASE_EXPIRED'"), 'Expired native-sync leases must be recovered before a new claim.');
assert.ok(migration.includes("coalesce(lease_expires_at, started_at + interval '2 minutes') <= now()"));
for (const signature of [
  'canary_claim_meta_sync_run(text, uuid, integer, timestamptz, jsonb)',
  'canary_link_selected_meta_assets(text, uuid)',
  'canary_ingest_owned_social_observation(uuid, jsonb)',
]) {
  assert.ok(migration.includes(`revoke all on function public.${signature} from public, anon, authenticated`));
  assert.ok(migration.includes(`grant execute on function public.${signature} to service_role`));
}
assert.ok(migration.includes("status in ('active','needs_permissions') for update"), 'Provider-derived writes must exclusively lock an authorized current connection before writing.');
assert.ok(migration.includes('selected and active'), 'Provider-derived writes must guard selected active assets.');
assert.ok(migration.includes('provider_metadata = social_threads.provider_metadata ||'), 'Cross-provider observations must preserve canonical provider metadata.');
assert.ok(migration.includes('Canonical Social account reassignment is not allowed'));
assert.ok(!migration.includes('visibility_status = excluded.visibility_status'), 'Provider sync must not overwrite product-owned visibility.');
assert.ok(insightsMigration.includes('create table public.social_provider_metric_snapshots'));
assert.ok(insightsMigration.includes('unique (provider_account_link_id, provider_object_id, provider_metric_name, metric_variant, period, source_scope, effective_at)'), 'Metric snapshots must converge for the same provider-effective point and query variant.');
assert.ok(insightsMigration.includes('period_start_at timestamptz'));
assert.ok(insightsMigration.includes('period_end_at timestamptz'));
assert.ok(insightsMigration.includes("metric_scope in ('account','content')"));
assert.ok(insightsMigration.includes("availability in ('available','unavailable','unsupported','error')"));
assert.ok(insightsMigration.includes("source_scope in ('organic','paid','total','unknown')"));
assert.ok(insightsMigration.includes('canary_upsert_meta_metric_snapshot'));
assert.ok(insightsMigration.includes('canary_upsert_meta_metric_snapshots'));
assert.ok(insightsMigration.includes("jsonb_array_length(p_metrics) > 250"));
assert.ok(insightsMigration.includes("status in ('active','needs_permissions') for update"), 'Metric writes must lock an authorized connection.');
assert.ok(insightsMigration.includes('Selected active Meta asset is required'));
assert.ok(insightsMigration.includes('enable row level security'));
assert.ok(insightsMigration.includes('revoke all on function public.canary_upsert_meta_metric_snapshot(uuid, uuid, jsonb) from public, anon, authenticated'));
assert.ok(insightsMigration.includes('grant execute on function public.canary_upsert_meta_metric_snapshots(uuid, uuid, jsonb) to service_role'));
assert.ok(preflight.includes('cardinality(c.granted_scopes)'), 'Production Meta scopes are stored as text[].');
assert.ok(!preflight.includes('jsonb_array_length(c.granted_scopes)'), 'Preflight must not treat text[] scopes as JSONB.');

assert.ok(service.includes("process.env.META_NATIVE_SYNC_ENABLED !== 'true'"), 'Native sync must remain disabled until migration and app readiness pass.');
assert.ok(service.includes('debugMetaToken(accessToken, { signal: executionSignal })'), 'Every native sync must introspect its grant within the execution budget.');
assert.ok(service.includes("String(tokenData.app_id) !== String(process.env.META_APP_ID)"));
assert.ok(service.includes("String(tokenData.user_id) !== String(connection.provider_user_id)"));
assert.ok(service.includes("['ANALYZE', 'MANAGE'].includes(task)"), 'Facebook Page sync must require an analytics-capable task.');
assert.ok(!service.includes('comments.limit(0).summary(true)'), 'Least-privilege Page sync must not request comment data without pages_read_user_content.');
assert.ok(!service.includes('reactions.limit(0).summary(true)'), 'Least-privilege Page sync must not request reaction data without broader access.');
assert.ok(!service.includes('pages_read_user_content'), 'Owned-post discovery must not broaden the initial permission set.');
assert.ok(service.includes("admin.rpc('canary_ingest_owned_social_observation'"));
assert.ok(service.includes(".eq('id', run.id).eq('status', 'running')"), 'Run finalization must be conditional.');
assert.ok(service.includes('Meta synchronization failed and its run could not be finalized.'), 'Failed-run persistence must be checked instead of silently leaving a running lease.');
assert.ok(service.includes("admin.rpc('canary_claim_meta_sync_run'"));
assert.ok(service.includes('const deadline = Date.now() + 45_000'));
assert.ok(service.includes('const executionSignal = AbortSignal.timeout(45_000)'));
assert.ok(service.includes('{ signal: executionSignal }'), 'Every Meta request in native sync must share an abortable execution budget.');
assert.ok(service.includes('next_cursor: nextCursor'));
assert.ok(service.includes("previousRun?.status === 'partial' ? previousRun.source_cutoff : sourceCutoff"), 'Continuation must preserve the original bounded source cutoff.');
assert.ok(service.includes("nextCursor[asset.id] = continuation[asset.id] || null"), 'A partial page must replay from its input cursor rather than skip unwritten rows.');
assert.ok(route.includes('requireIntegrationActor(body?.districtId || null)'), 'Manual sync route must enforce protected explicit tenant selection.');
assert.ok(accountsRoute.includes("META_NATIVE_SYNC_ENABLED === 'true'"), 'Selection-to-canonical linking must remain migration-gated.');
assert.ok(disconnectRoute.indexOf("admin.rpc('canary_disconnect_meta_connection'") < disconnectRoute.indexOf('await revokeMetaPermissions(accessToken)'), 'Disconnect must close local authorization before remote revocation.');
assert.ok(disconnectRoute.includes("catch (tokenError)"));
assert.ok(disconnectRoute.includes("connection.status !== 'revoked' && !credential?.encrypted_access_token"), 'Missing credentials on an active connection must make remote revocation unconfirmed.');
assert.ok(disconnectRoute.includes("p_revocation_unconfirmed: revokeWarning"), 'Credential corruption must be recorded while local disconnect still proceeds.');
assert.ok(disconnectRoute.indexOf("catch (tokenError)") < disconnectRoute.indexOf("admin.rpc('canary_disconnect_meta_connection'"), 'Credential decoding failure must not prevent local disconnect.');

for (const source of [migration, service, route, accountsRoute]) {
  assert.ok(!source.includes('ads_read'));
  assert.ok(!source.includes('pages_manage_posts'));
  assert.ok(!source.includes('instagram_content_publish'));
}
console.log('Meta native-sync security and convergence tests passed.');

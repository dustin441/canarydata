import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('../supabase/migrations/20260813224000_meta_owned_social_sync.sql', import.meta.url), 'utf8');
const insightsMigration = fs.readFileSync(new URL('../supabase/migrations/20260814223000_meta_owned_social_insights.sql', import.meta.url), 'utf8');
const insightsPermissionPatch = fs.readFileSync(new URL('../supabase/migrations/20260814224500_meta_insights_restrict_row_rpc.sql', import.meta.url), 'utf8');
const deletionFenceMigration = fs.readFileSync(new URL('../supabase/migrations/20260820200000_meta_sync_deletion_fence.sql', import.meta.url), 'utf8');
const deletionFenceRollback = fs.readFileSync(new URL('../supabase/rollbacks/20260820200000_meta_sync_deletion_fence_down.sql', import.meta.url), 'utf8');
const connectionHealthMigration = fs.readFileSync(new URL('../supabase/migrations/20260826130000_meta_connection_health.sql', import.meta.url), 'utf8');
const connectionHealthRollback = fs.readFileSync(new URL('../supabase/rollbacks/20260826130000_meta_connection_health_down.sql', import.meta.url), 'utf8');
const hardenedLifecycleMigration = fs.readFileSync(new URL('../supabase/migrations/20260826133000_meta_deletion_and_selection_lifecycle.sql', import.meta.url), 'utf8');
const legacyCutoverMigration = fs.readFileSync(new URL('../supabase/migrations/20260826140000_meta_legacy_rpc_cutover.sql', import.meta.url), 'utf8');
const legacyCutoverRollback = fs.readFileSync(new URL('../supabase/rollbacks/20260826140000_meta_legacy_rpc_cutover_down.sql', import.meta.url), 'utf8');
const preflight = fs.readFileSync(new URL('../supabase/preflight_meta_owned_social_insights.sql', import.meta.url), 'utf8');
const integration = fs.readFileSync(new URL('../src/lib/meta-integration.mjs', import.meta.url), 'utf8');
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
assert.ok(insightsMigration.includes('revoke all on function public.canary_upsert_meta_metric_snapshot(uuid, uuid, jsonb) from public, anon, authenticated, service_role'));
assert.ok(insightsMigration.includes('grant execute on function public.canary_upsert_meta_metric_snapshots(uuid, uuid, jsonb) to service_role'));
assert.ok(insightsPermissionPatch.includes('canary_upsert_meta_metric_snapshot(uuid, uuid, jsonb)'));
assert.ok(insightsPermissionPatch.includes('from public, anon, authenticated, service_role'));
assert.ok(insightsPermissionPatch.includes('grant execute on function public.canary_upsert_meta_metric_snapshots(uuid, uuid, jsonb)'));
assert.ok(preflight.includes('cardinality(c.granted_scopes)'), 'Production Meta scopes are stored as text[].');
assert.ok(!preflight.includes('jsonb_array_length(c.granted_scopes)'), 'Preflight must not treat text[] scopes as JSONB.');

for (const name of [
  'canary_fenced_link_selected_meta_assets',
  'canary_fenced_ingest_owned_social_observation',
  'canary_fenced_upsert_meta_metric_snapshots',
]) {
  assert.ok(deletionFenceMigration.includes(`function public.${name}`));
  assert.ok(deletionFenceMigration.includes(`grant execute on function public.${name}`));
  assert.ok(deletionFenceRollback.includes(`drop function public.${name}`));
}
assert.ok(deletionFenceMigration.includes("encode(digest(convert_to(v_connection.provider_user_id, 'UTF8'), 'sha256'), 'hex')"));
assert.ok(deletionFenceMigration.includes("'canary-meta-provider-user:' || v_provider_user_id_hash"));
assert.ok(deletionFenceMigration.includes("'canary-meta-oauth:' || v_connection.district_id"));
assert.ok(deletionFenceMigration.indexOf("'canary-meta-provider-user:' || v_provider_user_id_hash") < deletionFenceMigration.indexOf("'canary-meta-oauth:' || v_connection.district_id"), 'fenced writes must lock provider identity before district OAuth lifecycle');
assert.ok(deletionFenceMigration.includes("provider_user_id_hash = v_provider_user_id_hash"));
assert.ok(deletionFenceMigration.includes("status = 'completed'"));
assert.ok(connectionHealthMigration.includes('data_access_expires_at timestamptz'));
assert.ok(connectionHealthMigration.includes('canary_finalize_meta_connection_v2'));
assert.ok(connectionHealthMigration.includes('canary_update_meta_connection_health'));
assert.ok(connectionHealthMigration.includes("and status = p_expected_status"), 'Health writes must use optimistic status comparison.');
assert.ok(connectionHealthMigration.includes("and status <> 'revoked'"), 'Health writes must not restore disconnected connections.');
assert.ok(legacyCutoverMigration.includes('revoke execute on function public.canary_finalize_meta_connection'));
assert.ok(legacyCutoverRollback.includes('grant execute on function public.canary_finalize_meta_connection'));
assert.ok(connectionHealthRollback.includes('drop column if exists data_access_expires_at'));
assert.ok(connectionHealthRollback.includes('grant execute on function public.canary_finalize_meta_connection'));
for (const signature of [
  'canary_link_selected_meta_assets(text, uuid)',
  'canary_ingest_owned_social_observation(uuid, jsonb)',
  'canary_upsert_meta_metric_snapshots(uuid, uuid, jsonb)',
]) {
  assert.ok(deletionFenceMigration.includes(`revoke execute on function public.${signature} from service_role`));
  assert.ok(deletionFenceRollback.includes(`grant execute on function public.${signature} to service_role`));
}

assert.ok(service.includes("process.env.META_NATIVE_SYNC_ENABLED !== 'true'"), 'Native sync must remain disabled until migration and app readiness pass.');
assert.ok(service.includes("admin.rpc('canary_update_meta_connection_health'"), 'Every sync must persist recoverable grant health.');
assert.ok(service.includes('data_access_expires_at'), 'Every sync must enforce Meta data-access expiration separately from token expiry.');
assert.ok(service.includes("and status = p_expected_status") || connectionHealthMigration.includes("and status = p_expected_status"), 'Health transitions must not overwrite concurrent lifecycle changes.');
assert.ok(service.includes('debugMetaToken(accessToken, { signal: executionSignal })'), 'Every native sync must introspect its grant within the execution budget.');
assert.ok(service.includes('recoverableMetaSyncStatus(connection.status)'), 'Recoverable error connections must remain eligible for token revalidation.');
assert.ok(service.includes("status: healthStatus"), 'Transient provider and persistence failures must preserve retry eligibility.');
assert.ok(service.includes("errorCode: 'token_introspection_unavailable'"));
assert.ok(service.includes("errorCode: 'sync_transient_failure'"));
assert.ok(service.includes("String(tokenData.app_id) !== String(process.env.META_APP_ID)"));
assert.ok(service.includes("String(tokenData.user_id) !== String(connection.provider_user_id)"));
assert.ok(service.includes("['ANALYZE', 'MANAGE'].includes(task)"), 'Facebook Page sync must require an analytics-capable task.');
assert.ok(service.includes("granted.includes('read_insights')"));
assert.ok(service.includes("granted.includes('instagram_manage_insights')"));
assert.ok(service.includes("pilotLimit > 2"), 'Controlled persistence pilot must have a hard two-item cap.');
assert.ok(service.includes("pilotLimit && assets.length !== 1"), 'The two-item pilot cap must be global, not multiplied per selected asset.');
assert.ok(service.includes("META_NATIVE_SYNC_PILOT_ONLY !== 'false'"), 'Unbounded native sync must remain blocked by default.');
assert.ok(service.includes("!isMetaUnsupportedMetricError(result)"), 'Only specifically identified provider metric incompatibility may converge as unsupported; auth and transient errors must fail the run.');
assert.ok(service.includes("platformFilter.includes(asset.platform)"), 'Pilot may narrow but never broaden selected assets.');
assert.ok(service.includes("admin.rpc('canary_fenced_upsert_meta_metric_snapshots'"));
assert.ok(service.includes('metric_rows_written: metricRowsWritten'));
assert.ok(integration.includes('export async function metaGraphBatch'));
assert.ok(integration.includes("requests.length > 50"));
assert.ok(!service.includes('comments.limit(0).summary(true)'), 'Least-privilege Page sync must not request comment data without pages_read_user_content.');
assert.ok(!service.includes('reactions.limit(0).summary(true)'), 'Least-privilege Page sync must not request reaction data without broader access.');
assert.ok(!service.includes('pages_read_user_content'), 'Owned-post discovery must not broaden the initial permission set.');
assert.ok(service.includes("admin.rpc('canary_fenced_ingest_owned_social_observation'"));
assert.ok(service.includes("admin.rpc('canary_fenced_link_selected_meta_assets'"));
assert.ok(service.includes("admin.rpc('canary_fenced_link_meta_pilot_asset'"), 'Controlled pilot must activate only its exact platform asset.');
assert.ok(hardenedLifecycleMigration.includes('canary_fenced_link_meta_pilot_asset'));
assert.ok(hardenedLifecycleMigration.includes('p_provider_asset_id uuid'));
assert.ok(service.indexOf('assets.length !== 1') < service.indexOf("admin.rpc('canary_fenced_link_meta_pilot_asset'"), 'Pilot selection bounds must be enforced before canonical activation.');
assert.ok(service.includes("instagram_business_account{id}"), 'Current Page inventory must include the linked Instagram professional identity before activation.');
assert.ok(service.includes("parentGrant?.instagram_business_account?.id"), 'Instagram activation must match the exact current linked professional account ID.');
assert.ok(service.indexOf('validateCurrentMetaAssetGrants(assets, pageGrants)') < service.indexOf("admin.rpc('canary_fenced_link_meta_pilot_asset'"), 'Current provider grant validation must complete before canonical activation.');
assert.ok(hardenedLifecycleMigration.includes('set search_path = public, extensions, pg_temp'));
assert.ok(hardenedLifecycleMigration.indexOf("'canary-meta-provider-user:'||v_provider_user_id_hash") < hardenedLifecycleMigration.indexOf("'canary-meta-oauth:'||p_district_id"));
assert.ok(service.includes("errorCode: 'provider_sync_failure'"), 'Normalized provider failures must remain visible in connection health.');
assert.ok(!service.includes("admin.rpc('canary_link_selected_meta_assets'"));
assert.ok(!service.includes("admin.rpc('canary_ingest_owned_social_observation'"));
assert.ok(!service.includes("admin.rpc('canary_upsert_meta_metric_snapshots'"));
assert.ok(service.includes(".eq('id', run.id).eq('status', 'running')"), 'Run finalization must be conditional.');
assert.ok(service.includes('Meta synchronization failed and its run could not be finalized.'), 'Failed-run persistence must be checked instead of silently leaving a running lease.');
assert.ok(service.includes("admin.rpc('canary_claim_meta_sync_run'"));
assert.ok(service.includes('const deadline = Date.now() + 45_000'));
assert.ok(service.includes('const executionSignal = AbortSignal.timeout(45_000)'));
assert.ok(service.includes("['AbortError', 'TimeoutError'].includes"));
assert.ok(service.includes("errorCode: 'EXECUTION_BUDGET', threads: []"), 'Account Insights timeout must produce a replayable partial run before content writes.');
assert.ok(service.includes("batch.threads.slice(0, writtenCount + 1)"), 'Content Insights timeout must record the already-ingested thread and replay from the input cursor.');
assert.ok(service.includes('{ signal: executionSignal }'), 'Every Meta request in native sync must share an abortable execution budget.');
assert.ok(service.includes('next_cursor: nextCursor'));
assert.ok(service.includes('continuedMetaSourceCutoff(previousRun.source_cutoff, now())'), 'Continuation must preserve the exact original bounded source cutoff without a moving 90-day clamp.');
assert.ok(service.includes('normalizeMetaPageContinuation(continuation[asset.id])'), 'Continuation must accept legacy provider cursors and structured completed-item identities.');
assert.ok(service.includes('remainingMetaPageItems(providerRows, page)'), 'A partial page must skip only identities whose metric persistence completed.');
assert.ok(service.includes('contentMetricRefreshDays = 14'), 'Recurring content metric refresh must default to fourteen days.');
assert.ok(service.includes('value < 1 || value > 30'), 'Content metric refresh days must be bounded from one through thirty.');
assert.ok(service.includes('exists: Boolean(existing.data)'), 'Content metric replay must distinguish existing canonical posts from newly discovered old posts.');
assert.match(service, /canary_fenced_ingest_owned_social_observation[\s\S]*?shouldRefreshMetaContentInsights/, 'Every old duplicate must refresh its fenced canonical observation before content Insights are skipped.');
assert.match(service, /shouldRefreshMetaContentInsights[\s\S]*?writtenCount \+= 1;[\s\S]*?continue;/, 'Skipped old duplicate metrics must still advance written progress.');
assert.ok(route.includes('requireIntegrationActor(body?.districtId || null)'), 'Manual sync route must enforce protected explicit tenant selection.');
assert.ok(route.includes('syncSelectedMetaAssets'), 'Authorized pilot route must use the lifecycle-fenced native service.');
assert.ok(route.includes('pilotItemLimit: 2'), 'Authorized pilot route must enforce a two-item cap.');
assert.ok(route.includes('platforms: [platform]'), 'Authorized pilot route must run one explicitly chosen platform at a time.');
assert.ok(!route.includes('pilotItemLimit: null'), 'Pilot route must not expose an unbounded synchronization path.');
assert.ok(!accountsRoute.includes('canary_link_selected_meta_assets'), 'Discovery-only asset selection must not create canonical Social accounts or links.');
assert.ok(!accountsRoute.includes('META_NATIVE_SYNC_ENABLED'), 'Discovery-only selection must not retain an environment-only canonical-write path.');
assert.ok(!disconnectRoute.includes('revokeMetaPermissions'), 'District disconnect must not revoke an app/user-wide Meta grant.');
assert.ok(disconnectRoute.includes("disconnectScope: 'district_local'"), 'District disconnect must disclose its local-only scope.');
assert.ok(disconnectRoute.includes('p_revocation_unconfirmed: false'), 'Local-only disconnect must not claim a failed provider revocation that was intentionally not requested.');

for (const source of [migration, service, route, accountsRoute]) {
  assert.ok(!source.includes('ads_read'));
  assert.ok(!source.includes('pages_manage_posts'));
  assert.ok(!source.includes('instagram_content_publish'));
}
console.log('Meta native-sync security and convergence tests passed.');

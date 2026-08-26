import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { withSocialDatabase } from './fixtures/social-db-harness.mjs';

await withSocialDatabase('meta-owned-sync', async ({ sql, expectFailure, session, waitForBlocked }) => {
  sql(`
    alter table public.social_accounts
      add column authorization_mode text not null default 'public',
      add column connection_status text not null default 'discovered',
      add column credential_reference text,
      add column granted_scopes jsonb not null default '[]'::jsonb,
      add column connected_at timestamptz,
      add column token_expires_at timestamptz,
      add column last_successful_sync_at timestamptz,
      add column last_error_at timestamptz,
      add column last_error_code text,
      add column created_at timestamptz not null default now(),
      add column updated_at timestamptz not null default now(),
      add constraint social_accounts_id_district_key unique (id, district_id);
    alter table public.social_threads add constraint social_threads_id_district_unique unique (id, district_id);
    alter table public.social_threads alter column visibility_status set default 'active';
    update public.social_threads set visibility_status='active' where visibility_status in ('review','approved');
    alter table public.social_threads drop constraint social_threads_visibility_status_check;
    alter table public.social_threads add constraint social_threads_visibility_status_check check (visibility_status in ('active','excluded'));
  `);
  const base = await readFile(new URL('../supabase/meta_social_integration.sql', import.meta.url), 'utf8');
  const migration = await readFile(new URL('../supabase/migrations/20260813224000_meta_owned_social_sync.sql', import.meta.url), 'utf8');
  const insightsMigration = await readFile(new URL('../supabase/migrations/20260814223000_meta_owned_social_insights.sql', import.meta.url), 'utf8');
  const latestMetricMigration = await readFile(new URL('../supabase/migrations/20260819223000_social_metric_latest_view.sql', import.meta.url), 'utf8');
  const latestMetricRollback = await readFile(new URL('../supabase/rollbacks/20260819223000_social_metric_latest_view_down.sql', import.meta.url), 'utf8');
  const deletionFenceMigration = await readFile(new URL('../supabase/migrations/20260820200000_meta_sync_deletion_fence.sql', import.meta.url), 'utf8');
  const deletionFenceRollback = await readFile(new URL('../supabase/rollbacks/20260820200000_meta_sync_deletion_fence_down.sql', import.meta.url), 'utf8');
  const oauthLifecycleMigration = await readFile(new URL('../supabase/migrations/20260818190000_meta_oauth_attempt_lifecycle.sql', import.meta.url), 'utf8');
  const hardenedLifecycleMigration = await readFile(new URL('../supabase/migrations/20260826133000_meta_deletion_and_selection_lifecycle.sql', import.meta.url), 'utf8');
  assert.doesNotMatch(latestMetricMigration, /\bconcurrently\b/i, 'Supabase SQL Editor wraps submitted SQL in a transaction');
  assert.doesNotMatch(latestMetricRollback, /\bconcurrently\b/i, 'rollback must also be SQL Editor compatible');
  const finalCurrentState = await readFile(new URL('../supabase/manual/canary_meta_database_final_current_state.sql', import.meta.url), 'utf8');
  sql(base);
  sql(`create schema if not exists extensions; alter extension pgcrypto set schema extensions;`);
  sql(migration);
  sql(insightsMigration);
  sql(latestMetricMigration);
  sql(finalCurrentState);
  sql(deletionFenceMigration);
  sql(`
    insert into public.districts(id,name) values ('district-meta','District Meta');
    insert into public.social_provider_connections(id,district_id,provider,provider_app_id,provider_user_id,status)
      values ('10000000-0000-4000-8000-000000000001','district-meta','meta','app-1','user-1','active');
    insert into public.social_provider_assets(id,district_id,connection_id,provider_asset_id,asset_type,platform,name,handle,selected,active)
      values ('20000000-0000-4000-8000-000000000001','district-meta','10000000-0000-4000-8000-000000000001','page-1','facebook_page','facebook','District Meta','districtmeta',true,true);
    select public.canary_fenced_link_selected_meta_assets('district-meta','10000000-0000-4000-8000-000000000001');
  `);
  expectFailure(`select public.canary_link_selected_meta_assets('district-meta','10000000-0000-4000-8000-000000000001');`, /permission denied/i, { role:'service_role' });
  sql(deletionFenceRollback);
  sql(`select public.canary_link_selected_meta_assets('district-meta','10000000-0000-4000-8000-000000000001');`, { role:'service_role' });
  expectFailure(`select public.canary_fenced_link_selected_meta_assets('district-meta','10000000-0000-4000-8000-000000000001');`, /does not exist/i, { role:'service_role' });
  sql(deletionFenceMigration);
  sql(oauthLifecycleMigration);
  sql(hardenedLifecycleMigration);
  expectFailure(`select public.canary_link_selected_meta_assets('district-meta','10000000-0000-4000-8000-000000000001');`, /permission denied/i, { role:'service_role' });
  sql(`select public.canary_fenced_link_selected_meta_assets('district-meta','10000000-0000-4000-8000-000000000001');`, { role:'service_role' });
  const link = sql(`copy (select id||'|'||social_account_id from public.social_provider_account_links where district_id='district-meta' and active) to stdout;`).trim();
  const [linkId, accountId] = link.split('|');
  assert.ok(linkId && accountId);
  const linker = session('meta-linker', { role: 'service_role' });
  const revoker = session('meta-revoker');
  await linker.exec('begin;');
  await linker.exec(`select public.canary_fenced_link_selected_meta_assets('district-meta','10000000-0000-4000-8000-000000000001');`);
  const linkerPid = await linker.pid();
  await revoker.exec('begin;');
  const revokerPid = await revoker.pid();
  const blockedRevocation = revoker.exec(`update public.social_provider_connections set status='revoked' where id='10000000-0000-4000-8000-000000000001';`, 10000);
  await waitForBlocked(revokerPid, linkerPid);
  await linker.exec('commit;');
  await blockedRevocation;
  await revoker.exec('rollback;');
  const claimedRun = sql(`copy (select public.canary_claim_meta_sync_run('district-meta','10000000-0000-4000-8000-000000000001',1,'2026-05-15T00:00:00Z','{}'::jsonb)) to stdout;`).trim();
  assert.ok(claimedRun);
  expectFailure(`select public.canary_claim_meta_sync_run('district-meta','10000000-0000-4000-8000-000000000001',1,'2026-05-15T00:00:00Z','{}'::jsonb);`, /permission denied/i, { role:'authenticated' });
  expectFailure(`select public.canary_claim_meta_sync_run('district-meta','10000000-0000-4000-8000-000000000001',1,'2026-05-15T00:00:00Z','{}'::jsonb);`, /already running/i);
  sql(`update public.social_sync_runs set lease_expires_at=now()-interval '1 second' where id='${claimedRun}';`);
  const recoveredRun = sql(`copy (select public.canary_claim_meta_sync_run('district-meta','10000000-0000-4000-8000-000000000001',1,'2026-05-15T00:00:00Z','{}'::jsonb)) to stdout;`).trim();
  assert.notEqual(recoveredRun, claimedRun);
  assert.equal(sql(`copy (select status||'|'||(error_summary->>'code') from public.social_sync_runs where id='${claimedRun}') to stdout;`).trim(), 'failed|LEASE_EXPIRED');
  sql(`update public.social_sync_runs set status='success',completed_at=now(),lease_expires_at=null where id='${recoveredRun}';`);
  const payload = JSON.stringify({
    district_id:'district-meta',social_account_id:accountId,provider:'meta',platform:'facebook',external_thread_id:'post-1',
    canonical_url:'https://facebook.test/post-1',relationship_type:'owned',body:'Original',headline:'Original',published_at:'2026-08-13T12:00:00Z',visibility_status:'active',provider_metadata:{source:'meta_graph'},
  }).replaceAll("'", "''");
  expectFailure(`select (public.canary_ingest_owned_social_observation('${linkId}','${payload}'::jsonb)).id;`, /permission denied/i, { role:'service_role' });
  sql(`select (public.canary_fenced_ingest_owned_social_observation('${linkId}','${payload}'::jsonb)).id;`, { role:'service_role' });
  assert.equal(sql(`copy (select count(*) from public.social_threads where district_id='district-meta' and external_thread_id='post-1') to stdout;`).trim(), '1');
  sql(`update public.social_threads set visibility_status='excluded', reviewer_note='keep excluded', review_version=3 where district_id='district-meta' and external_thread_id='post-1';`);
  const replay = JSON.stringify({
    district_id:'district-meta',social_account_id:accountId,provider:'meta',platform:'facebook',external_thread_id:'post-1',
    canonical_url:'https://facebook.test/post-1',relationship_type:'owned',body:'Edited provider text',headline:'Edited',published_at:'2026-08-13T12:00:00Z',visibility_status:'active',provider_metadata:{source:'meta_graph',observed:2},
  }).replaceAll("'", "''");
  sql(`select (public.canary_fenced_ingest_owned_social_observation('${linkId}','${replay}'::jsonb)).id;`, { role:'service_role' });
  assert.equal(sql(`copy (select visibility_status||'|'||reviewer_note||'|'||review_version||'|'||body from public.social_threads where district_id='district-meta' and external_thread_id='post-1') to stdout;`).trim(), 'excluded|keep excluded|3|Edited provider text');
  assert.equal(sql(`copy (select count(*) from public.social_thread_provider_observations where district_id='district-meta') to stdout;`).trim(), '1');
  expectFailure(`insert into public.social_provider_account_links(district_id,social_account_id,provider_asset_id,provider) values ('district-a','${accountId}','20000000-0000-4000-8000-000000000001','meta');`, /foreign key|duplicate/i);
  const threadId = sql(`copy (select id from public.social_threads where district_id='district-meta' and external_thread_id='post-1') to stdout;`).trim();
  const metric = JSON.stringify({
    metric_scope:'content',provider_object_id:'post-1',provider_metric_name:'post_media_view',normalized_metric_name:'views',period:'lifetime',source_scope:'organic',availability:'available',metric_value:494,effective_at:'2026-08-14T00:00:00Z',provider_metadata:{graph_version:'v25.0'},
  }).replaceAll("'", "''");
  const snapshotId = sql(`copy (select public.canary_upsert_meta_metric_snapshot('${linkId}','${threadId}','${metric}'::jsonb)) to stdout;`).trim();
  assert.ok(snapshotId);
  const newerMetric = JSON.stringify({
    metric_scope:'content',provider_object_id:'post-1',provider_metric_name:'post_media_view',normalized_metric_name:'views',period:'lifetime',source_scope:'organic',availability:'available',metric_value:600,effective_at:'2026-08-15T00:00:00Z',provider_metadata:{graph_version:'v25.0'},
  }).replaceAll("'", "''");
  sql(`select public.canary_upsert_meta_metric_snapshot('${linkId}','${threadId}','${newerMetric}'::jsonb);`);
  assert.equal(sql(`copy (select count(*)||'|'||max(metric_value) from public.canary_latest_social_metric_snapshots where provider_account_link_id='${linkId}' and provider_metric_name='post_media_view') to stdout;`, { role:'service_role' }).trim().split('\n').at(-1), '1|600');
  expectFailure(`select * from public.canary_latest_social_metric_snapshots;`, /permission denied/i, { role:'authenticated' });
  sql(latestMetricRollback);
  assert.equal(sql(`copy (select to_regclass('public.canary_latest_social_metric_snapshots') is null and to_regclass('public.social_provider_metric_snapshots_latest_idx') is null) to stdout;`).trim(),'t','latest metric read projection must roll back cleanly');
  sql(latestMetricMigration);
  const metricBatch = `[${metric}]`;
  expectFailure(`select public.canary_upsert_meta_metric_snapshot('${linkId}','${threadId}','${metric}'::jsonb);`, /permission denied/i, { role:'service_role' });
  expectFailure(`select public.canary_upsert_meta_metric_snapshots('${linkId}','${threadId}','${metricBatch}'::jsonb);`, /permission denied/i, { role:'service_role' });
  assert.equal(sql(`copy (select public.canary_fenced_upsert_meta_metric_snapshots('${linkId}','${threadId}','${metricBatch}'::jsonb)) to stdout;`, { role:'service_role' }).trim().split('\n').at(-1), '1');
  expectFailure(`select public.canary_upsert_meta_metric_snapshots('${linkId}','${threadId}','${metricBatch}'::jsonb);`, /permission denied/i, { role:'authenticated' });
  sql(`select public.canary_upsert_meta_metric_snapshot('${linkId}','${threadId}','${metric}'::jsonb);`);
  assert.equal(sql(`copy (select count(*) from public.social_provider_metric_snapshots where provider_account_link_id='${linkId}' and provider_metric_name='post_media_view') to stdout;`).trim(), '2','history retains both effective periods while the dashboard view exposes one latest row');
  const updatedMetric = JSON.stringify({ ...JSON.parse(metric.replaceAll("''", "'")), metric_value:500 }).replaceAll("'", "''");
  sql(`select public.canary_upsert_meta_metric_snapshot('${linkId}','${threadId}','${updatedMetric}'::jsonb);`);
  assert.equal(sql(`copy (select metric_value::text from public.social_provider_metric_snapshots where id='${snapshotId}') to stdout;`).trim(), '500');
  expectFailure(`select public.canary_upsert_meta_metric_snapshot('${linkId}',null,'${metric}'::jsonb);`, /content metric requires/i);
  const accountMetric = JSON.stringify({
    metric_scope:'account',provider_object_id:'page-1',provider_metric_name:'page_media_view',normalized_metric_name:'views',period:'day',source_scope:'total',availability:'available',metric_value:14574,effective_at:'2026-08-13T07:00:00Z',
  }).replaceAll("'", "''");
  assert.ok(sql(`copy (select public.canary_upsert_meta_metric_snapshot('${linkId}',null,'${accountMetric}'::jsonb)) to stdout;`).trim());
  const wrongAccountMetric = accountMetric.replace('page-1', 'page-outside');
  expectFailure(`select public.canary_upsert_meta_metric_snapshot('${linkId}',null,'${wrongAccountMetric}'::jsonb);`, /does not match the selected Meta asset/i);
  expectFailure(`select public.canary_upsert_meta_metric_snapshot('${linkId}','${threadId}','${metric}'::jsonb);`, /permission denied/i, { role:'authenticated' });

  // A district disconnect owns the district OAuth lock. A fenced ingest that
  // observed the pre-disconnect link must wait, then fail its locked recheck.
  sql(`
    insert into public.districts(id,name) values ('district-disconnect','District Disconnect');
    insert into public.social_provider_connections(id,district_id,provider,provider_app_id,provider_user_id,status)
      values ('10000000-0000-4000-8000-000000000002','district-disconnect','meta','app-1','user-2','active');
    insert into public.social_provider_assets(id,district_id,connection_id,provider_asset_id,asset_type,platform,name,handle,selected,active)
      values ('20000000-0000-4000-8000-000000000002','district-disconnect','10000000-0000-4000-8000-000000000002','page-2','facebook_page','facebook','Disconnect District','disconnect',true,true);
    select public.canary_fenced_link_selected_meta_assets('district-disconnect','10000000-0000-4000-8000-000000000002');
  `);
  const disconnectLink = sql(`copy (select id||'|'||social_account_id from public.social_provider_account_links where district_id='district-disconnect' and active) to stdout;`).trim();
  const [disconnectLinkId, disconnectAccountId] = disconnectLink.split('|');
  const disconnectPayload = JSON.stringify({
    district_id:'district-disconnect',social_account_id:disconnectAccountId,provider:'meta',platform:'facebook',external_thread_id:'post-disconnect',
    canonical_url:'https://facebook.test/post-disconnect',relationship_type:'owned',body:'Disconnect race',published_at:'2026-08-13T12:00:00Z',visibility_status:'active',provider_metadata:{source:'meta_graph'},
  }).replaceAll("'", "''");
  const disconnectOwner = session('meta-disconnect-owner');
  const disconnectWriter = session('meta-disconnect-writer', { role: 'service_role' });
  await disconnectOwner.exec('begin;');
  await disconnectOwner.exec(`select public.canary_disconnect_meta_connection('10000000-0000-4000-8000-000000000002','district-disconnect',false);`);
  const disconnectOwnerPid = await disconnectOwner.pid();
  const disconnectWriterPid = await disconnectWriter.pid();
  const disconnectWrite = assert.rejects(
    disconnectWriter.exec(`select (public.canary_fenced_ingest_owned_social_observation('${disconnectLinkId}','${disconnectPayload}'::jsonb)).id;`),
    /Active tenant-bound Meta link is required after lifecycle fence/,
  );
  await waitForBlocked(disconnectWriterPid, disconnectOwnerPid);
  await disconnectOwner.exec('commit;');
  await disconnectWrite;
  assert.equal(sql(`copy (select count(*) from public.social_threads where district_id='district-disconnect') to stdout;`).trim(), '0');

  // Saving an empty selection deactivates canonical links and accounts without
  // requiring a later synchronization run.
  sql(`
    insert into public.districts(id,name) values ('district-unselect','District Unselect');
    insert into public.social_provider_connections(id,district_id,provider,provider_app_id,provider_user_id,status,connected_at)
      values ('10000000-0000-4000-8000-000000000003','district-unselect','meta','app-1','user-3','active',now());
    insert into public.social_provider_assets(id,district_id,connection_id,provider_asset_id,asset_type,platform,name,handle,selected,active)
      values ('20000000-0000-4000-8000-000000000003','district-unselect','10000000-0000-4000-8000-000000000003','page-3','facebook_page','facebook','Unselect District','unselect',true,true);
  `);
  sql(`select public.canary_fenced_link_selected_meta_assets('district-unselect','10000000-0000-4000-8000-000000000003');`, { role:'service_role' });
  sql(`select public.canary_replace_meta_asset_mappings('district-unselect','{}'::uuid[],null,'District official accounts');`, { role:'service_role' });
  assert.equal(sql(`copy (select count(*) from public.social_provider_account_links where district_id='district-unselect' and active) to stdout;`).trim(), '0');
  assert.equal(sql(`copy (select count(*) from public.social_accounts where district_id='district-unselect' and active) to stdout;`).trim(), '0');

  // A one-platform pilot activates only its exact asset and cannot create links
  // for other selected assets on the same connection.
  sql(`
    insert into public.districts(id,name) values ('district-pilot-boundary','District Pilot Boundary');
    insert into public.social_provider_connections(id,district_id,provider,provider_app_id,provider_user_id,status,connected_at)
      values ('10000000-0000-4000-8000-000000000004','district-pilot-boundary','meta','app-1','user-4','active',now());
    insert into public.social_provider_assets(id,district_id,connection_id,provider_asset_id,asset_type,platform,name,handle,parent_provider_asset_id,selected,active)
      values
        ('20000000-0000-4000-8000-000000000004','district-pilot-boundary','10000000-0000-4000-8000-000000000004','page-4','facebook_page','facebook','Pilot Facebook','pilotfb',null,true,true),
        ('20000000-0000-4000-8000-000000000005','district-pilot-boundary','10000000-0000-4000-8000-000000000004','ig-4','instagram_account','instagram','Pilot Instagram','pilotig','page-4',true,true);
  `);
  sql(`select public.canary_fenced_link_meta_pilot_asset('district-pilot-boundary','10000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000004');`, { role:'service_role' });
  assert.equal(sql(`copy (select count(*) from public.social_provider_account_links where district_id='district-pilot-boundary' and active) to stdout;`).trim(), '1');
  assert.equal(sql(`copy (select count(*) from public.social_provider_account_links where provider_asset_id='20000000-0000-4000-8000-000000000005') to stdout;`).trim(), '0');
  expectFailure(`select public.canary_fenced_link_meta_pilot_asset('district-pilot-boundary','10000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000003');`, /Exact selected Meta pilot asset is required/i, { role:'service_role' });
  expectFailure(`select public.canary_fenced_link_meta_pilot_asset('district-pilot-boundary','10000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000005');`, /permission denied/i, { role:'authenticated' });
  sql(`select public.canary_fenced_link_meta_pilot_asset('district-pilot-boundary','10000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000005');`, { role:'service_role' });
  assert.equal(sql(`copy (select count(*) from public.social_provider_account_links where district_id='district-pilot-boundary' and active) to stdout;`).trim(), '2');

  const pilotLinker = session('meta-pilot-linker', { role:'service_role' });
  const pilotDeleter = session('meta-pilot-deleter');
  await pilotLinker.exec('begin;');
  await pilotLinker.exec(`select public.canary_fenced_link_meta_pilot_asset('district-pilot-boundary','10000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000004');`);
  const pilotLinkerPid = await pilotLinker.pid();
  await pilotDeleter.exec('begin;');
  const pilotDeleterPid = await pilotDeleter.pid();
  const pilotDeletion = pilotDeleter.exec(`select public.canary_complete_meta_data_deletion('user-4','${createHash('sha256').update('user-4').digest('hex')}','pilot-boundary-delete');`, 10000);
  await waitForBlocked(pilotDeleterPid, pilotLinkerPid);
  await pilotLinker.exec('commit;');
  await pilotDeletion;
  await pilotDeleter.exec('commit;');
  assert.equal(sql(`copy (select count(*) from public.social_provider_connections where district_id='district-pilot-boundary') to stdout;`).trim(), '0');

  // Provider deletion owns the provider-user lock before every district lock.
  // Both canonical writers must block, then fail after deletion commits, and
  // neither may recreate a canonical row or metric snapshot.
  const providerHash = createHash('sha256').update('user-1').digest('hex');
  const deletionOwner = session('meta-deletion-owner');
  const ingestWriter = session('meta-deletion-ingest', { role: 'service_role' });
  const metricWriter = session('meta-deletion-metric', { role: 'service_role' });
  await deletionOwner.exec('begin;');
  await deletionOwner.exec(`select public.canary_complete_meta_data_deletion('user-1','${providerHash}','delete-confirmation');`);
  const deletionOwnerPid = await deletionOwner.pid();
  const ingestWriterPid = await ingestWriter.pid();
  const metricWriterPid = await metricWriter.pid();
  const blockedIngest = assert.rejects(
    ingestWriter.exec(`select (public.canary_fenced_ingest_owned_social_observation('${linkId}','${replay}'::jsonb)).id;`),
    /Active tenant-bound Meta link is required after lifecycle fence/,
  );
  const blockedMetric = assert.rejects(
    metricWriter.exec(`select public.canary_fenced_upsert_meta_metric_snapshots('${linkId}','${threadId}','${metricBatch}'::jsonb);`),
    /Active tenant-bound Meta link is required after lifecycle fence/,
  );
  await waitForBlocked(ingestWriterPid);
  await waitForBlocked(metricWriterPid);
  await deletionOwner.exec('commit;');
  await blockedIngest;
  await blockedMetric;
  assert.equal(sql(`copy (select count(*) from public.social_provider_connections where district_id='district-meta') to stdout;`).trim(), '0');
  assert.equal(sql(`copy (select count(*) from public.social_threads where district_id='district-meta') to stdout;`).trim(), '0');
  assert.equal(sql(`copy (select count(*) from public.social_provider_metric_snapshots where district_id='district-meta') to stdout;`).trim(), '0');
  assert.equal(sql(`copy (select count(*) from public.social_provider_deletion_requests where provider_user_id_hash='${providerHash}' and status='completed') to stdout;`).trim(), '1');
});

console.log('Meta owned-social PostgreSQL lifecycle rehearsal passed.');

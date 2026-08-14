import assert from 'node:assert/strict';
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
  sql(base);
  sql(migration);
  sql(insightsMigration);
  sql(`
    insert into public.districts(id,name) values ('district-meta','District Meta');
    insert into public.social_provider_connections(id,district_id,provider,provider_app_id,provider_user_id,status)
      values ('10000000-0000-4000-8000-000000000001','district-meta','meta','app-1','user-1','active');
    insert into public.social_provider_assets(id,district_id,connection_id,provider_asset_id,asset_type,platform,name,handle,selected,active)
      values ('20000000-0000-4000-8000-000000000001','district-meta','10000000-0000-4000-8000-000000000001','page-1','facebook_page','facebook','District Meta','districtmeta',true,true);
    select public.canary_link_selected_meta_assets('district-meta','10000000-0000-4000-8000-000000000001');
  `);
  const link = sql(`copy (select id||'|'||social_account_id from public.social_provider_account_links where district_id='district-meta' and active) to stdout;`).trim();
  const [linkId, accountId] = link.split('|');
  assert.ok(linkId && accountId);
  const linker = session('meta-linker', { role: 'service_role' });
  const revoker = session('meta-revoker');
  await linker.exec('begin;');
  await linker.exec(`select public.canary_link_selected_meta_assets('district-meta','10000000-0000-4000-8000-000000000001');`);
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
  sql(`select (public.canary_ingest_owned_social_observation('${linkId}','${payload}'::jsonb)).id;`, { role:'service_role' });
  assert.equal(sql(`copy (select count(*) from public.social_threads where district_id='district-meta' and external_thread_id='post-1') to stdout;`).trim(), '1');
  sql(`update public.social_threads set visibility_status='excluded', reviewer_note='keep excluded', review_version=3 where district_id='district-meta' and external_thread_id='post-1';`);
  const replay = JSON.stringify({
    district_id:'district-meta',social_account_id:accountId,provider:'meta',platform:'facebook',external_thread_id:'post-1',
    canonical_url:'https://facebook.test/post-1',relationship_type:'owned',body:'Edited provider text',headline:'Edited',published_at:'2026-08-13T12:00:00Z',visibility_status:'active',provider_metadata:{source:'meta_graph',observed:2},
  }).replaceAll("'", "''");
  sql(`select (public.canary_ingest_owned_social_observation('${linkId}','${replay}'::jsonb)).id;`, { role:'service_role' });
  assert.equal(sql(`copy (select visibility_status||'|'||reviewer_note||'|'||review_version||'|'||body from public.social_threads where district_id='district-meta' and external_thread_id='post-1') to stdout;`).trim(), 'excluded|keep excluded|3|Edited provider text');
  assert.equal(sql(`copy (select count(*) from public.social_thread_provider_observations where district_id='district-meta') to stdout;`).trim(), '1');
  expectFailure(`insert into public.social_provider_account_links(district_id,social_account_id,provider_asset_id,provider) values ('district-a','${accountId}','20000000-0000-4000-8000-000000000001','meta');`, /foreign key|duplicate/i);
  const threadId = sql(`copy (select id from public.social_threads where district_id='district-meta' and external_thread_id='post-1') to stdout;`).trim();
  const metric = JSON.stringify({
    metric_scope:'content',provider_object_id:'post-1',provider_metric_name:'post_media_view',normalized_metric_name:'views',period:'lifetime',source_scope:'organic',availability:'available',metric_value:494,effective_at:'2026-08-14T00:00:00Z',provider_metadata:{graph_version:'v25.0'},
  }).replaceAll("'", "''");
  const snapshotId = sql(`copy (select public.canary_upsert_meta_metric_snapshot('${linkId}','${threadId}','${metric}'::jsonb)) to stdout;`).trim();
  assert.ok(snapshotId);
  sql(`select public.canary_upsert_meta_metric_snapshot('${linkId}','${threadId}','${metric}'::jsonb);`);
  assert.equal(sql(`copy (select count(*) from public.social_provider_metric_snapshots where provider_account_link_id='${linkId}' and provider_metric_name='post_media_view') to stdout;`).trim(), '1');
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
  sql(`update public.social_provider_connections set status='revoked' where id='10000000-0000-4000-8000-000000000001';`);
  expectFailure(`select public.canary_ingest_owned_social_observation('${linkId}','${replay}'::jsonb);`, /Active Meta connection is required/, { role:'service_role' });
  expectFailure(`select public.canary_upsert_meta_metric_snapshot('${linkId}','${threadId}','${metric}'::jsonb);`, /Active Meta connection is required/, { role:'service_role' });
  sql(`delete from public.social_threads where district_id='district-meta'; delete from public.social_accounts where district_id='district-meta';`);
  assert.equal(sql(`copy (select count(*) from public.social_provider_metric_snapshots where district_id='district-meta') to stdout;`).trim(), '0');
});

console.log('Meta owned-social PostgreSQL lifecycle rehearsal passed.');

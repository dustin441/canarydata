-- CANARY META DATABASE: FINAL CURRENT-STATE SCRIPT
-- Sections 1, 2, and 3 have already completed successfully.
-- Run this entire script once in production Supabase SQL Editor.

begin;
set local lock_timeout = '10s';
set local statement_timeout = '1min';

-- Supabase grants service_role function execution by default.
-- Keep the single-row helper internal and expose only the bounded bulk RPC.
revoke all on function public.canary_upsert_meta_metric_snapshot(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;

revoke all on function public.canary_upsert_meta_metric_snapshots(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.canary_upsert_meta_metric_snapshots(uuid, uuid, jsonb)
  to service_role;

commit;

-- One-row final verification. Every ready/rls/denied/allowed value must be true.
-- All four row counts must be zero before the controlled pilot.
select
  to_regclass('public.social_provider_account_links') is not null as ready_provider_links,
  to_regclass('public.social_thread_provider_observations') is not null as ready_provider_observations,
  to_regclass('public.social_provider_metric_snapshots') is not null as ready_metric_snapshots,
  to_regprocedure('public.canary_claim_meta_sync_run(text,uuid,integer,timestamp with time zone,jsonb)') is not null as ready_claim_rpc,
  to_regprocedure('public.canary_link_selected_meta_assets(text,uuid)') is not null as ready_link_rpc,
  to_regprocedure('public.canary_ingest_owned_social_observation(uuid,jsonb)') is not null as ready_content_rpc,
  to_regprocedure('public.canary_upsert_meta_metric_snapshot(uuid,uuid,jsonb)') is not null as ready_internal_metric_rpc,
  to_regprocedure('public.canary_upsert_meta_metric_snapshots(uuid,uuid,jsonb)') is not null as ready_bulk_metric_rpc,
  (select relrowsecurity from pg_class where oid='public.social_provider_account_links'::regclass) as rls_provider_links,
  (select relrowsecurity from pg_class where oid='public.social_thread_provider_observations'::regclass) as rls_provider_observations,
  (select relrowsecurity from pg_class where oid='public.social_provider_metric_snapshots'::regclass) as rls_metric_snapshots,
  not has_function_privilege('anon','public.canary_upsert_meta_metric_snapshot(uuid,uuid,jsonb)','execute') as anon_row_rpc_denied,
  not has_function_privilege('authenticated','public.canary_upsert_meta_metric_snapshot(uuid,uuid,jsonb)','execute') as authenticated_row_rpc_denied,
  not has_function_privilege('service_role','public.canary_upsert_meta_metric_snapshot(uuid,uuid,jsonb)','execute') as service_role_row_rpc_denied,
  not has_function_privilege('anon','public.canary_upsert_meta_metric_snapshots(uuid,uuid,jsonb)','execute') as anon_bulk_rpc_denied,
  not has_function_privilege('authenticated','public.canary_upsert_meta_metric_snapshots(uuid,uuid,jsonb)','execute') as authenticated_bulk_rpc_denied,
  has_function_privilege('service_role','public.canary_upsert_meta_metric_snapshots(uuid,uuid,jsonb)','execute') as service_role_bulk_rpc_allowed,
  (select count(*) from public.social_provider_account_links) as provider_link_rows,
  (select count(*) from public.social_thread_provider_observations) as provider_observation_rows,
  (select count(*) from public.social_provider_metric_snapshots) as metric_snapshot_rows,
  (select count(*) from public.social_sync_runs) as sync_run_rows,
  (select count(*) from public.social_provider_assets where selected and active) as selected_active_assets,
  (select count(*) from public.social_account_mappings) as active_mappings;

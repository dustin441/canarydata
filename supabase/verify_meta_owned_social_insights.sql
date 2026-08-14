-- READ ONLY. Run after both Meta owned-social migrations.

select
  to_regclass('public.social_provider_account_links') is not null as link_table_ready,
  to_regclass('public.social_thread_provider_observations') is not null as observation_table_ready,
  to_regclass('public.social_provider_metric_snapshots') is not null as metric_table_ready,
  to_regprocedure('public.canary_claim_meta_sync_run(text,uuid,integer,timestamp with time zone,jsonb)') is not null as claim_rpc_ready,
  to_regprocedure('public.canary_link_selected_meta_assets(text,uuid)') is not null as link_rpc_ready,
  to_regprocedure('public.canary_ingest_owned_social_observation(uuid,jsonb)') is not null as ingest_rpc_ready,
  to_regprocedure('public.canary_upsert_meta_metric_snapshot(uuid,uuid,jsonb)') is not null as metric_row_rpc_ready,
  to_regprocedure('public.canary_upsert_meta_metric_snapshots(uuid,uuid,jsonb)') is not null as metric_bulk_rpc_ready;

select relname,relrowsecurity
from pg_class
where oid in (
  'public.social_provider_account_links'::regclass,
  'public.social_thread_provider_observations'::regclass,
  'public.social_provider_metric_snapshots'::regclass
)
order by relname;

select routine_name,grantee,privilege_type
from information_schema.routine_privileges
where routine_schema='public'
  and routine_name in (
    'canary_claim_meta_sync_run','canary_link_selected_meta_assets',
    'canary_ingest_owned_social_observation','canary_upsert_meta_metric_snapshot','canary_upsert_meta_metric_snapshots'
  )
order by routine_name,grantee;

select c.district_id,c.status,c.token_expires_at,
       count(distinct a.id) filter (where a.selected and a.active) as selected_active_assets,
       count(distinct m.id) as active_mappings,
       count(distinct l.id) as provider_account_links,
       count(distinct s.id) as metric_snapshots
from public.social_provider_connections c
left join public.social_provider_assets a on a.connection_id=c.id and a.district_id=c.district_id
left join public.social_account_mappings m on m.provider_asset_id=a.id and m.district_id=a.district_id
left join public.social_provider_account_links l on l.provider_asset_id=a.id and l.district_id=a.district_id
left join public.social_provider_metric_snapshots s on s.provider_account_link_id=l.id and s.district_id=l.district_id
where c.provider='meta'
group by c.district_id,c.status,c.token_expires_at
order by c.district_id;

select count(*) as sync_runs_after_migration from public.social_sync_runs;
select count(*) as metrics_after_migration from public.social_provider_metric_snapshots;

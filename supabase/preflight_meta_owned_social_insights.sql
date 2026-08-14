-- READ ONLY. Run first in the production Supabase SQL Editor.
-- Every ready_* value must be true before applying migrations.

select
  to_regclass('public.districts') is not null as ready_districts,
  to_regclass('public.social_accounts') is not null as ready_social_accounts,
  to_regclass('public.social_threads') is not null as ready_social_threads,
  to_regclass('public.social_provider_connections') is not null as ready_meta_connections,
  to_regclass('public.social_provider_assets') is not null as ready_meta_assets,
  to_regclass('public.social_sync_runs') is not null as ready_sync_runs,
  to_regprocedure('public.canary_ingest_social_thread(jsonb)') is not null as ready_social_ingestion,
  exists (
    select 1 from pg_constraint
    where conrelid='public.social_accounts'::regclass and contype='u'
      and pg_get_constraintdef(oid) like 'UNIQUE (id, district_id)%'
  ) as ready_social_account_tenant_key,
  exists (
    select 1 from pg_constraint
    where conrelid='public.social_threads'::regclass and contype='u'
      and pg_get_constraintdef(oid) like 'UNIQUE (id, district_id)%'
  ) as ready_social_thread_tenant_key;

select
  to_regclass('public.social_provider_account_links') as base_link_table_before,
  to_regclass('public.social_thread_provider_observations') as base_observation_table_before,
  to_regclass('public.social_provider_metric_snapshots') as insights_table_before;

select c.district_id,c.status,c.token_expires_at,
       jsonb_array_length(c.granted_scopes) as granted_scope_count,
       count(distinct a.id) filter (where a.selected and a.active) as selected_active_assets,
       count(distinct m.id) as active_mappings
from public.social_provider_connections c
left join public.social_provider_assets a on a.connection_id=c.id and a.district_id=c.district_id
left join public.social_account_mappings m on m.provider_asset_id=a.id and m.district_id=a.district_id
where c.provider='meta'
group by c.district_id,c.status,c.token_expires_at,c.granted_scopes
order by c.district_id;

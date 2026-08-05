-- Canary Social N-1 read-only contract capture
-- Safe to run in the Canary production Supabase SQL Editor before any migration.
-- This script makes no changes and ends with ROLLBACK.

begin transaction read only;
set local statement_timeout = '30s';
set local lock_timeout = '5s';

select jsonb_pretty(jsonb_build_object(
  'captured_at_utc', timezone('utc', now()),
  'database', current_database(),
  'server_version', current_setting('server_version'),
  'social_threads_exists', to_regclass('public.social_threads') is not null,
  'social_review_events_exists', to_regclass('public.social_review_events') is not null,
  'task4_objects_present', jsonb_build_object(
    'correction_requests_table', to_regclass('public.social_correction_requests') is not null,
    'correction_rpc', to_regprocedure('public.canary_apply_social_correction(uuid,text,uuid,text,integer,text)') is not null,
    'ingestion_rpc', to_regprocedure('public.canary_ingest_social_thread(jsonb)') is not null
  ),
  'row_counts', jsonb_build_object(
    'social_threads', (select count(*) from public.social_threads),
    'social_review_events', (select count(*) from public.social_review_events)
  ),
  'status_counts', (
    select coalesce(jsonb_object_agg(visibility_status, item_count order by visibility_status), '{}'::jsonb)
    from (
      select visibility_status, count(*) as item_count
      from public.social_threads
      group by visibility_status
    ) counts
  ),
  'status_relationship_counts', (
    select coalesce(jsonb_agg(to_jsonb(counts) order by visibility_status, relationship_type), '[]'::jsonb)
    from (
      select visibility_status, relationship_type, count(*) as item_count
      from public.social_threads
      group by visibility_status, relationship_type
    ) counts
  ),
  'review_version_bounds', (
    select jsonb_build_object(
      'minimum', min(review_version),
      'maximum', max(review_version),
      'null_count', count(*) filter (where review_version is null)
    )
    from public.social_threads
  ),
  'rls', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table', c.relname,
      'enabled', c.relrowsecurity,
      'forced', c.relforcerowsecurity
    ) order by c.relname), '[]'::jsonb)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('social_threads', 'social_review_batches', 'social_review_events', 'social_correction_requests')
  )
)) as social_n1_summary;

with contract as (
  select
    'column'::text as object_type,
    c.table_name || '.' || c.column_name as object_name,
    concat_ws('|', c.data_type, c.udt_name, c.is_nullable, coalesce(c.column_default, '<null>')) as definition
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name in ('social_threads', 'social_review_batches', 'social_review_events', 'social_correction_requests')

  union all

  select
    'constraint',
    con.conrelid::regclass::text || '.' || con.conname,
    pg_catalog.pg_get_constraintdef(con.oid, true)
  from pg_catalog.pg_constraint con
  where con.conrelid in (
    select c.oid from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('social_threads', 'social_review_batches', 'social_review_events', 'social_correction_requests')
  )

  union all

  select
    'function',
    p.oid::regprocedure::text,
    pg_catalog.pg_get_functiondef(p.oid)
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'canary_assert_social_reviewer',
      'canary_review_social_thread',
      'canary_bulk_review_social_threads',
      'canary_apply_social_correction',
      'canary_ingest_social_thread',
      'prevent_social_review_audit_mutation',
      'touch_social_updated_at'
    )

  union all

  select
    'trigger',
    t.tgrelid::regclass::text || '.' || t.tgname,
    pg_catalog.pg_get_triggerdef(t.oid, true)
  from pg_catalog.pg_trigger t
  where not t.tgisinternal
    and t.tgrelid in (
      select c.oid from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in ('social_threads', 'social_review_batches', 'social_review_events', 'social_correction_requests')
    )

  union all

  select
    'index',
    i.schemaname || '.' || i.indexname,
    i.indexdef
  from pg_catalog.pg_indexes i
  where i.schemaname = 'public'
    and i.tablename in ('social_threads', 'social_review_batches', 'social_review_events', 'social_correction_requests')

  union all

  select
    'table_grant',
    g.table_schema || '.' || g.table_name || ':' || g.grantee || ':' || g.privilege_type,
    concat_ws('|', g.grantor, g.is_grantable)
  from information_schema.role_table_grants g
  where g.table_schema = 'public'
    and g.table_name in ('social_threads', 'social_review_batches', 'social_review_events', 'social_correction_requests')

  union all

  select
    'function_grant',
    r.routine_schema || '.' || r.routine_name || ':' || r.grantee || ':' || r.privilege_type,
    concat_ws('|', r.specific_name, r.grantor, r.is_grantable)
  from information_schema.routine_privileges r
  where r.routine_schema = 'public'
    and r.routine_name in (
      'canary_assert_social_reviewer',
      'canary_review_social_thread',
      'canary_bulk_review_social_threads',
      'canary_apply_social_correction',
      'canary_ingest_social_thread'
    )

  union all

  select
    'policy',
    p.schemaname || '.' || p.tablename || '.' || p.policyname,
    concat_ws('|', p.permissive, array_to_string(p.roles, ','), p.cmd, coalesce(p.qual, '<null>'), coalesce(p.with_check, '<null>'))
  from pg_catalog.pg_policies p
  where p.schemaname = 'public'
    and p.tablename in ('social_threads', 'social_review_batches', 'social_review_events', 'social_correction_requests')
)
select
  object_type,
  object_name,
  md5(definition) as definition_md5,
  definition
from contract
order by object_type, object_name;

rollback;

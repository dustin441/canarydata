-- Canary Social N-1 summary capture
-- Read-only. Safe to run in the Canary production Supabase SQL Editor.

begin transaction read only;
set local statement_timeout = '30s';
set local lock_timeout = '5s';

select jsonb_pretty(
  jsonb_build_object(
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
      select coalesce(
        jsonb_object_agg(visibility_status, item_count order by visibility_status),
        '{}'::jsonb
      )
      from (
        select visibility_status, count(*) as item_count
        from public.social_threads
        group by visibility_status
      ) as counts
    ),
    'status_relationship_counts', (
      select coalesce(
        jsonb_agg(to_jsonb(counts) order by visibility_status, relationship_type),
        '[]'::jsonb
      )
      from (
        select visibility_status, relationship_type, count(*) as item_count
        from public.social_threads
        group by visibility_status, relationship_type
      ) as counts
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
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'table', c.relname,
            'enabled', c.relrowsecurity,
            'forced', c.relforcerowsecurity
          )
          order by c.relname
        ),
        '[]'::jsonb
      )
      from pg_catalog.pg_class as c
      join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in (
          'social_threads',
          'social_review_batches',
          'social_review_events',
          'social_correction_requests'
        )
    )
  )
) as social_n1_summary;

rollback;

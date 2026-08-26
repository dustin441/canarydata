-- Consolidated Canary Meta verification. Every passed value must be true.

with expected_tables(name) as (
  values
    ('social_provider_oauth_states'),
    ('social_provider_connections'),
    ('social_provider_credentials'),
    ('social_provider_assets'),
    ('social_account_mappings'),
    ('social_sync_runs'),
    ('social_provider_deletion_requests'),
    ('social_provider_connection_attempts'),
    ('social_provider_account_links'),
    ('social_thread_provider_observations'),
    ('social_provider_metric_snapshots')
),
expected_functions(signature) as (
  values
    ('public.canary_consume_meta_oauth_state(text,uuid,text)'),
    ('public.canary_prepare_meta_connection_v2(uuid,text,uuid,text,text,text,text,uuid,bigint)'),
    ('public.canary_abandon_meta_connection_attempt(uuid,text)'),
    ('public.canary_replace_meta_asset_mappings(text,uuid[],uuid,text)'),
    ('public.canary_fenced_link_meta_pilot_asset(text,uuid,uuid)'),
    ('public.canary_finalize_meta_connection_v2(uuid,uuid,text,uuid,text,text,text,text,text,timestamptz,timestamptz,text[],text[],text,integer,jsonb)'),
    ('public.canary_update_meta_connection_health(uuid,text,text,text,timestamptz,timestamptz,text[],text[],timestamptz,text,text)'),
    ('public.canary_disconnect_meta_connection(uuid,text,boolean)'),
    ('public.canary_complete_meta_data_deletion_v2(text,text,text,text,timestamptz)'),
    ('public.canary_claim_meta_sync_run(text,uuid,integer,timestamptz,jsonb)'),
    ('public.canary_fenced_link_selected_meta_assets(text,uuid)'),
    ('public.canary_fenced_ingest_owned_social_observation(uuid,jsonb)'),
    ('public.canary_fenced_upsert_meta_metric_snapshots(uuid,uuid,jsonb)')
),
table_checks as (
  select
    count(*) = 11 as all_tables_exist,
    bool_and(c.relrowsecurity) as all_tables_have_rls
  from expected_tables e
  left join pg_class c on c.relname = e.name
  left join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  where n.nspname = 'public'
),
function_checks as (
  select
    count(*) = 13 and bool_and(to_regprocedure(signature) is not null) as all_functions_exist,
    bool_and(has_function_privilege('service_role', signature, 'EXECUTE')) as service_role_can_execute,
    bool_and(not has_function_privilege('authenticated', signature, 'EXECUTE')) as authenticated_cannot_execute,
    bool_and(not has_function_privilege('anon', signature, 'EXECUTE')) as anon_cannot_execute
  from expected_functions
),
column_checks as (
  select
    count(*) filter (where column_name = 'district_id' and data_type = 'text' and is_nullable = 'NO') = 1 as district_id_is_required_text,
    count(*) filter (where column_name = 'provider_app_id' and data_type = 'text' and is_nullable = 'NO') = 1 as provider_app_id_is_required_text,
    count(*) filter (where column_name = 'provider_user_id' and data_type = 'text' and is_nullable = 'NO') = 1 as provider_user_id_is_required_text,
    count(*) filter (where column_name = 'connected_by' and data_type = 'uuid' and is_nullable = 'YES') = 1 as connected_by_is_nullable_uuid,
    count(*) filter (where column_name = 'lifecycle_version' and data_type = 'bigint' and is_nullable = 'NO') = 1 as lifecycle_version_is_required_bigint,
    count(*) filter (where column_name = 'data_access_expires_at' and data_type = 'timestamp with time zone' and is_nullable = 'YES') = 1 as data_access_expiry_is_nullable_timestamptz
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'social_provider_connections'
),
attempt_checks as (
  select
    count(*) filter (where column_name = 'attempt_id' and data_type = 'uuid' and is_nullable = 'NO') = 1 as attempt_id_is_required_uuid,
    count(*) filter (where column_name = 'expires_at' and data_type = 'timestamp with time zone' and is_nullable = 'NO') = 1 as expires_at_is_required_timestamptz,
    count(*) filter (where column_name = 'provider_user_id_hash' and data_type = 'text' and is_nullable = 'NO') = 1 as provider_user_hash_is_required_text
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'social_provider_connection_attempts'
),
deletion_checks as (
  select
    count(*) filter (where column_name = 'signed_request_hash' and data_type = 'text' and is_nullable = 'YES') = 1 as signed_request_hash_exists,
    count(*) filter (where column_name = 'issued_at' and data_type = 'timestamp with time zone' and is_nullable = 'YES') = 1 as deletion_issued_at_exists
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'social_provider_deletion_requests'
),
privilege_checks as (
  select not exists (
    select 1
    from expected_tables e
    cross join (values ('anon'),('authenticated')) roles(role_name)
    where has_table_privilege(
      roles.role_name,
      format('public.%I', e.name),
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    )
  ) as browser_roles_have_no_effective_table_privileges,
  not has_function_privilege(
    'service_role',
    'public.canary_prepare_meta_connection(uuid,text,uuid,text,text,text,text,uuid,bigint)'::regprocedure,
    'EXECUTE'
  ) as legacy_prepare_is_not_callable,
  not has_function_privilege(
    'service_role',
    'public.canary_finalize_meta_connection(uuid,uuid,text,uuid,text,text,text,text,text,timestamptz,text[],text[],text,integer,jsonb)'::regprocedure,
    'EXECUTE'
  ) as legacy_finalizer_is_not_callable,
  not has_function_privilege(
    'service_role',
    'public.canary_complete_meta_data_deletion(text,text,text)'::regprocedure,
    'EXECUTE'
  ) as legacy_deletion_is_not_callable,
  not has_function_privilege(
    'service_role',
    'public.canary_link_selected_meta_assets(text,uuid)'::regprocedure,
    'EXECUTE'
  ) as unfenced_linker_is_not_callable,
  not has_function_privilege(
    'service_role',
    'public.canary_ingest_owned_social_observation(uuid,jsonb)'::regprocedure,
    'EXECUTE'
  ) as unfenced_ingest_is_not_callable,
  not has_function_privilege(
    'service_role',
    'public.canary_upsert_meta_metric_snapshots(uuid,uuid,jsonb)'::regprocedure,
    'EXECUTE'
  ) as unfenced_metrics_is_not_callable,
  not has_function_privilege(
    'service_role',
    'public.canary_upsert_meta_metric_snapshot(uuid,uuid,jsonb)'::regprocedure,
    'EXECUTE'
  ) and not has_function_privilege(
    'anon',
    'public.canary_upsert_meta_metric_snapshot(uuid,uuid,jsonb)'::regprocedure,
    'EXECUTE'
  ) and not has_function_privilege(
    'authenticated',
    'public.canary_upsert_meta_metric_snapshot(uuid,uuid,jsonb)'::regprocedure,
    'EXECUTE'
  ) as unfenced_single_metric_is_not_callable
)
select check_name, passed
from (
  select 'all eleven tables exist' as check_name, all_tables_exist as passed from table_checks
  union all select 'RLS enabled on all eleven tables', all_tables_have_rls from table_checks
  union all select 'all thirteen callable RPC functions exist', all_functions_exist from function_checks
  union all select 'service_role can execute all RPC functions', service_role_can_execute from function_checks
  union all select 'authenticated cannot execute RPC functions', authenticated_cannot_execute from function_checks
  union all select 'anon cannot execute RPC functions', anon_cannot_execute from function_checks
  union all select 'browser roles have no effective table privileges', browser_roles_have_no_effective_table_privileges from privilege_checks
  union all select 'legacy prepare is not callable by service role', legacy_prepare_is_not_callable from privilege_checks
  union all select 'legacy finalizer is not callable by service role', legacy_finalizer_is_not_callable from privilege_checks
  union all select 'legacy deletion is not callable by service role', legacy_deletion_is_not_callable from privilege_checks
  union all select 'unfenced linker is not callable by service role', unfenced_linker_is_not_callable from privilege_checks
  union all select 'unfenced ingest is not callable by service role', unfenced_ingest_is_not_callable from privilege_checks
  union all select 'unfenced metrics writer is not callable by service role', unfenced_metrics_is_not_callable from privilege_checks
  union all select 'unfenced single metric helper is not callable by any runtime role', unfenced_single_metric_is_not_callable from privilege_checks
  union all select 'district_id is required text', district_id_is_required_text from column_checks
  union all select 'provider_app_id is required text', provider_app_id_is_required_text from column_checks
  union all select 'provider_user_id is required text', provider_user_id_is_required_text from column_checks
  union all select 'connected_by is nullable uuid', connected_by_is_nullable_uuid from column_checks
  union all select 'lifecycle_version is required bigint', lifecycle_version_is_required_bigint from column_checks
  union all select 'data access expiry is nullable timestamptz', data_access_expiry_is_nullable_timestamptz from column_checks
  union all select 'attempt_id is required uuid', attempt_id_is_required_uuid from attempt_checks
  union all select 'attempt expiry is required timestamptz', expires_at_is_required_timestamptz from attempt_checks
  union all select 'attempt provider identity hash is required text', provider_user_hash_is_required_text from attempt_checks
  union all select 'deletion signed request hash exists', signed_request_hash_exists from deletion_checks
  union all select 'deletion issued_at exists', deletion_issued_at_exists from deletion_checks
) checks
order by check_name;

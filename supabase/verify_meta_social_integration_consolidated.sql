-- Consolidated Canary Meta verification. Every passed value must be true.

with expected_tables(name) as (
  values
    ('social_provider_oauth_states'),
    ('social_provider_connections'),
    ('social_provider_credentials'),
    ('social_provider_assets'),
    ('social_account_mappings'),
    ('social_sync_runs'),
    ('social_provider_deletion_requests')
),
expected_functions(name) as (
  values
    ('canary_consume_meta_oauth_state'),
    ('canary_prepare_meta_connection'),
    ('canary_replace_meta_asset_mappings'),
    ('canary_finalize_meta_connection'),
    ('canary_disconnect_meta_connection'),
    ('canary_complete_meta_data_deletion')
),
table_checks as (
  select
    count(*) = 7 as all_tables_exist,
    bool_and(c.relrowsecurity) as all_tables_have_rls
  from expected_tables e
  left join pg_class c on c.relname = e.name
  left join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  where n.nspname = 'public'
),
function_checks as (
  select
    count(*) = 6 as all_functions_exist,
    bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE')) as service_role_can_execute,
    bool_and(not has_function_privilege('authenticated', p.oid, 'EXECUTE')) as authenticated_cannot_execute,
    bool_and(not has_function_privilege('anon', p.oid, 'EXECUTE')) as anon_cannot_execute
  from expected_functions e
  left join pg_proc p on p.proname = e.name
  left join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
  where n.nspname = 'public'
),
column_checks as (
  select
    count(*) filter (where column_name = 'district_id' and data_type = 'text' and is_nullable = 'NO') = 1 as district_id_is_required_text,
    count(*) filter (where column_name = 'provider_app_id' and data_type = 'text' and is_nullable = 'NO') = 1 as provider_app_id_is_required_text,
    count(*) filter (where column_name = 'provider_user_id' and data_type = 'text' and is_nullable = 'NO') = 1 as provider_user_id_is_required_text,
    count(*) filter (where column_name = 'connected_by' and data_type = 'uuid' and is_nullable = 'YES') = 1 as connected_by_is_nullable_uuid
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'social_provider_connections'
),
privilege_checks as (
  select not exists (
    select 1
    from information_schema.role_table_grants g
    join expected_tables e on e.name = g.table_name
    where g.table_schema = 'public'
      and g.grantee in ('anon', 'authenticated')
  ) as browser_roles_have_no_direct_table_grants
)
select check_name, passed
from (
  select 'all seven tables exist' as check_name, all_tables_exist as passed from table_checks
  union all select 'RLS enabled on all seven tables', all_tables_have_rls from table_checks
  union all select 'all six RPC functions exist', all_functions_exist from function_checks
  union all select 'service_role can execute all RPC functions', service_role_can_execute from function_checks
  union all select 'authenticated cannot execute RPC functions', authenticated_cannot_execute from function_checks
  union all select 'anon cannot execute RPC functions', anon_cannot_execute from function_checks
  union all select 'browser roles have no direct table grants', browser_roles_have_no_direct_table_grants from privilege_checks
  union all select 'district_id is required text', district_id_is_required_text from column_checks
  union all select 'provider_app_id is required text', provider_app_id_is_required_text from column_checks
  union all select 'provider_user_id is required text', provider_user_id_is_required_text from column_checks
  union all select 'connected_by is nullable uuid', connected_by_is_nullable_uuid from column_checks
) checks
order by check_name;

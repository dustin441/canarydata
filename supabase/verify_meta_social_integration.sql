-- Run after meta_social_integration.sql. Every object_present and rls_enabled value should be true.

select object_name, object_present
from (
  values
    ('social_provider_oauth_states', to_regclass('public.social_provider_oauth_states') is not null),
    ('social_provider_connections', to_regclass('public.social_provider_connections') is not null),
    ('social_provider_credentials', to_regclass('public.social_provider_credentials') is not null),
    ('social_provider_assets', to_regclass('public.social_provider_assets') is not null),
    ('social_account_mappings', to_regclass('public.social_account_mappings') is not null),
    ('social_sync_runs', to_regclass('public.social_sync_runs') is not null),
    ('social_provider_deletion_requests', to_regclass('public.social_provider_deletion_requests') is not null)
) as expected_objects(object_name, object_present)
order by object_name;

select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'social_provider_oauth_states',
    'social_provider_connections',
    'social_provider_credentials',
    'social_provider_assets',
    'social_account_mappings',
    'social_sync_runs',
    'social_provider_deletion_requests'
  )
order by c.relname;

select p.proname as function_name,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'canary_consume_meta_oauth_state',
    'canary_prepare_meta_connection',
    'canary_replace_meta_asset_mappings',
    'canary_finalize_meta_connection',
    'canary_disconnect_meta_connection',
    'canary_complete_meta_data_deletion'
  )
order by p.proname;

select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'social_provider_connections'
  and column_name in ('district_id', 'provider_app_id', 'provider_user_id', 'connected_by')
order by ordinal_position;

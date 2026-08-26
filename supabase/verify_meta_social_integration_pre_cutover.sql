-- Pre-cutover verifier. Every passed value must be true after the two additive
-- migrations and before the v2 application deployment/cutover migration.
with checks(check_name,passed) as (
  values
    ('data access expiry column exists', exists(
      select 1 from information_schema.columns
      where table_schema='public' and table_name='social_provider_connections'
        and column_name='data_access_expires_at' and data_type='timestamp with time zone'
    )),
    ('deletion signed request hash exists', exists(
      select 1 from information_schema.columns
      where table_schema='public' and table_name='social_provider_deletion_requests'
        and column_name='signed_request_hash' and data_type='text'
    )),
    ('deletion issued_at exists', exists(
      select 1 from information_schema.columns
      where table_schema='public' and table_name='social_provider_deletion_requests'
        and column_name='issued_at' and data_type='timestamp with time zone'
    )),
    ('v2 prepare service role callable', has_function_privilege(
      'service_role','public.canary_prepare_meta_connection_v2(uuid,text,uuid,text,text,text,text,uuid,bigint)','execute'
    )),
    ('v2 finalizer service role callable', has_function_privilege(
      'service_role','public.canary_finalize_meta_connection_v2(uuid,uuid,text,uuid,text,text,text,text,text,timestamptz,timestamptz,text[],text[],text,integer,jsonb)','execute'
    )),
    ('health RPC service role callable', has_function_privilege(
      'service_role','public.canary_update_meta_connection_health(uuid,text,text,text,timestamptz,timestamptz,text[],text[],timestamptz,text,text)','execute'
    )),
    ('scoped pilot linker service role callable', has_function_privilege(
      'service_role','public.canary_fenced_link_meta_pilot_asset(text,uuid,uuid)','execute'
    )),
    ('native sync tables exist with RLS',
      exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='social_provider_account_links' and c.relrowsecurity)
      and exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='social_thread_provider_observations' and c.relrowsecurity)
      and exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='social_provider_metric_snapshots' and c.relrowsecurity)
    ),
    ('claim sync run service role callable', has_function_privilege(
      'service_role','public.canary_claim_meta_sync_run(text,uuid,integer,timestamptz,jsonb)','execute'
    )),
    ('fenced selected-asset linker service role callable', has_function_privilege(
      'service_role','public.canary_fenced_link_selected_meta_assets(text,uuid)','execute'
    )),
    ('fenced observation ingest service role callable', has_function_privilege(
      'service_role','public.canary_fenced_ingest_owned_social_observation(uuid,jsonb)','execute'
    )),
    ('fenced metric writer service role callable', has_function_privilege(
      'service_role','public.canary_fenced_upsert_meta_metric_snapshots(uuid,uuid,jsonb)','execute'
    )),
    ('v2 deletion service role callable', has_function_privilege(
      'service_role','public.canary_complete_meta_data_deletion_v2(text,text,text,text,timestamptz)','execute'
    )),
    ('OAuth state consumer service role callable', has_function_privilege(
      'service_role','public.canary_consume_meta_oauth_state(text,uuid,text)','execute'
    )),
    ('OAuth abandon service role callable', has_function_privilege(
      'service_role','public.canary_abandon_meta_connection_attempt(uuid,text)','execute'
    )),
    ('asset mapping replacement service role callable', has_function_privilege(
      'service_role','public.canary_replace_meta_asset_mappings(text,uuid[],uuid,text)','execute'
    )),
    ('disconnect service role callable', has_function_privilege(
      'service_role','public.canary_disconnect_meta_connection(uuid,text,boolean)','execute'
    )),
    ('legacy prepare remains callable before cutover', has_function_privilege(
      'service_role','public.canary_prepare_meta_connection(uuid,text,uuid,text,text,text,text,uuid,bigint)','execute'
    )),
    ('legacy finalizer remains callable before cutover', has_function_privilege(
      'service_role','public.canary_finalize_meta_connection(uuid,uuid,text,uuid,text,text,text,text,text,timestamptz,text[],text[],text,integer,jsonb)','execute'
    )),
    ('legacy deletion remains callable before cutover', has_function_privilege(
      'service_role','public.canary_complete_meta_data_deletion(text,text,text)','execute'
    )),
    ('browser roles cannot call v2 finalizer',
      not has_function_privilege('anon','public.canary_finalize_meta_connection_v2(uuid,uuid,text,uuid,text,text,text,text,text,timestamptz,timestamptz,text[],text[],text,integer,jsonb)','execute')
      and not has_function_privilege('authenticated','public.canary_finalize_meta_connection_v2(uuid,uuid,text,uuid,text,text,text,text,text,timestamptz,timestamptz,text[],text[],text,integer,jsonb)','execute')
    ),
    ('browser roles cannot call remaining administrative RPCs',
      not has_function_privilege('anon','public.canary_prepare_meta_connection_v2(uuid,text,uuid,text,text,text,text,uuid,bigint)','execute')
      and not has_function_privilege('authenticated','public.canary_prepare_meta_connection_v2(uuid,text,uuid,text,text,text,text,uuid,bigint)','execute')
      and not has_function_privilege('anon','public.canary_update_meta_connection_health(uuid,text,text,text,timestamptz,timestamptz,text[],text[],timestamptz,text,text)','execute')
      and not has_function_privilege('authenticated','public.canary_update_meta_connection_health(uuid,text,text,text,timestamptz,timestamptz,text[],text[],timestamptz,text,text)','execute')
      and not has_function_privilege('anon','public.canary_consume_meta_oauth_state(text,uuid,text)','execute')
      and not has_function_privilege('authenticated','public.canary_consume_meta_oauth_state(text,uuid,text)','execute')
      and not has_function_privilege('anon','public.canary_abandon_meta_connection_attempt(uuid,text)','execute')
      and not has_function_privilege('authenticated','public.canary_abandon_meta_connection_attempt(uuid,text)','execute')
      and not has_function_privilege('anon','public.canary_replace_meta_asset_mappings(text,uuid[],uuid,text)','execute')
      and not has_function_privilege('authenticated','public.canary_replace_meta_asset_mappings(text,uuid[],uuid,text)','execute')
      and not has_function_privilege('anon','public.canary_disconnect_meta_connection(uuid,text,boolean)','execute')
      and not has_function_privilege('authenticated','public.canary_disconnect_meta_connection(uuid,text,boolean)','execute')
    ),
    ('browser roles cannot call scoped pilot linker',
      not has_function_privilege('anon','public.canary_fenced_link_meta_pilot_asset(text,uuid,uuid)','execute')
      and not has_function_privilege('authenticated','public.canary_fenced_link_meta_pilot_asset(text,uuid,uuid)','execute')
    ),
    ('browser roles have no effective Meta table privileges', not exists(
      select 1
      from unnest(array[
        'social_provider_oauth_states','social_provider_connections','social_provider_credentials',
        'social_provider_assets','social_account_mappings','social_sync_runs',
        'social_provider_deletion_requests','social_provider_connection_attempts',
        'social_provider_account_links','social_thread_provider_observations','social_provider_metric_snapshots'
      ]) table_names(table_name)
      cross join (values ('anon'),('authenticated')) roles(role_name)
      where has_table_privilege(
        roles.role_name,
        format('public.%I', table_names.table_name),
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
      )
    )),
    ('browser roles cannot call native sync runtime RPCs',
      not has_function_privilege('anon','public.canary_claim_meta_sync_run(text,uuid,integer,timestamptz,jsonb)','execute')
      and not has_function_privilege('authenticated','public.canary_claim_meta_sync_run(text,uuid,integer,timestamptz,jsonb)','execute')
      and not has_function_privilege('anon','public.canary_fenced_link_selected_meta_assets(text,uuid)','execute')
      and not has_function_privilege('authenticated','public.canary_fenced_link_selected_meta_assets(text,uuid)','execute')
      and not has_function_privilege('anon','public.canary_fenced_ingest_owned_social_observation(uuid,jsonb)','execute')
      and not has_function_privilege('authenticated','public.canary_fenced_ingest_owned_social_observation(uuid,jsonb)','execute')
      and not has_function_privilege('anon','public.canary_fenced_upsert_meta_metric_snapshots(uuid,uuid,jsonb)','execute')
      and not has_function_privilege('authenticated','public.canary_fenced_upsert_meta_metric_snapshots(uuid,uuid,jsonb)','execute')
    ),
    ('all roles cannot call unfenced native sync writers',
      not has_function_privilege('service_role','public.canary_link_selected_meta_assets(text,uuid)','execute')
      and not has_function_privilege('service_role','public.canary_ingest_owned_social_observation(uuid,jsonb)','execute')
      and not has_function_privilege('service_role','public.canary_upsert_meta_metric_snapshots(uuid,uuid,jsonb)','execute')
      and not has_function_privilege('service_role','public.canary_upsert_meta_metric_snapshot(uuid,uuid,jsonb)','execute')
      and not has_function_privilege('anon','public.canary_upsert_meta_metric_snapshot(uuid,uuid,jsonb)','execute')
      and not has_function_privilege('authenticated','public.canary_upsert_meta_metric_snapshot(uuid,uuid,jsonb)','execute')
    ),
    ('browser roles cannot call v2 deletion',
      not has_function_privilege('anon','public.canary_complete_meta_data_deletion_v2(text,text,text,text,timestamptz)','execute')
      and not has_function_privilege('authenticated','public.canary_complete_meta_data_deletion_v2(text,text,text,text,timestamptz)','execute')
    )
)
select check_name,passed from checks order by check_name;

-- Roll back Meta connection data-access deadline and health RPCs.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '5min';

revoke all on function public.canary_update_meta_connection_health(uuid, text, text, text, timestamptz, timestamptz, text[], text[], timestamptz, text, text) from public, anon, authenticated, service_role;
revoke all on function public.canary_finalize_meta_connection_v2(uuid, uuid, text, uuid, text, text, text, text, text, timestamptz, timestamptz, text[], text[], text, integer, jsonb) from public, anon, authenticated, service_role;
drop function public.canary_update_meta_connection_health(uuid, text, text, text, timestamptz, timestamptz, text[], text[], timestamptz, text, text);
drop function public.canary_finalize_meta_connection_v2(uuid, uuid, text, uuid, text, text, text, text, text, timestamptz, timestamptz, text[], text[], text, integer, jsonb);
grant execute on function public.canary_finalize_meta_connection(uuid, uuid, text, uuid, text, text, text, text, text, timestamptz, text[], text[], text, integer, jsonb) to service_role;
alter table public.social_provider_connections drop column if exists data_access_expires_at;

commit;

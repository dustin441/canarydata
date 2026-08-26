-- Post-deploy cutover: once the v2 application deployment is verified, remove
-- service-role access to legacy RPCs that cannot persist deadline/replay data.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '2min';

revoke execute on function public.canary_prepare_meta_connection(uuid,text,uuid,text,text,text,text,uuid,bigint) from service_role;
revoke execute on function public.canary_finalize_meta_connection(
  uuid,uuid,text,uuid,text,text,text,text,text,timestamptz,text[],text[],text,integer,jsonb
) from service_role;
revoke execute on function public.canary_complete_meta_data_deletion(text,text,text) from service_role;

commit;

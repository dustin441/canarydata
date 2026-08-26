-- Emergency cutover rollback for the prior application deployment.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '2min';

grant execute on function public.canary_prepare_meta_connection(uuid,text,uuid,text,text,text,text,uuid,bigint) to service_role;
grant execute on function public.canary_finalize_meta_connection(
  uuid,uuid,text,uuid,text,text,text,text,text,timestamptz,text[],text[],text,integer,jsonb
) to service_role;
grant execute on function public.canary_complete_meta_data_deletion(text,text,text) to service_role;

commit;

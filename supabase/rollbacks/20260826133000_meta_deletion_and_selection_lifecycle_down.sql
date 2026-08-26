-- Emergency application rollback for 20260826133000.
-- Retain additive columns, deduplication evidence, generation-aware fences, and
-- selection deactivation because they are backward-compatible security fixes.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '2min';

-- The prior application deletion and prepare grants are restored by the cutover rollback.
revoke execute on function public.canary_prepare_meta_connection_v2(uuid,text,uuid,text,text,text,text,uuid,bigint) from service_role;
revoke execute on function public.canary_complete_meta_data_deletion_v2(text,text,text,text,timestamptz) from service_role;

commit;

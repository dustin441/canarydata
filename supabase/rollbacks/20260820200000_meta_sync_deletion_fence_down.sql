-- Restore the pre-fence service-role RPC surface. Disable all Meta writers before rollback.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '5min';

revoke all on function public.canary_fenced_link_selected_meta_assets(text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.canary_fenced_ingest_owned_social_observation(uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.canary_fenced_upsert_meta_metric_snapshots(uuid, uuid, jsonb) from public, anon, authenticated, service_role;

drop function public.canary_fenced_link_selected_meta_assets(text, uuid);
drop function public.canary_fenced_ingest_owned_social_observation(uuid, jsonb);
drop function public.canary_fenced_upsert_meta_metric_snapshots(uuid, uuid, jsonb);

grant execute on function public.canary_link_selected_meta_assets(text, uuid) to service_role;
grant execute on function public.canary_ingest_owned_social_observation(uuid, jsonb) to service_role;
grant execute on function public.canary_upsert_meta_metric_snapshots(uuid, uuid, jsonb) to service_role;

commit;

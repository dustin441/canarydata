begin;

-- Disable META_NATIVE_SYNC_ENABLED before applying this rollback.
revoke all on function public.canary_upsert_meta_metric_snapshots(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.canary_upsert_meta_metric_snapshot(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
drop function public.canary_upsert_meta_metric_snapshots(uuid, uuid, jsonb);
drop function public.canary_upsert_meta_metric_snapshot(uuid, uuid, jsonb);
drop table public.social_provider_metric_snapshots;

commit;

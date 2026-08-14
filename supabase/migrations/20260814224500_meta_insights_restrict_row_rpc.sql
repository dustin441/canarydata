-- Production follow-up for Supabase default function grants.
-- Safe to run after 20260814223000_meta_owned_social_insights.sql.
-- Restricts service_role writes to the bounded bulk RPC only.

begin;
set local lock_timeout = '10s';
set local statement_timeout = '1min';

revoke all on function public.canary_upsert_meta_metric_snapshot(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;

revoke all on function public.canary_upsert_meta_metric_snapshots(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.canary_upsert_meta_metric_snapshots(uuid, uuid, jsonb)
  to service_role;

commit;

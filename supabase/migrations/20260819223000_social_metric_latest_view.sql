set lock_timeout = '10s';
set statement_timeout = '5min';

create index concurrently if not exists social_provider_metric_snapshots_latest_idx
  on public.social_provider_metric_snapshots (
    provider_account_link_id,
    provider_object_id,
    provider_metric_name,
    metric_variant,
    period,
    source_scope,
    effective_at desc,
    observed_at desc,
    id
  );

begin;

create or replace view public.canary_latest_social_metric_snapshots
with (security_invoker = true)
as
select distinct on (
  provider_account_link_id,
  provider_object_id,
  provider_metric_name,
  metric_variant,
  period,
  source_scope
)
  id,
  district_id,
  provider_account_link_id,
  social_thread_id,
  provider,
  platform,
  metric_scope,
  provider_object_id,
  provider_metric_name,
  normalized_metric_name,
  metric_variant,
  period,
  period_start_at,
  period_end_at,
  source_scope,
  availability,
  metric_value,
  breakdown,
  effective_at,
  observed_at
from public.social_provider_metric_snapshots
order by
  provider_account_link_id,
  provider_object_id,
  provider_metric_name,
  metric_variant,
  period,
  source_scope,
  effective_at desc,
  observed_at desc,
  id;

revoke all on public.canary_latest_social_metric_snapshots from public, anon, authenticated;
grant select on public.canary_latest_social_metric_snapshots to service_role;

commit;
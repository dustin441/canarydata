-- Additive, tenant-scoped Meta Insights snapshots.
-- Apply only after 20260813224000_meta_owned_social_sync.sql.

begin;
set local lock_timeout = '10s';
set local statement_timeout = '5min';

create table public.social_provider_metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  district_id text not null references public.districts(id) on delete cascade,
  provider_account_link_id uuid not null,
  social_thread_id uuid,
  provider text not null default 'meta' check (provider = 'meta'),
  platform text not null check (platform in ('facebook','instagram')),
  metric_scope text not null check (metric_scope in ('account','content')),
  provider_object_id text not null check (btrim(provider_object_id) <> ''),
  provider_metric_name text not null check (btrim(provider_metric_name) <> ''),
  normalized_metric_name text not null check (btrim(normalized_metric_name) <> ''),
  metric_variant text not null default 'default' check (btrim(metric_variant) <> ''),
  period text not null default 'lifetime' check (btrim(period) <> ''),
  period_start_at timestamptz,
  period_end_at timestamptz,
  source_scope text not null default 'unknown' check (source_scope in ('organic','paid','total','unknown')),
  availability text not null default 'available' check (availability in ('available','unavailable','unsupported','error')),
  metric_value numeric,
  breakdown jsonb not null default '{}'::jsonb check (jsonb_typeof(breakdown) = 'object'),
  effective_at timestamptz not null,
  observed_at timestamptz not null default now(),
  provider_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(provider_metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_account_link_id, provider_object_id, provider_metric_name, metric_variant, period, source_scope, effective_at),
  foreign key (provider_account_link_id, district_id)
    references public.social_provider_account_links(id, district_id) on delete cascade,
  foreign key (social_thread_id, district_id)
    references public.social_threads(id, district_id) on delete cascade,
  check ((metric_scope = 'content' and social_thread_id is not null) or (metric_scope = 'account' and social_thread_id is null)),
  check (period_start_at is null or period_end_at is null or period_end_at >= period_start_at),
  check (availability <> 'available' or metric_value is not null or breakdown <> '{}'::jsonb)
);

create index social_provider_metric_snapshots_thread_idx
  on public.social_provider_metric_snapshots (district_id, social_thread_id, effective_at desc)
  where social_thread_id is not null;
create index social_provider_metric_snapshots_account_idx
  on public.social_provider_metric_snapshots (district_id, provider_account_link_id, normalized_metric_name, effective_at desc);

create or replace function public.canary_upsert_meta_metric_snapshot(
  p_provider_account_link_id uuid,
  p_social_thread_id uuid,
  p_metric jsonb
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link public.social_provider_account_links%rowtype;
  v_asset public.social_provider_assets%rowtype;
  v_connection public.social_provider_connections%rowtype;
  v_thread public.social_threads%rowtype;
  v_scope text := coalesce(p_metric->>'metric_scope','');
  v_object_id text := btrim(coalesce(p_metric->>'provider_object_id',''));
  v_provider_metric text := btrim(coalesce(p_metric->>'provider_metric_name',''));
  v_normalized_metric text := btrim(coalesce(p_metric->>'normalized_metric_name',''));
  v_metric_variant text := btrim(coalesce(p_metric->>'metric_variant','default'));
  v_period text := btrim(coalesce(p_metric->>'period','lifetime'));
  v_period_start_at timestamptz := nullif(p_metric->>'period_start_at','')::timestamptz;
  v_period_end_at timestamptz := nullif(p_metric->>'period_end_at','')::timestamptz;
  v_source_scope text := coalesce(p_metric->>'source_scope','unknown');
  v_availability text := coalesce(p_metric->>'availability','available');
  v_value numeric;
  v_breakdown jsonb := coalesce(p_metric->'breakdown','{}'::jsonb);
  v_effective_at timestamptz;
  v_observed_at timestamptz := coalesce(nullif(p_metric->>'observed_at','')::timestamptz, now());
  v_metadata jsonb := coalesce(p_metric->'provider_metadata','{}'::jsonb);
  v_id uuid;
begin
  if jsonb_typeof(p_metric) <> 'object' then raise exception 'Metric payload must be an object'; end if;
  select * into v_link from public.social_provider_account_links
  where id=p_provider_account_link_id and provider='meta' and active for update;
  if not found then raise exception 'Active Meta provider-account link is required'; end if;

  select * into v_asset from public.social_provider_assets
  where id=v_link.provider_asset_id and district_id=v_link.district_id and selected and active for update;
  if not found then raise exception 'Selected active Meta asset is required'; end if;

  select * into v_connection from public.social_provider_connections
  where id=v_asset.connection_id and district_id=v_asset.district_id and provider='meta'
    and status in ('active','needs_permissions') for update;
  if not found then raise exception 'Active Meta connection is required'; end if;

  if v_scope not in ('account','content') then raise exception 'Metric scope must be account or content'; end if;
  if v_object_id='' or v_provider_metric='' or v_normalized_metric='' or v_metric_variant='' or v_period='' then
    raise exception 'Metric object, provider name, normalized name, variant, and period are required';
  end if;
  if v_source_scope not in ('organic','paid','total','unknown') then raise exception 'Invalid metric source scope'; end if;
  if v_availability not in ('available','unavailable','unsupported','error') then raise exception 'Invalid metric availability'; end if;
  if jsonb_typeof(v_breakdown) <> 'object' or jsonb_typeof(v_metadata) <> 'object' then raise exception 'Metric breakdown and metadata must be objects'; end if;
  v_effective_at := nullif(p_metric->>'effective_at','')::timestamptz;
  if v_effective_at is null then raise exception 'Metric effective_at is required'; end if;
  if v_period_start_at is not null and v_period_end_at is not null and v_period_end_at < v_period_start_at then raise exception 'Metric period end cannot precede its start'; end if;
  if p_metric ? 'metric_value' and jsonb_typeof(p_metric->'metric_value') = 'number' then v_value := (p_metric->>'metric_value')::numeric; end if;
  if v_value is not null and (v_value = 'NaN'::numeric or v_value < 0) then raise exception 'Metric value must be a finite non-negative number'; end if;
  if v_availability='available' and v_value is null and v_breakdown='{}'::jsonb then raise exception 'Available metric requires a value or breakdown'; end if;

  if v_scope='content' then
    if p_social_thread_id is null then raise exception 'Content metric requires a Social thread'; end if;
    select * into v_thread from public.social_threads
    where id=p_social_thread_id and district_id=v_link.district_id
      and social_account_id=v_link.social_account_id and provider='meta'
      and platform=v_asset.platform and external_thread_id=v_object_id for update;
    if not found then raise exception 'Content metric does not match the tenant-bound Meta thread'; end if;
  else
    if p_social_thread_id is not null then raise exception 'Account metric cannot reference a Social thread'; end if;
    if v_object_id <> v_asset.provider_asset_id then raise exception 'Account metric does not match the selected Meta asset'; end if;
  end if;

  insert into public.social_provider_metric_snapshots (
    district_id,provider_account_link_id,social_thread_id,provider,platform,metric_scope,
    provider_object_id,provider_metric_name,normalized_metric_name,metric_variant,period,period_start_at,period_end_at,source_scope,
    availability,metric_value,breakdown,effective_at,observed_at,provider_metadata
  ) values (
    v_link.district_id,v_link.id,p_social_thread_id,'meta',v_asset.platform,v_scope,
    v_object_id,v_provider_metric,v_normalized_metric,v_metric_variant,v_period,v_period_start_at,v_period_end_at,v_source_scope,
    v_availability,v_value,v_breakdown,v_effective_at,v_observed_at,v_metadata
  ) on conflict (provider_account_link_id,provider_object_id,provider_metric_name,metric_variant,period,source_scope,effective_at)
  do update set
    social_thread_id=excluded.social_thread_id,
    normalized_metric_name=excluded.normalized_metric_name,
    period_start_at=excluded.period_start_at,
    period_end_at=excluded.period_end_at,
    availability=excluded.availability,
    metric_value=excluded.metric_value,
    breakdown=excluded.breakdown,
    observed_at=excluded.observed_at,
    provider_metadata=excluded.provider_metadata,
    updated_at=now()
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.canary_upsert_meta_metric_snapshots(
  p_provider_account_link_id uuid,
  p_social_thread_id uuid,
  p_metrics jsonb
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_metric jsonb;
  v_count integer := 0;
begin
  if jsonb_typeof(p_metrics) <> 'array' then raise exception 'Metrics payload must be an array'; end if;
  if jsonb_array_length(p_metrics) > 250 then raise exception 'Metrics payload exceeds the 250-row limit'; end if;
  for v_metric in select value from jsonb_array_elements(p_metrics)
  loop
    perform public.canary_upsert_meta_metric_snapshot(p_provider_account_link_id,p_social_thread_id,v_metric);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

alter table public.social_provider_metric_snapshots enable row level security;
revoke all on public.social_provider_metric_snapshots from anon, authenticated;
grant select on public.social_provider_metric_snapshots to service_role;
revoke all on function public.canary_upsert_meta_metric_snapshot(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.canary_upsert_meta_metric_snapshots(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.canary_upsert_meta_metric_snapshots(uuid, uuid, jsonb) to service_role;

commit;

-- Transactionally fence canonical Meta writes against provider deletion and district disconnect.
-- Apply after 20260818190000_meta_oauth_attempt_lifecycle.sql and owned-social Insights migrations.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '5min';

create or replace function public.canary_fenced_link_selected_meta_assets(
  p_district_id text,
  p_connection_id uuid
) returns integer
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_connection public.social_provider_connections%rowtype;
  v_provider_user_id_hash text;
begin
  select * into v_connection
  from public.social_provider_connections
  where id = p_connection_id and district_id = p_district_id and provider = 'meta'
    and status in ('active','needs_permissions');
  if not found then raise exception 'Active Meta connection is required'; end if;

  v_provider_user_id_hash := encode(digest(convert_to(v_connection.provider_user_id, 'UTF8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended('canary-meta-provider-user:' || v_provider_user_id_hash, 0));
  perform pg_advisory_xact_lock(hashtextextended('canary-meta-oauth:' || v_connection.district_id, 0));

  select * into v_connection
  from public.social_provider_connections
  where id = p_connection_id and district_id = p_district_id and provider = 'meta'
    and status in ('active','needs_permissions')
    and encode(digest(convert_to(provider_user_id, 'UTF8'), 'sha256'), 'hex') = v_provider_user_id_hash
  for update;
  if not found then raise exception 'Active Meta connection is required after lifecycle fence'; end if;
  if exists (
    select 1 from public.social_provider_deletion_requests
    where provider = 'meta' and provider_user_id_hash = v_provider_user_id_hash and status = 'completed'
  ) then raise exception 'Completed Meta provider deletion fence prevents canonical writes'; end if;

  return public.canary_link_selected_meta_assets(p_district_id, p_connection_id);
end;
$$;

create or replace function public.canary_fenced_ingest_owned_social_observation(
  p_provider_account_link_id uuid,
  p_thread jsonb
) returns public.social_threads
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_connection public.social_provider_connections%rowtype;
  v_provider_user_id_hash text;
begin
  select c.* into v_connection
  from public.social_provider_account_links l
  join public.social_provider_assets a on a.id = l.provider_asset_id and a.district_id = l.district_id
  join public.social_provider_connections c on c.id = a.connection_id and c.district_id = a.district_id
  where l.id = p_provider_account_link_id and l.provider = 'meta' and l.active
    and a.selected and a.active and c.provider = 'meta' and c.status in ('active','needs_permissions');
  if not found then raise exception 'Active tenant-bound Meta link is required'; end if;

  v_provider_user_id_hash := encode(digest(convert_to(v_connection.provider_user_id, 'UTF8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended('canary-meta-provider-user:' || v_provider_user_id_hash, 0));
  perform pg_advisory_xact_lock(hashtextextended('canary-meta-oauth:' || v_connection.district_id, 0));

  select c.* into v_connection
  from public.social_provider_account_links l
  join public.social_provider_assets a on a.id = l.provider_asset_id and a.district_id = l.district_id
  join public.social_provider_connections c on c.id = a.connection_id and c.district_id = a.district_id
  where l.id = p_provider_account_link_id and l.provider = 'meta' and l.active
    and a.selected and a.active and c.provider = 'meta' and c.status in ('active','needs_permissions')
    and encode(digest(convert_to(c.provider_user_id, 'UTF8'), 'sha256'), 'hex') = v_provider_user_id_hash
  for update of c, a, l;
  if not found then raise exception 'Active tenant-bound Meta link is required after lifecycle fence'; end if;
  if exists (
    select 1 from public.social_provider_deletion_requests
    where provider = 'meta' and provider_user_id_hash = v_provider_user_id_hash and status = 'completed'
  ) then raise exception 'Completed Meta provider deletion fence prevents canonical writes'; end if;

  return public.canary_ingest_owned_social_observation(p_provider_account_link_id, p_thread);
end;
$$;

create or replace function public.canary_fenced_upsert_meta_metric_snapshots(
  p_provider_account_link_id uuid,
  p_social_thread_id uuid,
  p_metrics jsonb
) returns integer
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_connection public.social_provider_connections%rowtype;
  v_provider_user_id_hash text;
begin
  select c.* into v_connection
  from public.social_provider_account_links l
  join public.social_provider_assets a on a.id = l.provider_asset_id and a.district_id = l.district_id
  join public.social_provider_connections c on c.id = a.connection_id and c.district_id = a.district_id
  where l.id = p_provider_account_link_id and l.provider = 'meta' and l.active
    and a.selected and a.active and c.provider = 'meta' and c.status in ('active','needs_permissions');
  if not found then raise exception 'Active tenant-bound Meta link is required'; end if;

  v_provider_user_id_hash := encode(digest(convert_to(v_connection.provider_user_id, 'UTF8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended('canary-meta-provider-user:' || v_provider_user_id_hash, 0));
  perform pg_advisory_xact_lock(hashtextextended('canary-meta-oauth:' || v_connection.district_id, 0));

  select c.* into v_connection
  from public.social_provider_account_links l
  join public.social_provider_assets a on a.id = l.provider_asset_id and a.district_id = l.district_id
  join public.social_provider_connections c on c.id = a.connection_id and c.district_id = a.district_id
  where l.id = p_provider_account_link_id and l.provider = 'meta' and l.active
    and a.selected and a.active and c.provider = 'meta' and c.status in ('active','needs_permissions')
    and encode(digest(convert_to(c.provider_user_id, 'UTF8'), 'sha256'), 'hex') = v_provider_user_id_hash
  for update of c, a, l;
  if not found then raise exception 'Active tenant-bound Meta link is required after lifecycle fence'; end if;
  if exists (
    select 1 from public.social_provider_deletion_requests
    where provider = 'meta' and provider_user_id_hash = v_provider_user_id_hash and status = 'completed'
  ) then raise exception 'Completed Meta provider deletion fence prevents canonical writes'; end if;

  return public.canary_upsert_meta_metric_snapshots(p_provider_account_link_id, p_social_thread_id, p_metrics);
end;
$$;

revoke execute on function public.canary_link_selected_meta_assets(text, uuid) from service_role;
revoke execute on function public.canary_ingest_owned_social_observation(uuid, jsonb) from service_role;
revoke execute on function public.canary_upsert_meta_metric_snapshots(uuid, uuid, jsonb) from service_role;

revoke all on function public.canary_fenced_link_selected_meta_assets(text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.canary_fenced_ingest_owned_social_observation(uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.canary_fenced_upsert_meta_metric_snapshots(uuid, uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.canary_fenced_link_selected_meta_assets(text, uuid) to service_role;
grant execute on function public.canary_fenced_ingest_owned_social_observation(uuid, jsonb) to service_role;
grant execute on function public.canary_fenced_upsert_meta_metric_snapshots(uuid, uuid, jsonb) to service_role;

commit;

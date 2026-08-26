-- Harden Meta deletion, reconnect, and asset-selection lifecycle semantics.
-- Apply after 20260826130000_meta_connection_health.sql.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '5min';

alter table public.social_provider_deletion_requests
  add column if not exists signed_request_hash text,
  add column if not exists issued_at timestamptz;
create unique index if not exists social_provider_deletion_requests_signed_request_key
  on public.social_provider_deletion_requests (signed_request_hash)
  where signed_request_hash is not null;

-- Versioned prepare keeps provider issuance time separate from processing time.
create or replace function public.canary_prepare_meta_connection_v2(
  p_attempt_id uuid,
  p_district_id text,
  p_connected_by uuid,
  p_provider_app_id text,
  p_provider_user_id text,
  p_provider_user_id_hash text,
  p_provider_user_name text,
  p_expected_connection_id uuid,
  p_expected_lifecycle_version bigint
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_connection public.social_provider_connections%rowtype;
  v_expired_attempt public.social_provider_connection_attempts%rowtype;
  v_connection_id uuid;
  v_state_created_at timestamptz;
begin
  if p_attempt_id is null then raise exception 'Meta OAuth attempt ID is required'; end if;
  if coalesce(p_provider_app_id, '') = '' then raise exception 'Meta application ID is required'; end if;
  if coalesce(p_provider_user_id, '') = '' then raise exception 'Meta provider identity is required'; end if;
  if coalesce(p_provider_user_id_hash, '') = '' then raise exception 'Meta provider identity hash is required'; end if;
  if (p_expected_connection_id is null) <> (p_expected_lifecycle_version is null) then
    raise exception 'Incomplete Meta lifecycle expectation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('canary-meta-provider-user:' || p_provider_user_id_hash, 0));
  perform pg_advisory_xact_lock(hashtextextended('canary-meta-oauth:' || p_district_id, 0));

  select created_at into v_state_created_at
  from public.social_provider_oauth_states
  where oauth_attempt_id = p_attempt_id and consumed_at is not null
  order by created_at desc
  limit 1;
  if not found then raise exception 'Meta OAuth attempt state is unavailable'; end if;
  if exists (
    select 1 from public.social_provider_deletion_requests
    where provider = 'meta'
      and provider_user_id_hash = p_provider_user_id_hash
      and status = 'completed'
      and coalesce(issued_at, completed_at) >= v_state_created_at
  ) then
    raise exception 'Stale Meta OAuth callback: provider identity was deleted after authorization started';
  end if;

  for v_expired_attempt in
    select * from public.social_provider_connection_attempts
    where district_id = p_district_id and provider = 'meta'
      and status = 'pending' and expires_at <= now()
    for update
  loop
    if v_expired_attempt.expected_connection_id is null then
      delete from public.social_provider_connections c
      where c.id = v_expired_attempt.connection_id and c.district_id = p_district_id
        and c.provider = 'meta' and c.status = 'pending' and c.lifecycle_version = 1
        and not exists (
          select 1 from public.social_provider_credentials k
          where k.connection_id = c.id and k.district_id = c.district_id
        );
    end if;
    update public.social_provider_connection_attempts
    set status = 'abandoned', updated_at = now()
    where attempt_id = v_expired_attempt.attempt_id and status = 'pending';
  end loop;

  if exists (
    select 1 from public.social_provider_connection_attempts
    where district_id = p_district_id and provider = 'meta' and status = 'pending'
  ) then
    raise exception 'Another Meta OAuth attempt is already in progress';
  end if;

  select * into v_connection
  from public.social_provider_connections
  where district_id = p_district_id and provider = 'meta'
  for update;

  if found and v_connection.provider_user_id <> p_provider_user_id then
    raise exception 'A different Meta identity is already associated with this district';
  end if;

  if p_expected_connection_id is null then
    if found then raise exception 'Stale Meta OAuth callback: connection changed'; end if;
    insert into public.social_provider_connections (
      district_id, provider, provider_app_id, provider_user_id,
      provider_user_name, status, connected_by, lifecycle_version
    ) values (
      p_district_id, 'meta', p_provider_app_id, p_provider_user_id,
      p_provider_user_name, 'pending', p_connected_by, 1
    ) returning id into v_connection_id;
  else
    if not found
      or v_connection.id <> p_expected_connection_id
      or v_connection.lifecycle_version <> p_expected_lifecycle_version then
      raise exception 'Stale Meta OAuth callback: connection changed';
    end if;
    v_connection_id := v_connection.id;
  end if;

  insert into public.social_provider_connection_attempts (
    attempt_id, district_id, provider, connection_id,
    provider_user_id_hash, expected_connection_id, expected_lifecycle_version, status
  ) values (
    p_attempt_id, p_district_id, 'meta', v_connection_id,
    p_provider_user_id_hash, p_expected_connection_id, p_expected_lifecycle_version, 'pending'
  );
  return v_connection_id;
end;
$$;

revoke all on function public.canary_prepare_meta_connection_v2(uuid,text,uuid,text,text,text,text,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.canary_prepare_meta_connection_v2(uuid,text,uuid,text,text,text,text,uuid,bigint) to service_role;

-- Asset selection is also the canonical-account activation boundary. Unselection
-- must deactivate links immediately even when no later synchronization runs.
create or replace function public.canary_replace_meta_asset_mappings(
  p_district_id text,
  p_asset_ids uuid[],
  p_mapped_by uuid,
  p_scope_label text
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  selected_count integer;
begin
  if p_scope_label is null or btrim(p_scope_label) = '' then
    raise exception 'Scope label is required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('canary-meta-oauth:' || p_district_id, 0));

  update public.social_provider_assets
  set selected = false
  where district_id = p_district_id;
  delete from public.social_account_mappings where district_id = p_district_id;

  update public.social_provider_assets
  set selected = true
  where district_id = p_district_id
    and active = true
    and id = any(coalesce(p_asset_ids, '{}'::uuid[]));
  get diagnostics selected_count = row_count;
  if selected_count <> cardinality(coalesce(p_asset_ids, '{}'::uuid[])) then
    raise exception 'One or more Meta assets do not belong to this district';
  end if;

  insert into public.social_account_mappings (
    district_id, provider_asset_id, scope_type, scope_label, reporting_enabled, mapped_by
  )
  select p_district_id, id, 'district', btrim(p_scope_label), true, p_mapped_by
  from public.social_provider_assets
  where district_id = p_district_id and selected;

  update public.social_provider_account_links l
  set active = false, updated_at = now()
  where l.district_id = p_district_id and l.provider = 'meta'
    and not exists (
      select 1 from public.social_provider_assets a
      where a.id = l.provider_asset_id and a.district_id = l.district_id
        and a.selected and a.active
    );
  update public.social_accounts s
  set active = false, connection_status = 'disconnected', updated_at = now()
  where s.district_id = p_district_id and s.provider = 'meta'
    and not exists (
      select 1 from public.social_provider_account_links l
      where l.social_account_id = s.id and l.active
    );
  return selected_count;
end;
$$;

-- A fresh OAuth grant is writable only when it postdates every completed deletion
-- for the same provider identity. Historical deletions no longer poison later grants.
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
  select * into v_connection from public.social_provider_connections
  where id=p_connection_id and district_id=p_district_id and provider='meta'
    and status in ('active','needs_permissions');
  if not found then raise exception 'Active Meta connection is required'; end if;
  v_provider_user_id_hash := encode(digest(convert_to(v_connection.provider_user_id,'UTF8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('canary-meta-provider-user:'||v_provider_user_id_hash,0));
  perform pg_advisory_xact_lock(hashtextextended('canary-meta-oauth:'||v_connection.district_id,0));
  select * into v_connection from public.social_provider_connections
  where id=p_connection_id and district_id=p_district_id and provider='meta'
    and status in ('active','needs_permissions')
    and encode(digest(convert_to(provider_user_id,'UTF8'),'sha256'),'hex')=v_provider_user_id_hash
  for update;
  if not found then raise exception 'Active Meta connection is required after lifecycle fence'; end if;
  if exists (
    select 1 from public.social_provider_deletion_requests
    where provider='meta' and provider_user_id_hash=v_provider_user_id_hash and status='completed'
      and (v_connection.connected_at is null or coalesce(issued_at,completed_at) >= v_connection.connected_at)
  ) then raise exception 'Completed Meta provider deletion fence prevents canonical writes'; end if;
  return public.canary_link_selected_meta_assets(p_district_id,p_connection_id);
end;
$$;

-- A controlled pilot activates only the exact tenant-bound asset authorized by
-- that request. It never links other selected assets as a side effect.
create or replace function public.canary_fenced_link_meta_pilot_asset(
  p_district_id text,
  p_connection_id uuid,
  p_provider_asset_id uuid
) returns integer
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_connection public.social_provider_connections%rowtype;
  v_provider_user_id text;
  v_provider_user_id_hash text;
  v_linked integer := 0;
begin
  select provider_user_id into v_provider_user_id from public.social_provider_connections
  where id=p_connection_id and district_id=p_district_id and provider='meta';
  if not found then raise exception 'Active Meta connection does not belong to this district'; end if;
  v_provider_user_id_hash := encode(digest(convert_to(v_provider_user_id,'UTF8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('canary-meta-provider-user:'||v_provider_user_id_hash,0));
  perform pg_advisory_xact_lock(hashtextextended('canary-meta-oauth:'||p_district_id,0));
  select * into v_connection from public.social_provider_connections
  where id=p_connection_id and district_id=p_district_id and provider='meta'
    and provider_user_id=v_provider_user_id
    and status in ('active','needs_permissions') for update;
  if not found then raise exception 'Meta connection changed during canonical write'; end if;
  if not exists (
    select 1 from public.social_provider_assets
    where id=p_provider_asset_id and district_id=p_district_id and connection_id=p_connection_id
      and selected and active and asset_type in ('facebook_page','instagram_account')
  ) then raise exception 'Exact selected Meta pilot asset is required'; end if;
  if exists (
    select 1 from public.social_provider_deletion_requests
    where provider='meta' and provider_user_id_hash=v_provider_user_id_hash and status='completed'
      and (v_connection.connected_at is null or coalesce(issued_at,completed_at) >= v_connection.connected_at)
  ) then raise exception 'Completed Meta provider deletion fence prevents canonical writes'; end if;

  insert into public.social_accounts (
    district_id,platform,provider,platform_account_id,handle,display_name,profile_url,
    authorization_mode,connection_status,credential_reference,granted_scopes,active,connected_at,metadata
  )
  select a.district_id,a.platform,'meta',a.provider_asset_id,a.handle,a.name,a.profile_url,
    'official','connected',p_connection_id::text,'[]'::jsonb,true,now(),jsonb_build_object('meta_provider_asset_id',a.id)
  from public.social_provider_assets a
  where a.id=p_provider_asset_id and a.district_id=p_district_id and a.connection_id=p_connection_id
    and a.selected and a.active
    and not exists (
      select 1 from public.social_accounts s
      where s.district_id=a.district_id and s.platform=a.platform
        and (s.platform_account_id=a.provider_asset_id
          or (a.handle is not null and lower(regexp_replace(btrim(s.handle),'^@+',''))=lower(regexp_replace(btrim(a.handle),'^@+',''))))
    );

  insert into public.social_provider_account_links (
    district_id,social_account_id,provider_asset_id,provider,active
  )
  select a.district_id,s.id,a.id,'meta',true
  from public.social_provider_assets a
  join lateral (
    select candidate.id from public.social_accounts candidate
    where candidate.district_id=a.district_id and candidate.platform=a.platform
      and (candidate.platform_account_id=a.provider_asset_id
        or (a.handle is not null and lower(regexp_replace(btrim(candidate.handle),'^@+',''))=lower(regexp_replace(btrim(a.handle),'^@+',''))))
    order by (candidate.platform_account_id=a.provider_asset_id) desc,candidate.id limit 1
  ) s on true
  where a.id=p_provider_asset_id and a.district_id=p_district_id and a.connection_id=p_connection_id
    and a.selected and a.active
  on conflict (provider_asset_id) do update
    set social_account_id=excluded.social_account_id,active=true,updated_at=now();
  get diagnostics v_linked=row_count;
  return v_linked;
end;
$$;

revoke all on function public.canary_fenced_link_meta_pilot_asset(text,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.canary_fenced_link_meta_pilot_asset(text,uuid,uuid) to service_role;

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
  join public.social_provider_assets a on a.id=l.provider_asset_id and a.district_id=l.district_id
  join public.social_provider_connections c on c.id=a.connection_id and c.district_id=a.district_id
  where l.id=p_provider_account_link_id and l.provider='meta' and l.active
    and a.selected and a.active and c.provider='meta' and c.status in ('active','needs_permissions');
  if not found then raise exception 'Active tenant-bound Meta link is required'; end if;
  v_provider_user_id_hash := encode(digest(convert_to(v_connection.provider_user_id,'UTF8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('canary-meta-provider-user:'||v_provider_user_id_hash,0));
  perform pg_advisory_xact_lock(hashtextextended('canary-meta-oauth:'||v_connection.district_id,0));
  select c.* into v_connection
  from public.social_provider_account_links l
  join public.social_provider_assets a on a.id=l.provider_asset_id and a.district_id=l.district_id
  join public.social_provider_connections c on c.id=a.connection_id and c.district_id=a.district_id
  where l.id=p_provider_account_link_id and l.provider='meta' and l.active
    and a.selected and a.active and c.provider='meta' and c.status in ('active','needs_permissions')
    and encode(digest(convert_to(c.provider_user_id,'UTF8'),'sha256'),'hex')=v_provider_user_id_hash
  for update of c,a,l;
  if not found then raise exception 'Active tenant-bound Meta link is required after lifecycle fence'; end if;
  if exists (
    select 1 from public.social_provider_deletion_requests
    where provider='meta' and provider_user_id_hash=v_provider_user_id_hash and status='completed'
      and (v_connection.connected_at is null or coalesce(issued_at,completed_at) >= v_connection.connected_at)
  ) then raise exception 'Completed Meta provider deletion fence prevents canonical writes'; end if;
  return public.canary_ingest_owned_social_observation(p_provider_account_link_id,p_thread);
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
  join public.social_provider_assets a on a.id=l.provider_asset_id and a.district_id=l.district_id
  join public.social_provider_connections c on c.id=a.connection_id and c.district_id=a.district_id
  where l.id=p_provider_account_link_id and l.provider='meta' and l.active
    and a.selected and a.active and c.provider='meta' and c.status in ('active','needs_permissions');
  if not found then raise exception 'Active tenant-bound Meta link is required'; end if;
  v_provider_user_id_hash := encode(digest(convert_to(v_connection.provider_user_id,'UTF8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('canary-meta-provider-user:'||v_provider_user_id_hash,0));
  perform pg_advisory_xact_lock(hashtextextended('canary-meta-oauth:'||v_connection.district_id,0));
  select c.* into v_connection
  from public.social_provider_account_links l
  join public.social_provider_assets a on a.id=l.provider_asset_id and a.district_id=l.district_id
  join public.social_provider_connections c on c.id=a.connection_id and c.district_id=a.district_id
  where l.id=p_provider_account_link_id and l.provider='meta' and l.active
    and a.selected and a.active and c.provider='meta' and c.status in ('active','needs_permissions')
    and encode(digest(convert_to(c.provider_user_id,'UTF8'),'sha256'),'hex')=v_provider_user_id_hash
  for update of c,a,l;
  if not found then raise exception 'Active tenant-bound Meta link is required after lifecycle fence'; end if;
  if exists (
    select 1 from public.social_provider_deletion_requests
    where provider='meta' and provider_user_id_hash=v_provider_user_id_hash and status='completed'
      and (v_connection.connected_at is null or coalesce(issued_at,completed_at) >= v_connection.connected_at)
  ) then raise exception 'Completed Meta provider deletion fence prevents canonical writes'; end if;
  return public.canary_upsert_meta_metric_snapshots(p_provider_account_link_id,p_social_thread_id,p_metrics);
end;
$$;

-- Fresh signed requests are processed once. A byte-for-byte replay returns the
-- original receipt and cannot delete a later authorization generation.
create or replace function public.canary_complete_meta_data_deletion_v2(
  p_provider_user_id text,
  p_provider_user_id_hash text,
  p_confirmation_code text,
  p_signed_request_hash text,
  p_issued_at timestamptz
) returns table (deleted_count integer, confirmation_code text, replayed boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer := 0;
  v_existing_code text;
  v_district_id text;
begin
  if coalesce(p_provider_user_id,'')='' or coalesce(p_provider_user_id_hash,'')=''
    or coalesce(p_confirmation_code,'')='' or coalesce(p_signed_request_hash,'')='' or p_issued_at is null then
    raise exception 'Meta deletion parameters are required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('canary-meta-provider-user:'||p_provider_user_id_hash,0));

  select r.confirmation_code into v_existing_code
  from public.social_provider_deletion_requests r
  where r.signed_request_hash=p_signed_request_hash
  for update;
  if found then
    return query select 0, v_existing_code, true;
    return;
  end if;

  if p_issued_at < clock_timestamp() - interval '24 hours'
    or p_issued_at > clock_timestamp() + interval '5 minutes' then
    raise exception 'Meta deletion request is outside the accepted freshness window';
  end if;

  for v_district_id in
    select district_id from public.social_provider_connections
    where provider='meta' and provider_user_id=p_provider_user_id order by district_id
  loop
    perform pg_advisory_xact_lock(hashtextextended('canary-meta-oauth:'||v_district_id,0));
  end loop;

  delete from public.social_threads t
  where t.provider='meta' and exists (
    select 1 from public.social_provider_account_links l
    join public.social_provider_assets a on a.id=l.provider_asset_id and a.district_id=l.district_id
    join public.social_provider_connections c on c.id=a.connection_id and c.district_id=a.district_id
    where l.social_account_id=t.social_account_id and c.provider='meta' and c.provider_user_id=p_provider_user_id
      and (c.connected_at is null or c.connected_at <= p_issued_at)
  );
  delete from public.social_accounts s
  where s.provider='meta' and exists (
    select 1 from public.social_provider_account_links l
    join public.social_provider_assets a on a.id=l.provider_asset_id and a.district_id=l.district_id
    join public.social_provider_connections c on c.id=a.connection_id and c.district_id=a.district_id
    where l.social_account_id=s.id and c.provider='meta' and c.provider_user_id=p_provider_user_id
      and (c.connected_at is null or c.connected_at <= p_issued_at)
  );
  delete from public.social_provider_connections
  where provider='meta' and provider_user_id=p_provider_user_id
    and (connected_at is null or connected_at <= p_issued_at);
  get diagnostics v_deleted=row_count;

  insert into public.social_provider_deletion_requests(
    confirmation_code,provider,provider_user_id_hash,status,completed_at,detail,
    signed_request_hash,issued_at
  ) values (
    p_confirmation_code,'meta',p_provider_user_id_hash,'completed',clock_timestamp(),
    format('Deleted %s Meta connection%s.',v_deleted,case when v_deleted=1 then '' else 's' end),
    p_signed_request_hash,p_issued_at
  );
  return query select v_deleted,p_confirmation_code,false;
end;
$$;

revoke all on table
  public.social_provider_oauth_states,
  public.social_provider_connections,
  public.social_provider_credentials,
  public.social_provider_assets,
  public.social_account_mappings,
  public.social_sync_runs,
  public.social_provider_deletion_requests,
  public.social_provider_connection_attempts,
  public.social_provider_account_links,
  public.social_thread_provider_observations,
  public.social_provider_metric_snapshots
from public, anon, authenticated;

revoke all on function public.canary_replace_meta_asset_mappings(text,uuid[],uuid,text) from public,anon,authenticated;
revoke all on function public.canary_fenced_link_selected_meta_assets(text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.canary_fenced_ingest_owned_social_observation(uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.canary_fenced_upsert_meta_metric_snapshots(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.canary_complete_meta_data_deletion_v2(text,text,text,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.canary_replace_meta_asset_mappings(text,uuid[],uuid,text) to service_role;
grant execute on function public.canary_fenced_link_selected_meta_assets(text,uuid) to service_role;
grant execute on function public.canary_fenced_ingest_owned_social_observation(uuid,jsonb) to service_role;
grant execute on function public.canary_fenced_upsert_meta_metric_snapshots(uuid,uuid,jsonb) to service_role;
grant execute on function public.canary_complete_meta_data_deletion_v2(text,text,text,text,timestamptz) to service_role;

commit;

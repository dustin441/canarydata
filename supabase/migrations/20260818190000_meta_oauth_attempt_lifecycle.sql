-- Disabled-first boundary: apply and verify this additive migration while
-- META_INTEGRATION_ENABLED remains false. Deploy schema-dependent code only after verification.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '2min';

alter table public.social_provider_connections
  add column if not exists lifecycle_version bigint not null default 1;

alter table public.social_provider_oauth_states
  add column if not exists oauth_attempt_id uuid,
  add column if not exists expected_connection_id uuid,
  add column if not exists expected_lifecycle_version bigint;

update public.social_provider_oauth_states
set oauth_attempt_id = gen_random_uuid()
where oauth_attempt_id is null;

alter table public.social_provider_oauth_states
  alter column oauth_attempt_id set default gen_random_uuid(),
  alter column oauth_attempt_id set not null;

alter table public.social_provider_oauth_states
  drop constraint if exists social_provider_oauth_states_expected_connection_pair;
alter table public.social_provider_oauth_states
  add constraint social_provider_oauth_states_expected_connection_pair check (
    (expected_connection_id is null and expected_lifecycle_version is null)
    or (expected_connection_id is not null and expected_lifecycle_version is not null)
  );

create table if not exists public.social_provider_connection_attempts (
  attempt_id uuid primary key,
  district_id text not null references public.districts(id) on delete cascade,
  provider text not null default 'meta' check (provider = 'meta'),
  connection_id uuid not null,
  provider_user_id_hash text not null,
  expected_connection_id uuid,
  expected_lifecycle_version bigint,
  status text not null default 'pending' check (status in ('pending','finalized','abandoned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  foreign key (connection_id, district_id)
    references public.social_provider_connections(id, district_id) on delete cascade,
  check (
    (expected_connection_id is null and expected_lifecycle_version is null)
    or (expected_connection_id is not null and expected_lifecycle_version is not null)
  )
);

create unique index if not exists social_provider_connection_attempts_one_pending_idx
  on public.social_provider_connection_attempts (district_id, provider)
  where status = 'pending';
create index if not exists social_provider_connection_attempts_connection_idx
  on public.social_provider_connection_attempts (connection_id, district_id, status);

alter table public.social_provider_connection_attempts enable row level security;
revoke all on public.social_provider_connection_attempts from anon, authenticated;

-- Return the lifecycle snapshot recorded when authorization began. The callback
-- must use this exact attempt/version pair; it may not take a fresh snapshot.
drop function if exists public.canary_consume_meta_oauth_state(text, uuid, text);
create function public.canary_consume_meta_oauth_state(
  p_state_hash text,
  p_user_id uuid,
  p_district_id text
)
returns table (
  return_path text,
  oauth_attempt_id uuid,
  expected_connection_id uuid,
  expected_lifecycle_version bigint
)
language sql
security definer
set search_path = public
as $$
  update public.social_provider_oauth_states
  set consumed_at = now()
  where state_hash = p_state_hash
    and provider = 'meta'
    and user_id = p_user_id
    and district_id = p_district_id
    and consumed_at is null
    and expires_at > now()
  returning
    social_provider_oauth_states.return_path,
    social_provider_oauth_states.oauth_attempt_id,
    social_provider_oauth_states.expected_connection_id,
    social_provider_oauth_states.expected_lifecycle_version;
$$;

-- Preparation is the attempt claim. It never changes an existing healthy
-- connection. A district advisory lock also serializes the no-row case.
drop function if exists public.canary_prepare_meta_connection(text, uuid, text, text, text);
create function public.canary_prepare_meta_connection(
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
      and completed_at >= v_state_created_at
  ) then
    raise exception 'Stale Meta OAuth callback: provider identity was deleted after authorization started';
  end if;

  -- A worker can terminate after claiming an attempt but before finalization.
  -- Expire only attempt-local state so a crashed callback cannot permanently
  -- block a district from reconnecting. Existing healthy connections remain untouched.
  for v_expired_attempt in
    select *
    from public.social_provider_connection_attempts
    where district_id = p_district_id
      and provider = 'meta'
      and status = 'pending'
      and expires_at <= now()
    for update
  loop
    if v_expired_attempt.expected_connection_id is null then
      delete from public.social_provider_connections c
      where c.id = v_expired_attempt.connection_id
        and c.district_id = p_district_id
        and c.provider = 'meta'
        and c.status = 'pending'
        and c.lifecycle_version = 1
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

  -- The first release does not support switching a district's persisted Meta
  -- user identity in place. Overwriting it would erase the immutable
  -- provenance needed to honor a later provider deletion for the old user.
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

-- Failed grants are cleaned up locally only. Meta /me/permissions revocation is
-- app/user-wide and therefore unsafe compensation for one failed attempt.
create or replace function public.canary_abandon_meta_connection_attempt(
  p_attempt_id uuid,
  p_district_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt public.social_provider_connection_attempts%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('canary-meta-oauth:' || p_district_id, 0));
  select * into v_attempt
  from public.social_provider_connection_attempts
  where attempt_id = p_attempt_id and district_id = p_district_id and provider = 'meta'
  for update;
  if not found or v_attempt.status <> 'pending' then return false; end if;

  if v_attempt.expected_connection_id is null then
    delete from public.social_provider_connections c
    where c.id = v_attempt.connection_id
      and c.district_id = p_district_id
      and c.provider = 'meta'
      and c.status = 'pending'
      and c.lifecycle_version = 1
      and not exists (
        select 1 from public.social_provider_credentials k
        where k.connection_id = c.id and k.district_id = c.district_id
      );
    if found then return true; end if;
  end if;

  update public.social_provider_connection_attempts
  set status = 'abandoned', updated_at = now()
  where attempt_id = p_attempt_id and district_id = p_district_id and status = 'pending';
  return found;
end;
$$;

-- Finalization is an optimistic CAS bound to the consumed state attempt and
-- lifecycle snapshot. The connection, credential, and asset writes remain one transaction.
drop function if exists public.canary_finalize_meta_connection(uuid, text, uuid, text, text, text, text, timestamptz, text[], text[], text, smallint, jsonb);
create function public.canary_finalize_meta_connection(
  p_attempt_id uuid,
  p_connection_id uuid,
  p_district_id text,
  p_connected_by uuid,
  p_provider_app_id text,
  p_provider_user_id text,
  p_provider_user_id_hash text,
  p_provider_user_name text,
  p_status text,
  p_token_expires_at timestamptz,
  p_granted_scopes text[],
  p_declined_scopes text[],
  p_encrypted_access_token text,
  p_key_version integer,
  p_assets jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_attempt public.social_provider_connection_attempts%rowtype;
  v_connection public.social_provider_connections%rowtype;
  v_asset_count integer;
begin
  if p_status not in ('active', 'needs_permissions') then raise exception 'Invalid Meta connection status'; end if;
  if coalesce(p_provider_app_id, '') = '' then raise exception 'Meta application ID is required'; end if;
  if coalesce(p_provider_user_id, '') = '' then raise exception 'Meta provider identity is required'; end if;
  if coalesce(p_provider_user_id_hash, '') = '' then raise exception 'Meta provider identity hash is required'; end if;
  if coalesce(p_encrypted_access_token, '') = '' then raise exception 'Encrypted Meta credential is required'; end if;
  if jsonb_typeof(coalesce(p_assets, '[]'::jsonb)) <> 'array' then raise exception 'Meta assets must be an array'; end if;
  v_asset_count := jsonb_array_length(coalesce(p_assets, '[]'::jsonb));
  if v_asset_count > 500 then raise exception 'Too many Meta assets'; end if;

  perform pg_advisory_xact_lock(hashtextextended('canary-meta-provider-user:' || p_provider_user_id_hash, 0));
  perform pg_advisory_xact_lock(hashtextextended('canary-meta-oauth:' || p_district_id, 0));
  select * into v_attempt
  from public.social_provider_connection_attempts
  where attempt_id = p_attempt_id
    and district_id = p_district_id
    and provider = 'meta'
    and connection_id = p_connection_id
    and status = 'pending'
  for update;
  if not found then raise exception 'Stale Meta OAuth callback: attempt is no longer pending'; end if;
  if v_attempt.provider_user_id_hash <> p_provider_user_id_hash then
    raise exception 'Stale Meta OAuth callback: provider identity changed';
  end if;

  select * into v_connection
  from public.social_provider_connections
  where id = p_connection_id and district_id = p_district_id and provider = 'meta'
  for update;
  if not found then raise exception 'Stale Meta OAuth callback: connection was removed'; end if;

  if v_attempt.expected_connection_id is null then
    if v_connection.status <> 'pending' or v_connection.lifecycle_version <> 1 then
      raise exception 'Stale Meta OAuth callback: pending connection changed';
    end if;
  elsif v_connection.id <> v_attempt.expected_connection_id
    or v_connection.lifecycle_version <> v_attempt.expected_lifecycle_version then
    raise exception 'Stale Meta OAuth callback: connection changed';
  end if;

  update public.social_provider_connections
  set provider_app_id = p_provider_app_id,
      provider_user_id = p_provider_user_id,
      provider_user_name = p_provider_user_name,
      status = p_status,
      token_expires_at = p_token_expires_at,
      granted_scopes = coalesce(p_granted_scopes, '{}'::text[]),
      declined_scopes = coalesce(p_declined_scopes, '{}'::text[]),
      connected_by = p_connected_by,
      connected_at = v_now,
      updated_at = v_now,
      last_validated_at = v_now,
      last_error_code = null,
      last_error_message = null,
      revoked_at = null,
      lifecycle_version = lifecycle_version + 1
  where id = p_connection_id
    and district_id = p_district_id
    and provider = 'meta'
    and lifecycle_version = v_connection.lifecycle_version;
  if not found then raise exception 'Stale Meta OAuth callback: compare-and-set failed'; end if;

  insert into public.social_provider_credentials (
    connection_id, district_id, encrypted_access_token, key_version, updated_at
  ) values (
    p_connection_id, p_district_id, p_encrypted_access_token, p_key_version, v_now
  )
  on conflict (connection_id) do update
  set district_id = excluded.district_id,
      encrypted_access_token = excluded.encrypted_access_token,
      key_version = excluded.key_version,
      updated_at = excluded.updated_at;

  delete from public.social_account_mappings
  where district_id = p_district_id
    and provider_asset_id in (
      select id from public.social_provider_assets
      where connection_id = p_connection_id and district_id = p_district_id
    );

  update public.social_provider_assets
  set active = false, selected = false, last_seen_at = v_now
  where connection_id = p_connection_id and district_id = p_district_id;

  insert into public.social_provider_assets (
    district_id, connection_id, provider_asset_id, asset_type, platform,
    name, handle, profile_url, parent_provider_asset_id, selected, active,
    metadata, discovered_at, last_seen_at
  )
  select
    p_district_id, p_connection_id, a.provider_asset_id, a.asset_type, a.platform,
    a.name, a.handle, a.profile_url, a.parent_provider_asset_id, false, true,
    coalesce(a.metadata, '{}'::jsonb), v_now, v_now
  from jsonb_to_recordset(coalesce(p_assets, '[]'::jsonb)) as a(
    provider_asset_id text,
    asset_type text,
    platform text,
    name text,
    handle text,
    profile_url text,
    parent_provider_asset_id text,
    metadata jsonb
  )
  on conflict (district_id, asset_type, provider_asset_id) do update
  set connection_id = excluded.connection_id,
      platform = excluded.platform,
      name = excluded.name,
      handle = excluded.handle,
      profile_url = excluded.profile_url,
      parent_provider_asset_id = excluded.parent_provider_asset_id,
      selected = false,
      active = true,
      metadata = excluded.metadata,
      last_seen_at = excluded.last_seen_at;

  update public.social_provider_connection_attempts
  set status = 'finalized', updated_at = v_now
  where attempt_id = p_attempt_id and district_id = p_district_id and status = 'pending';
  if not found then raise exception 'Stale Meta OAuth callback: attempt finalization failed'; end if;

  return p_connection_id;
end;
$$;

-- Disconnect invalidates all in-flight attempts before deleting credentials.
create or replace function public.canary_disconnect_meta_connection(
  p_connection_id uuid,
  p_district_id text,
  p_revocation_unconfirmed boolean
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_now timestamptz := now();
begin
  perform pg_advisory_xact_lock(hashtextextended('canary-meta-oauth:' || p_district_id, 0));
  update public.social_provider_connection_attempts
  set status = 'abandoned', updated_at = v_now
  where district_id = p_district_id and provider = 'meta' and status = 'pending';

  update public.social_provider_connections
  set status='revoked', revoked_at=v_now, updated_at=v_now,
      lifecycle_version=lifecycle_version + 1,
      last_error_code=case when p_revocation_unconfirmed then 'remote_revocation_unconfirmed' else null end,
      last_error_message=case when p_revocation_unconfirmed then 'Local access was removed, but Meta revocation could not be confirmed.' else null end
  where id=p_connection_id and district_id=p_district_id and provider='meta'
    and status in ('pending','active','needs_permissions','expired','error');
  if not found and not exists (
    select 1 from public.social_provider_connections
    where id=p_connection_id and district_id=p_district_id and provider='meta' and status='revoked'
  ) then raise exception 'Meta connection does not belong to this district'; end if;

  delete from public.social_account_mappings
  where district_id=p_district_id and provider_asset_id in (
    select id from public.social_provider_assets where connection_id=p_connection_id and district_id=p_district_id
  );
  update public.social_provider_assets set active=false, selected=false, last_seen_at=v_now
  where connection_id=p_connection_id and district_id=p_district_id;
  update public.social_provider_account_links set active=false, updated_at=v_now
  where district_id=p_district_id and provider_asset_id in (
    select id from public.social_provider_assets where connection_id=p_connection_id and district_id=p_district_id
  );
  update public.social_accounts s set active=false, connection_status='disconnected', updated_at=v_now
  where s.district_id=p_district_id and s.provider='meta'
    and not exists (select 1 from public.social_provider_account_links l where l.social_account_id=s.id and l.active);
  delete from public.social_provider_credentials where connection_id=p_connection_id and district_id=p_district_id;
  return true;
end;
$$;

-- Provider-confirmed deletion takes the same district lifecycle locks and removes
-- pending attempts through the connection FK cascade before recording confirmation.
create or replace function public.canary_complete_meta_data_deletion(
  p_provider_user_id text,
  p_provider_user_id_hash text,
  p_confirmation_code text
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  deleted_count integer := 0;
  v_district_id text;
begin
  if coalesce(p_provider_user_id,'')='' or coalesce(p_provider_user_id_hash,'')='' or coalesce(p_confirmation_code,'')='' then
    raise exception 'Meta deletion parameters are required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('canary-meta-provider-user:' || p_provider_user_id_hash, 0));

  for v_district_id in
    select district_id from public.social_provider_connections
    where provider='meta' and provider_user_id=p_provider_user_id
    order by district_id
  loop
    perform pg_advisory_xact_lock(hashtextextended('canary-meta-oauth:' || v_district_id, 0));
  end loop;

  delete from public.social_threads t
  where t.provider='meta' and exists (
    select 1 from public.social_provider_account_links l
    join public.social_provider_assets a on a.id=l.provider_asset_id and a.district_id=l.district_id
    join public.social_provider_connections c on c.id=a.connection_id and c.district_id=a.district_id
    where l.social_account_id=t.social_account_id and c.provider='meta' and c.provider_user_id=p_provider_user_id
  );
  delete from public.social_accounts s
  where s.provider='meta' and exists (
    select 1 from public.social_provider_account_links l
    join public.social_provider_assets a on a.id=l.provider_asset_id and a.district_id=l.district_id
    join public.social_provider_connections c on c.id=a.connection_id and c.district_id=a.district_id
    where l.social_account_id=s.id and c.provider='meta' and c.provider_user_id=p_provider_user_id
  );
  delete from public.social_provider_connections where provider='meta' and provider_user_id=p_provider_user_id;
  get diagnostics deleted_count=row_count;
  insert into public.social_provider_deletion_requests(confirmation_code,provider,provider_user_id_hash,status,completed_at,detail)
  values (p_confirmation_code,'meta',p_provider_user_id_hash,'completed',clock_timestamp(),format('Deleted %s Meta connection%s.',deleted_count,case when deleted_count=1 then '' else 's' end));
  return deleted_count;
end;
$$;

revoke all on function public.canary_consume_meta_oauth_state(text, uuid, text) from public, anon, authenticated;
revoke all on function public.canary_prepare_meta_connection(uuid, text, uuid, text, text, text, text, uuid, bigint) from public, anon, authenticated;
revoke all on function public.canary_abandon_meta_connection_attempt(uuid, text) from public, anon, authenticated;
revoke all on function public.canary_finalize_meta_connection(uuid, uuid, text, uuid, text, text, text, text, text, timestamptz, text[], text[], text, integer, jsonb) from public, anon, authenticated;
revoke all on function public.canary_disconnect_meta_connection(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.canary_complete_meta_data_deletion(text, text, text) from public, anon, authenticated;
grant execute on function public.canary_consume_meta_oauth_state(text, uuid, text) to service_role;
grant execute on function public.canary_prepare_meta_connection(uuid, text, uuid, text, text, text, text, uuid, bigint) to service_role;
grant execute on function public.canary_abandon_meta_connection_attempt(uuid, text) to service_role;
grant execute on function public.canary_finalize_meta_connection(uuid, uuid, text, uuid, text, text, text, text, text, timestamptz, text[], text[], text, integer, jsonb) to service_role;
grant execute on function public.canary_disconnect_meta_connection(uuid, text, boolean) to service_role;
grant execute on function public.canary_complete_meta_data_deletion(text, text, text) to service_role;

commit;

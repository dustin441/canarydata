-- Persist Meta's separate data-access deadline and lifecycle-safe permission health.
-- Apply after 20260818190000_meta_oauth_attempt_lifecycle.sql.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '5min';

alter table public.social_provider_connections
  add column if not exists data_access_expires_at timestamptz;

alter table public.social_provider_deletion_requests
  add column if not exists signed_request_hash text,
  add column if not exists issued_at timestamptz;

create unique index if not exists social_provider_deletion_requests_signed_request_key
  on public.social_provider_deletion_requests (signed_request_hash)
  where signed_request_hash is not null;

create or replace function public.canary_finalize_meta_connection_v2(
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
  p_data_access_expires_at timestamptz,
  p_granted_scopes text[],
  p_declined_scopes text[],
  p_encrypted_access_token text,
  p_key_version integer,
  p_assets jsonb
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_connection_id uuid;
begin
  v_connection_id := public.canary_finalize_meta_connection(
    p_attempt_id,
    p_connection_id,
    p_district_id,
    p_connected_by,
    p_provider_app_id,
    p_provider_user_id,
    p_provider_user_id_hash,
    p_provider_user_name,
    p_status,
    p_token_expires_at,
    p_granted_scopes,
    p_declined_scopes,
    p_encrypted_access_token,
    p_key_version,
    p_assets
  );

  update public.social_provider_connections
  set data_access_expires_at = p_data_access_expires_at,
      updated_at = now()
  where id = v_connection_id
    and district_id = p_district_id
    and provider = 'meta'
    and status in ('active','needs_permissions');
  if not found then raise exception 'Finalized Meta connection health could not be persisted'; end if;

  -- Rediscovery intentionally clears every prior selection. Canonical links and
  -- accounts must become inactive in the same transaction instead of waiting
  -- for a later synchronization that may never run.
  update public.social_provider_account_links l
  set active = false, updated_at = now()
  where l.district_id = p_district_id and l.provider = 'meta'
    and l.provider_asset_id in (
      select id from public.social_provider_assets
      where connection_id = v_connection_id and district_id = p_district_id
    );
  update public.social_accounts s
  set active = false, connection_status = 'disconnected', updated_at = now()
  where s.district_id = p_district_id and s.provider = 'meta'
    and not exists (
      select 1 from public.social_provider_account_links l
      where l.social_account_id = s.id and l.active
    );

  return v_connection_id;
end;
$$;

create or replace function public.canary_update_meta_connection_health(
  p_connection_id uuid,
  p_district_id text,
  p_expected_status text,
  p_status text,
  p_token_expires_at timestamptz,
  p_data_access_expires_at timestamptz,
  p_granted_scopes text[],
  p_declined_scopes text[],
  p_validated_at timestamptz,
  p_error_code text,
  p_error_message text
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_status not in ('active','needs_permissions','expired','error') then
    raise exception 'Invalid Meta health status';
  end if;
  if p_expected_status not in ('pending','active','needs_permissions','expired','error') then
    raise exception 'Invalid expected Meta health status';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('canary-meta-oauth:' || p_district_id, 0));
  update public.social_provider_connections
  set status = p_status,
      token_expires_at = coalesce(p_token_expires_at, token_expires_at),
      data_access_expires_at = coalesce(p_data_access_expires_at, data_access_expires_at),
      granted_scopes = coalesce(p_granted_scopes, granted_scopes),
      declined_scopes = coalesce(p_declined_scopes, declined_scopes),
      last_validated_at = coalesce(p_validated_at, last_validated_at),
      last_error_code = p_error_code,
      last_error_message = case when p_error_message is null then null else left(p_error_message, 300) end,
      updated_at = now(),
      lifecycle_version = lifecycle_version + 1
  where id = p_connection_id
    and district_id = p_district_id
    and provider = 'meta'
    and status = p_expected_status
    and status <> 'revoked';
  return found;
end;
$$;

-- Application code moves to the deadline-aware finalizer after this additive
-- migration is verified. The legacy grant is revoked only in the cutover migration.
revoke all on function public.canary_finalize_meta_connection_v2(uuid, uuid, text, uuid, text, text, text, text, text, timestamptz, timestamptz, text[], text[], text, integer, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.canary_update_meta_connection_health(uuid, text, text, text, timestamptz, timestamptz, text[], text[], timestamptz, text, text) from public, anon, authenticated, service_role;
grant execute on function public.canary_finalize_meta_connection_v2(uuid, uuid, text, uuid, text, text, text, text, text, timestamptz, timestamptz, text[], text[], text, integer, jsonb) to service_role;
grant execute on function public.canary_update_meta_connection_health(uuid, text, text, text, timestamptz, timestamptz, text[], text[], timestamptz, text, text) to service_role;

commit;

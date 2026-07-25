-- Canary Meta read-only integration
-- Apply with the Canary production database migration process before enabling OAuth.

begin;

create extension if not exists pgcrypto;

create table if not exists public.social_provider_oauth_states (
  state_hash text primary key,
  provider text not null check (provider = 'meta'),
  user_id uuid not null references auth.users(id) on delete cascade,
  district_id text not null references public.districts(id) on delete cascade,
  return_path text not null default '/dashboard/integrations',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create index if not exists social_provider_oauth_states_expiry_idx
  on public.social_provider_oauth_states (expires_at);

create or replace function public.canary_consume_meta_oauth_state(
  p_state_hash text,
  p_user_id uuid,
  p_district_id text
)
returns table (return_path text)
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
  returning social_provider_oauth_states.return_path;
$$;

revoke all on function public.canary_consume_meta_oauth_state(text, uuid, text) from public, anon, authenticated;
grant execute on function public.canary_consume_meta_oauth_state(text, uuid, text) to service_role;

create table if not exists public.social_provider_connections (
  id uuid primary key default gen_random_uuid(),
  district_id text not null references public.districts(id) on delete cascade,
  provider text not null check (provider = 'meta'),
  provider_app_id text not null,
  provider_user_id text not null,
  provider_user_name text,
  status text not null default 'pending' check (status in ('pending','active','needs_permissions','expired','revoked','error')),
  token_expires_at timestamptz,
  granted_scopes text[] not null default '{}',
  declined_scopes text[] not null default '{}',
  connected_by uuid references auth.users(id) on delete set null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_validated_at timestamptz,
  last_error_code text,
  last_error_message text,
  revoked_at timestamptz,
  unique (id, district_id),
  unique (district_id, provider)
);

create index if not exists social_provider_connections_district_idx
  on public.social_provider_connections (district_id, provider, status);

create or replace function public.canary_prepare_meta_connection(
  p_district_id text,
  p_connected_by uuid,
  p_provider_app_id text,
  p_provider_user_id text,
  p_provider_user_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_connection_id uuid;
begin
  if p_provider_app_id is null or p_provider_app_id = '' then
    raise exception 'Meta application ID is required';
  end if;

  insert into public.social_provider_connections (
    district_id, provider, provider_app_id, provider_user_id, provider_user_name, status, connected_by
  ) values (
    p_district_id, 'meta', p_provider_app_id, p_provider_user_id, p_provider_user_name, 'pending', p_connected_by
  )
  on conflict (district_id, provider) do nothing
  returning id into v_connection_id;

  if v_connection_id is null then
    select id into v_connection_id
    from public.social_provider_connections
    where district_id = p_district_id and provider = 'meta'
    for update;
  end if;

  return v_connection_id;
end;
$$;

revoke all on function public.canary_prepare_meta_connection(text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.canary_prepare_meta_connection(text, uuid, text, text, text) to service_role;

create table if not exists public.social_provider_credentials (
  connection_id uuid primary key,
  district_id text not null references public.districts(id) on delete cascade,
  encrypted_access_token text not null,
  key_version smallint not null default 1,
  updated_at timestamptz not null default now(),
  foreign key (connection_id, district_id) references public.social_provider_connections(id, district_id) on delete cascade
);

create table if not exists public.social_provider_assets (
  id uuid primary key default gen_random_uuid(),
  district_id text not null references public.districts(id) on delete cascade,
  connection_id uuid not null,
  provider_asset_id text not null,
  asset_type text not null check (asset_type in ('facebook_page','instagram_account','ad_account')),
  platform text not null check (platform in ('facebook','instagram','meta_ads')),
  name text not null,
  handle text,
  profile_url text,
  parent_provider_asset_id text,
  selected boolean not null default false,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  discovered_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (id, district_id),
  foreign key (connection_id, district_id) references public.social_provider_connections(id, district_id) on delete cascade,
  unique (connection_id, asset_type, provider_asset_id),
  unique (district_id, asset_type, provider_asset_id)
);

create index if not exists social_provider_assets_connection_idx
  on public.social_provider_assets (connection_id, asset_type, selected);

create table if not exists public.social_account_mappings (
  id uuid primary key default gen_random_uuid(),
  district_id text not null references public.districts(id) on delete cascade,
  provider_asset_id uuid not null unique,
  scope_type text not null default 'district' check (scope_type = 'district'),
  scope_label text not null,
  reporting_enabled boolean not null default true,
  mapped_by uuid references auth.users(id) on delete set null,
  mapped_at timestamptz not null default now(),
  foreign key (provider_asset_id, district_id) references public.social_provider_assets(id, district_id) on delete cascade
);

create or replace function public.canary_replace_meta_asset_mappings(
  p_district_id text,
  p_asset_ids uuid[],
  p_mapped_by uuid,
  p_scope_label text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_count integer;
begin
  if p_scope_label is null or btrim(p_scope_label) = '' then
    raise exception 'Scope label is required';
  end if;

  update public.social_provider_assets
  set selected = false
  where district_id = p_district_id;

  delete from public.social_account_mappings
  where district_id = p_district_id;

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
  where district_id = p_district_id
    and selected = true;

  return selected_count;
end;
$$;

revoke all on function public.canary_replace_meta_asset_mappings(text, uuid[], uuid, text) from public, anon, authenticated;
grant execute on function public.canary_replace_meta_asset_mappings(text, uuid[], uuid, text) to service_role;

create or replace function public.canary_finalize_meta_connection(
  p_connection_id uuid,
  p_district_id text,
  p_connected_by uuid,
  p_provider_app_id text,
  p_provider_user_id text,
  p_provider_user_name text,
  p_status text,
  p_token_expires_at timestamptz,
  p_granted_scopes text[],
  p_declined_scopes text[],
  p_encrypted_access_token text,
  p_key_version smallint,
  p_assets jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_asset_count integer;
begin
  if p_provider_app_id is null or p_provider_app_id = '' then
    raise exception 'Meta application ID is required';
  end if;
  if p_status not in ('active', 'needs_permissions') then
    raise exception 'Invalid Meta connection status';
  end if;
  if p_encrypted_access_token is null or p_encrypted_access_token = '' then
    raise exception 'Encrypted Meta credential is required';
  end if;
  if jsonb_typeof(coalesce(p_assets, '[]'::jsonb)) <> 'array' then
    raise exception 'Meta assets must be an array';
  end if;
  v_asset_count := jsonb_array_length(coalesce(p_assets, '[]'::jsonb));
  if v_asset_count > 500 then
    raise exception 'Too many Meta assets';
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
      revoked_at = null
  where id = p_connection_id
    and district_id = p_district_id
    and provider = 'meta';
  if not found then
    raise exception 'Meta connection does not belong to this district';
  end if;

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

  return p_connection_id;
end;
$$;

revoke all on function public.canary_finalize_meta_connection(uuid, text, uuid, text, text, text, text, timestamptz, text[], text[], text, smallint, jsonb) from public, anon, authenticated;
grant execute on function public.canary_finalize_meta_connection(uuid, text, uuid, text, text, text, text, timestamptz, text[], text[], text, smallint, jsonb) to service_role;

create or replace function public.canary_disconnect_meta_connection(
  p_connection_id uuid,
  p_district_id text,
  p_revocation_unconfirmed boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
begin
  if not exists (
    select 1 from public.social_provider_connections
    where id = p_connection_id and district_id = p_district_id and provider = 'meta'
  ) then
    raise exception 'Meta connection does not belong to this district';
  end if;

  delete from public.social_account_mappings
  where district_id = p_district_id
    and provider_asset_id in (
      select id from public.social_provider_assets
      where connection_id = p_connection_id and district_id = p_district_id
    );

  update public.social_provider_assets
  set active = false, selected = false, last_seen_at = v_now
  where connection_id = p_connection_id and district_id = p_district_id;

  delete from public.social_provider_credentials
  where connection_id = p_connection_id and district_id = p_district_id;

  update public.social_provider_connections
  set status = 'revoked',
      revoked_at = v_now,
      updated_at = v_now,
      last_error_code = case when p_revocation_unconfirmed then 'remote_revocation_unconfirmed' else null end,
      last_error_message = case when p_revocation_unconfirmed then 'Local access was removed, but Meta revocation could not be confirmed.' else null end
  where id = p_connection_id and district_id = p_district_id and provider = 'meta';

  return true;
end;
$$;

revoke all on function public.canary_disconnect_meta_connection(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.canary_disconnect_meta_connection(uuid, text, boolean) to service_role;

create table if not exists public.social_sync_runs (
  id uuid primary key default gen_random_uuid(),
  district_id text not null references public.districts(id) on delete cascade,
  connection_id uuid not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null check (status in ('running','success','partial','failed')),
  accounts_attempted integer not null default 0,
  accounts_succeeded integer not null default 0,
  posts_read integer not null default 0,
  metric_rows_written integer not null default 0,
  error_summary jsonb not null default '{}'::jsonb,
  source_cutoff timestamptz,
  foreign key (connection_id, district_id) references public.social_provider_connections(id, district_id) on delete cascade
);

create table if not exists public.social_provider_deletion_requests (
  confirmation_code text primary key,
  provider text not null check (provider = 'meta'),
  provider_user_id_hash text not null,
  status text not null check (status in ('completed','failed')),
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  detail text
);

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
begin
  if coalesce(p_provider_user_id, '') = ''
    or coalesce(p_provider_user_id_hash, '') = ''
    or coalesce(p_confirmation_code, '') = '' then
    raise exception 'Meta deletion parameters are required';
  end if;

  delete from public.social_provider_connections
  where provider = 'meta'
    and provider_user_id = p_provider_user_id;
  get diagnostics deleted_count = row_count;

  insert into public.social_provider_deletion_requests (
    confirmation_code,
    provider,
    provider_user_id_hash,
    status,
    completed_at,
    detail
  ) values (
    p_confirmation_code,
    'meta',
    p_provider_user_id_hash,
    'completed',
    now(),
    format('Deleted %s Meta connection%s.', deleted_count, case when deleted_count = 1 then '' else 's' end)
  );

  return deleted_count;
end;
$$;

revoke all on function public.canary_complete_meta_data_deletion(text, text, text) from public, anon, authenticated;
grant execute on function public.canary_complete_meta_data_deletion(text, text, text) to service_role;

alter table public.social_provider_oauth_states enable row level security;
alter table public.social_provider_connections enable row level security;
alter table public.social_provider_credentials enable row level security;
alter table public.social_provider_assets enable row level security;
alter table public.social_account_mappings enable row level security;
alter table public.social_sync_runs enable row level security;
alter table public.social_provider_deletion_requests enable row level security;

-- No authenticated/browser policies are intentionally defined. Meta credentials and
-- mapping metadata are accessed only by server routes using the service role after
-- protected app_metadata authorization and explicit district filters.
revoke all on public.social_provider_oauth_states from anon, authenticated;
revoke all on public.social_provider_connections from anon, authenticated;
revoke all on public.social_provider_credentials from anon, authenticated;
revoke all on public.social_provider_assets from anon, authenticated;
revoke all on public.social_account_mappings from anon, authenticated;
revoke all on public.social_sync_runs from anon, authenticated;
revoke all on public.social_provider_deletion_requests from anon, authenticated;

commit;

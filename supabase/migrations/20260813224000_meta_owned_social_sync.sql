-- Additive Meta owned-Social convergence boundary.
-- REVIEW/APPLY before enabling META_NATIVE_SYNC_ENABLED.
-- One canonical social_account may have multiple provider-specific authorization links.

begin;
set local lock_timeout = '10s';
set local statement_timeout = '5min';

create table public.social_provider_account_links (
  id uuid primary key default gen_random_uuid(),
  district_id text not null references public.districts(id) on delete cascade,
  social_account_id uuid not null,
  provider_asset_id uuid not null,
  provider text not null check (provider = 'meta'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, district_id),
  unique (provider_asset_id),
  foreign key (social_account_id, district_id) references public.social_accounts(id, district_id) on delete cascade,
  foreign key (provider_asset_id, district_id) references public.social_provider_assets(id, district_id) on delete cascade
);

create index social_provider_account_links_account_idx
  on public.social_provider_account_links (district_id, social_account_id, provider, active);

create table public.social_thread_provider_observations (
  id uuid primary key default gen_random_uuid(),
  district_id text not null references public.districts(id) on delete cascade,
  social_thread_id uuid not null,
  provider_account_link_id uuid not null,
  provider text not null check (provider = 'meta'),
  provider_external_thread_id text not null,
  canonical_url text not null,
  observed_at timestamptz not null default now(),
  provider_metadata jsonb not null default '{}'::jsonb,
  unique (provider_account_link_id, provider_external_thread_id),
  foreign key (provider_account_link_id, district_id) references public.social_provider_account_links(id, district_id) on delete cascade,
  foreign key (social_thread_id, district_id) references public.social_threads(id, district_id) on delete cascade
);

create index social_thread_provider_observations_thread_idx
  on public.social_thread_provider_observations (district_id, social_thread_id, provider);

alter table public.social_sync_runs
  add column if not exists provider_errors integer not null default 0,
  add column if not exists rejected_items integer not null default 0,
  add column if not exists duplicate_items integer not null default 0,
  add column if not exists next_cursor jsonb,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists heartbeat_at timestamptz,
  add column if not exists diagnostics jsonb not null default '{}'::jsonb;

alter table public.social_sync_runs drop constraint if exists social_sync_runs_status_check;
alter table public.social_sync_runs add constraint social_sync_runs_status_check
  check (status in ('running','success','empty','partial','failed'));

create unique index social_sync_runs_one_running_connection_uidx
  on public.social_sync_runs (connection_id)
  where status = 'running';

create or replace function public.canary_claim_meta_sync_run(
  p_district_id text,
  p_connection_id uuid,
  p_accounts_attempted integer,
  p_source_cutoff timestamptz,
  p_diagnostics jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_run_id uuid;
begin
  perform 1 from public.social_provider_connections
  where id=p_connection_id and district_id=p_district_id and provider='meta'
    and status in ('active','needs_permissions') for update;
  if not found then raise exception 'Authorized Meta connection is required'; end if;

  update public.social_sync_runs
  set status='failed', completed_at=now(), provider_errors=greatest(provider_errors,1),
      error_summary=jsonb_build_object('code','LEASE_EXPIRED','message','The previous native Meta sync lease expired before completion.'),
      diagnostics=diagnostics || jsonb_build_object('recovered_at',now())
  where connection_id=p_connection_id and district_id=p_district_id and status='running'
    and coalesce(lease_expires_at, started_at + interval '2 minutes') <= now();

  if exists (select 1 from public.social_sync_runs where connection_id=p_connection_id and district_id=p_district_id and status='running') then
    raise exception 'A native Meta synchronization is already running';
  end if;

  insert into public.social_sync_runs(district_id,connection_id,status,accounts_attempted,source_cutoff,diagnostics,heartbeat_at,lease_expires_at)
  values (p_district_id,p_connection_id,'running',p_accounts_attempted,p_source_cutoff,coalesce(p_diagnostics,'{}'::jsonb),now(),now()+interval '2 minutes')
  returning id into v_run_id;
  return v_run_id;
end;
$$;

create or replace function public.canary_link_selected_meta_assets(
  p_district_id text,
  p_connection_id uuid
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_linked integer := 0;
begin
  perform 1 from public.social_provider_connections c
  where c.id = p_connection_id and c.district_id = p_district_id
    and c.provider = 'meta' and c.status in ('active','needs_permissions')
  for update;
  if not found then raise exception 'Active Meta connection does not belong to this district'; end if;

  insert into public.social_accounts (
    district_id, platform, provider, platform_account_id, handle, display_name, profile_url,
    authorization_mode, connection_status, credential_reference, granted_scopes, active, connected_at, metadata
  )
  select
    a.district_id, a.platform, 'meta', a.provider_asset_id, a.handle, a.name, a.profile_url,
    'official', 'connected', p_connection_id::text, '[]'::jsonb, true, now(),
    jsonb_build_object('meta_provider_asset_id', a.id)
  from public.social_provider_assets a
  where a.district_id = p_district_id and a.connection_id = p_connection_id
    and a.selected and a.active and a.asset_type in ('facebook_page','instagram_account')
    and not exists (
      select 1 from public.social_accounts s
      where s.district_id = a.district_id and s.platform = a.platform
        and (s.platform_account_id = a.provider_asset_id
          or (a.handle is not null and lower(regexp_replace(btrim(s.handle), '^@+', '')) = lower(regexp_replace(btrim(a.handle), '^@+', ''))))
    );

  insert into public.social_provider_account_links (
    district_id, social_account_id, provider_asset_id, provider, active
  )
  select a.district_id, s.id, a.id, 'meta', true
  from public.social_provider_assets a
  join lateral (
    select candidate.id
    from public.social_accounts candidate
    where candidate.district_id = a.district_id and candidate.platform = a.platform
      and (candidate.platform_account_id = a.provider_asset_id
        or (a.handle is not null and lower(regexp_replace(btrim(candidate.handle), '^@+', '')) = lower(regexp_replace(btrim(a.handle), '^@+', ''))))
    order by (candidate.platform_account_id = a.provider_asset_id) desc, candidate.id
    limit 1
  ) s on true
  where a.district_id = p_district_id and a.connection_id = p_connection_id
    and a.selected and a.active and a.asset_type in ('facebook_page','instagram_account')
  on conflict (provider_asset_id) do update
    set social_account_id = excluded.social_account_id, active = true, updated_at = now();
  get diagnostics v_linked = row_count;

  update public.social_provider_account_links l
  set active = false, updated_at = now()
  where l.district_id = p_district_id and l.provider = 'meta'
    and l.provider_asset_id in (select id from public.social_provider_assets where connection_id = p_connection_id)
    and not exists (select 1 from public.social_provider_assets a where a.id = l.provider_asset_id and a.selected and a.active);

  update public.social_accounts s set active = false, connection_status = 'disconnected', updated_at = now()
  where s.district_id = p_district_id and s.provider = 'meta'
    and not exists (select 1 from public.social_provider_account_links l where l.social_account_id = s.id and l.active);

  return v_linked;
end;
$$;

create or replace function public.canary_ingest_owned_social_observation(
  p_provider_account_link_id uuid,
  p_thread jsonb
) returns public.social_threads
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link public.social_provider_account_links%rowtype;
  v_asset public.social_provider_assets%rowtype;
  v_connection public.social_provider_connections%rowtype;
  v_thread public.social_threads%rowtype;
  v_existing public.social_threads%rowtype;
begin
  select * into v_link from public.social_provider_account_links
  where id = p_provider_account_link_id and provider = 'meta' and active;
  if not found then raise exception 'Active Meta provider-account link is required'; end if;
  select * into v_asset from public.social_provider_assets
  where id = v_link.provider_asset_id and district_id = v_link.district_id and selected and active;
  if not found then raise exception 'Selected active Meta asset is required'; end if;
  select * into v_connection from public.social_provider_connections
  where id = v_asset.connection_id and district_id = v_asset.district_id and provider = 'meta'
    and status in ('active','needs_permissions') for update;
  if not found then raise exception 'Active Meta connection is required'; end if;
  select * into v_asset from public.social_provider_assets
  where id = v_link.provider_asset_id and district_id = v_link.district_id and selected and active for update;
  if not found then raise exception 'Selected active Meta asset is required'; end if;
  select * into v_link from public.social_provider_account_links
  where id = p_provider_account_link_id and provider = 'meta' and active for update;
  if not found then raise exception 'Active Meta provider-account link is required'; end if;

  v_thread := jsonb_populate_record(null::public.social_threads, p_thread);
  if v_thread.district_id <> v_link.district_id or v_thread.social_account_id <> v_link.social_account_id
    or v_thread.provider <> 'meta' or v_thread.relationship_type <> 'owned'
    or v_thread.platform <> v_asset.platform then
    raise exception 'Meta owned-Social observation does not match its tenant-bound provider link';
  end if;

  select * into v_existing from public.social_threads
  where district_id = v_thread.district_id and platform = v_thread.platform
    and external_thread_id = v_thread.external_thread_id for update;

  if found then
    if v_existing.social_account_id is not null and v_existing.social_account_id <> v_link.social_account_id then
      raise exception 'Canonical Social account reassignment is not allowed';
    end if;
    update public.social_threads set
      social_account_id = coalesce(social_threads.social_account_id, v_link.social_account_id),
      canonical_url = v_thread.canonical_url,
      author_name = v_thread.author_name, author_handle = v_thread.author_handle,
      headline = v_thread.headline, body = v_thread.body, published_at = v_thread.published_at,
      last_seen_at = coalesce(v_thread.last_seen_at, now()),
      comment_count = coalesce(v_thread.comment_count, 0), reaction_count = coalesce(v_thread.reaction_count, 0),
      share_count = coalesce(v_thread.share_count, 0), engagement_total = coalesce(v_thread.engagement_total, 0),
      provider_metadata = social_threads.provider_metadata || jsonb_build_object('meta_last_observed_at', now()),
      updated_at = now()
    where id = v_existing.id returning * into v_thread;
  else
    select * into v_thread from public.canary_ingest_social_thread(p_thread);
  end if;

  insert into public.social_thread_provider_observations (
    district_id, social_thread_id, provider_account_link_id, provider,
    provider_external_thread_id, canonical_url, observed_at, provider_metadata
  ) values (
    v_link.district_id, v_thread.id, v_link.id, 'meta', v_thread.external_thread_id,
    v_thread.canonical_url, now(), coalesce(p_thread->'provider_metadata','{}'::jsonb)
  ) on conflict (provider_account_link_id, provider_external_thread_id) do update
    set social_thread_id = excluded.social_thread_id, canonical_url = excluded.canonical_url,
        observed_at = excluded.observed_at, provider_metadata = excluded.provider_metadata;
  return v_thread;
end;
$$;

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
  update public.social_provider_connections
  set status='revoked', revoked_at=v_now, updated_at=v_now,
      last_error_code=case when p_revocation_unconfirmed then 'remote_revocation_unconfirmed' else null end,
      last_error_message=case when p_revocation_unconfirmed then 'Local access was removed, but Meta revocation could not be confirmed.' else null end
  where id=p_connection_id and district_id=p_district_id and provider='meta'
    and status in ('pending','active','needs_permissions','expired','error');
  if not found and not exists (
    select 1 from public.social_provider_connections where id=p_connection_id and district_id=p_district_id and provider='meta' and status='revoked'
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

create or replace function public.canary_complete_meta_data_deletion(
  p_provider_user_id text,
  p_provider_user_id_hash text,
  p_confirmation_code text
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare deleted_count integer := 0;
begin
  if coalesce(p_provider_user_id,'')='' or coalesce(p_provider_user_id_hash,'')='' or coalesce(p_confirmation_code,'')='' then
    raise exception 'Meta deletion parameters are required';
  end if;
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
  values (p_confirmation_code,'meta',p_provider_user_id_hash,'completed',now(),format('Deleted %s Meta connection%s.',deleted_count,case when deleted_count=1 then '' else 's' end));
  return deleted_count;
end;
$$;

alter table public.social_provider_account_links enable row level security;
alter table public.social_thread_provider_observations enable row level security;
revoke all on public.social_provider_account_links, public.social_thread_provider_observations from anon, authenticated;
revoke all on function public.canary_claim_meta_sync_run(text, uuid, integer, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.canary_link_selected_meta_assets(text, uuid) from public, anon, authenticated;
revoke all on function public.canary_ingest_owned_social_observation(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.canary_disconnect_meta_connection(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.canary_complete_meta_data_deletion(text, text, text) from public, anon, authenticated;
grant execute on function public.canary_claim_meta_sync_run(text, uuid, integer, timestamptz, jsonb) to service_role;
grant execute on function public.canary_link_selected_meta_assets(text, uuid) to service_role;
grant execute on function public.canary_ingest_owned_social_observation(uuid, jsonb) to service_role;
grant execute on function public.canary_disconnect_meta_connection(uuid, text, boolean) to service_role;
grant execute on function public.canary_complete_meta_data_deletion(text, text, text) to service_role;

commit;

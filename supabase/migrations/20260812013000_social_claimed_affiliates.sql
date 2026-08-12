-- REVIEW-ONLY: district-claimed affiliate identity foundation.
-- Affiliate identity is orthogonal to a post's relationship_type.
-- Do not apply until Canary target verification, backup, fixture QA, and rollback rehearsal pass.

begin;

alter table public.social_accounts
  add constraint social_accounts_id_district_key unique (id, district_id);

create unique index social_accounts_normalized_handle_uidx
  on public.social_accounts (district_id, platform, lower(regexp_replace(btrim(handle), '^@+', '')))
  where handle is not null and lower(regexp_replace(btrim(handle), '^@+', '')) <> '';

create table public.social_affiliate_claims (
  id uuid primary key default gen_random_uuid(),
  district_id text not null references public.districts(id) on delete restrict,
  social_account_id uuid not null,
  affiliate_type text not null check (affiliate_type in ('school','athletics','fine_arts','cte','club','booster','foundation','pto_pta','program','other')),
  relationship_label text not null check (char_length(btrim(relationship_label)) between 1 and 120),
  verification_source text not null check (verification_source in ('district','canary_admin','official_website')),
  verification_note text check (verification_note is null or char_length(verification_note) <= 2000),
  status text not null default 'active' check (status in ('active','revoked')),
  claimed_by uuid not null,
  claimed_at timestamptz not null default now(),
  verified_by uuid not null,
  verified_at timestamptz not null default now(),
  revoked_by uuid,
  revoked_at timestamptz,
  revocation_reason text check (revocation_reason is null or char_length(revocation_reason) <= 1000),
  claim_version integer not null default 1 check (claim_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (social_account_id, district_id)
    references public.social_accounts(id, district_id) on delete restrict,
  unique (id, district_id),
  check (
    (status = 'active' and revoked_by is null and revoked_at is null and revocation_reason is null)
    or (status = 'revoked' and revoked_by is not null and revoked_at is not null and revocation_reason is not null)
  )
);

create unique index social_affiliate_claims_active_account_uidx
  on public.social_affiliate_claims (district_id, social_account_id)
  where status = 'active';

create index social_affiliate_claims_district_status_idx
  on public.social_affiliate_claims (district_id, status, affiliate_type, relationship_label);

create table public.social_affiliate_claim_events (
  id uuid primary key default gen_random_uuid(),
  affiliate_claim_id uuid not null,
  district_id text not null references public.districts(id) on delete restrict,
  actor_user_id uuid not null,
  action text not null check (action in ('claim','revoke')),
  before_state jsonb,
  after_state jsonb not null,
  resulting_version integer not null check (resulting_version > 0),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  request_fingerprint text not null check (char_length(request_fingerprint) = 32),
  created_at timestamptz not null default now(),
  foreign key (affiliate_claim_id, district_id)
    references public.social_affiliate_claims(id, district_id) on delete restrict,
  unique (district_id, idempotency_key)
);

create index social_affiliate_claim_events_claim_idx
  on public.social_affiliate_claim_events (affiliate_claim_id, resulting_version desc);

alter table public.social_threads add column affiliate_claim_id uuid;
alter table public.social_threads
  add constraint social_threads_affiliate_claim_district_fkey
  foreign key (affiliate_claim_id, district_id)
  references public.social_affiliate_claims(id, district_id) on delete restrict;
create index social_threads_affiliate_claim_idx
  on public.social_threads (district_id, affiliate_claim_id, published_at desc)
  where affiliate_claim_id is not null;

create or replace function public.prevent_social_affiliate_claim_event_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'Social affiliate claim audit events are immutable';
end;
$$;

create trigger social_affiliate_claim_events_immutable
before update or delete on public.social_affiliate_claim_events
for each row execute function public.prevent_social_affiliate_claim_event_mutation();

create or replace function public.canary_claim_social_affiliate(
  p_actor_user_id uuid,
  p_district_id text,
  p_social_account_id uuid,
  p_affiliate_type text,
  p_relationship_label text,
  p_verification_source text,
  p_verification_note text,
  p_idempotency_key text
)
returns public.social_affiliate_claims
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_account public.social_accounts;
  v_claim public.social_affiliate_claims;
  v_event public.social_affiliate_claim_events;
  v_fingerprint text := md5(jsonb_build_array(
    'claim', p_actor_user_id::text, p_district_id, p_social_account_id::text,
    p_affiliate_type, btrim(p_relationship_label), p_verification_source,
    coalesce(nullif(btrim(p_verification_note), ''), '')
  )::text);
begin
  perform public.canary_assert_social_reviewer(p_actor_user_id);
  if p_district_id is null or btrim(p_district_id) = '' then raise exception 'District is required'; end if;
  if p_social_account_id is null then raise exception 'Exact Social account is required'; end if;
  if p_idempotency_key is null or char_length(btrim(p_idempotency_key)) < 8 then raise exception 'Valid idempotency key is required'; end if;

  perform pg_advisory_xact_lock(hashtextextended(concat_ws('|', 'affiliate-idempotency', p_district_id, btrim(p_idempotency_key)), 0));
  select * into v_event from public.social_affiliate_claim_events
  where district_id = p_district_id and idempotency_key = btrim(p_idempotency_key);
  if found then
    if v_event.action <> 'claim' or v_event.actor_user_id <> p_actor_user_id or v_event.request_fingerprint <> v_fingerprint then
      raise exception 'Idempotency key was already used for a different affiliate operation';
    end if;
    select * into v_claim from jsonb_populate_record(null::public.social_affiliate_claims, v_event.after_state);
    return v_claim;
  end if;

  select * into v_account from public.social_accounts
  where id = p_social_account_id and district_id = p_district_id and active = true;
  if not found then raise exception 'Active Social account not found for this district'; end if;
  if v_account.platform_account_id is null and nullif(lower(regexp_replace(coalesce(v_account.handle, ''), '^@+', '')), '') is null then
    raise exception 'Social account lacks an exact provider account ID or normalized handle';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(concat_ws('|', 'affiliate-account', p_district_id, p_social_account_id::text), 0));
  if exists (select 1 from public.social_affiliate_claims where district_id = p_district_id and social_account_id = p_social_account_id and status = 'active') then
    raise exception 'An active affiliate claim already exists for this account';
  end if;

  insert into public.social_affiliate_claims (
    district_id, social_account_id, affiliate_type, relationship_label,
    verification_source, verification_note, claimed_by, verified_by
  ) values (
    p_district_id, p_social_account_id, p_affiliate_type, btrim(p_relationship_label),
    p_verification_source, nullif(btrim(p_verification_note), ''), p_actor_user_id, p_actor_user_id
  ) returning * into v_claim;

  insert into public.social_affiliate_claim_events (
    affiliate_claim_id, district_id, actor_user_id, action, before_state,
    after_state, resulting_version, idempotency_key, request_fingerprint
  ) values (
    v_claim.id, v_claim.district_id, p_actor_user_id, 'claim', null,
    to_jsonb(v_claim), v_claim.claim_version, btrim(p_idempotency_key), v_fingerprint
  );
  return v_claim;
end;
$$;

create or replace function public.canary_revoke_social_affiliate(
  p_actor_user_id uuid,
  p_district_id text,
  p_affiliate_claim_id uuid,
  p_expected_version integer,
  p_revocation_reason text,
  p_idempotency_key text
)
returns public.social_affiliate_claims
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_before public.social_affiliate_claims;
  v_after public.social_affiliate_claims;
  v_event public.social_affiliate_claim_events;
  v_fingerprint text := md5(jsonb_build_array(
    'revoke', p_actor_user_id::text, p_district_id, p_affiliate_claim_id::text,
    p_expected_version, btrim(p_revocation_reason)
  )::text);
begin
  perform public.canary_assert_social_reviewer(p_actor_user_id);
  if p_idempotency_key is null or char_length(btrim(p_idempotency_key)) < 8 then raise exception 'Valid idempotency key is required'; end if;
  if p_revocation_reason is null or char_length(btrim(p_revocation_reason)) < 3 then raise exception 'Revocation reason is required'; end if;

  perform pg_advisory_xact_lock(hashtextextended(concat_ws('|', 'affiliate-idempotency', p_district_id, btrim(p_idempotency_key)), 0));
  select * into v_event from public.social_affiliate_claim_events
  where district_id = p_district_id and idempotency_key = btrim(p_idempotency_key);
  if found then
    if v_event.action <> 'revoke' or v_event.actor_user_id <> p_actor_user_id or v_event.request_fingerprint <> v_fingerprint then
      raise exception 'Idempotency key was already used for a different affiliate operation';
    end if;
    select * into v_after from jsonb_populate_record(null::public.social_affiliate_claims, v_event.after_state);
    return v_after;
  end if;

  select * into v_before from public.social_affiliate_claims
  where id = p_affiliate_claim_id and district_id = p_district_id for update;
  if not found then raise exception 'Affiliate claim not found'; end if;
  if v_before.status <> 'active' then raise exception 'Affiliate claim is not active'; end if;
  if v_before.claim_version <> p_expected_version then raise exception 'Affiliate claim changed; refresh and try again'; end if;

  update public.social_affiliate_claims
  set status = 'revoked', revoked_by = p_actor_user_id, revoked_at = now(),
      revocation_reason = btrim(p_revocation_reason), claim_version = claim_version + 1,
      updated_at = now()
  where id = v_before.id and claim_version = p_expected_version
  returning * into v_after;
  if not found then raise exception 'Affiliate claim changed; refresh and try again'; end if;

  insert into public.social_affiliate_claim_events (
    affiliate_claim_id, district_id, actor_user_id, action, before_state,
    after_state, resulting_version, idempotency_key, request_fingerprint
  ) values (
    v_after.id, v_after.district_id, p_actor_user_id, 'revoke', to_jsonb(v_before),
    to_jsonb(v_after), v_after.claim_version, btrim(p_idempotency_key), v_fingerprint
  );
  return v_after;
end;
$$;

alter table public.social_affiliate_claims enable row level security;
alter table public.social_affiliate_claim_events enable row level security;
revoke all on public.social_affiliate_claims, public.social_affiliate_claim_events from public, anon, authenticated;
revoke all on function public.canary_claim_social_affiliate(uuid,text,uuid,text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.canary_revoke_social_affiliate(uuid,text,uuid,integer,text,text) from public, anon, authenticated;
grant execute on function public.canary_claim_social_affiliate(uuid,text,uuid,text,text,text,text,text) to service_role;
grant execute on function public.canary_revoke_social_affiliate(uuid,text,uuid,integer,text,text) to service_role;

commit;

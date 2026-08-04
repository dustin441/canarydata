\set ON_ERROR_STOP on

create extension if not exists pgcrypto;

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;

create table auth.users (
  id uuid primary key,
  raw_app_meta_data jsonb not null default '{}'::jsonb
);

create table public.districts (
  id text primary key,
  name text not null
);

create table public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  district_id text not null references public.districts(id),
  platform text not null,
  provider text not null default 'manual',
  platform_account_id text,
  handle text,
  display_name text,
  profile_url text,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb
);

create table public.social_threads (
  id uuid primary key default gen_random_uuid(),
  district_id text not null references public.districts(id),
  social_account_id uuid references public.social_accounts(id) on delete set null,
  provider text not null,
  platform text not null check (platform in ('facebook','instagram','youtube','x','threads','tiktok','linkedin')),
  external_thread_id text not null,
  canonical_url text not null,
  relationship_type text not null check (relationship_type in ('owned','direct_tag','direct_mention','ambient')),
  author_name text,
  author_handle text,
  headline text,
  body text,
  summary text,
  recommendation text,
  published_at timestamptz not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  comment_count integer not null default 0 check (comment_count >= 0),
  reply_count integer not null default 0 check (reply_count >= 0),
  reaction_count integer not null default 0 check (reaction_count >= 0),
  share_count integer not null default 0 check (share_count >= 0),
  view_count bigint not null default 0 check (view_count >= 0),
  engagement_total bigint not null default 0 check (engagement_total >= 0),
  sentiment text,
  risk_level text,
  canary_score numeric,
  tags jsonb not null default '[]'::jsonb,
  strategic_alignment jsonb not null default '[]'::jsonb,
  matched_terms jsonb not null default '[]'::jsonb,
  match_reason text,
  identity_confidence numeric check (identity_confidence is null or identity_confidence between 0 and 1),
  visibility_status text not null default 'review' check (visibility_status in ('review','approved','active','excluded')),
  reviewer_note text check (reviewer_note is null or char_length(reviewer_note) <= 2000),
  review_version integer not null default 0,
  provider_metadata jsonb not null default '{}'::jsonb,
  reviewed_at timestamptz,
  reviewed_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (district_id, platform, external_thread_id)
);

create table public.social_review_batches (
  id uuid primary key default gen_random_uuid(),
  district_id text not null references public.districts(id) on delete restrict,
  action text not null check (action in ('approve','exclude','restore','classification','note','bulk_approve_official','promote')),
  actor_user_id uuid not null,
  item_count integer not null check (item_count > 0),
  criteria jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.social_review_events (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.social_review_batches(id) on delete restrict,
  district_id text not null references public.districts(id) on delete restrict,
  social_thread_id uuid not null references public.social_threads(id) on delete restrict,
  actor_user_id uuid not null,
  action text not null check (action in ('approve','exclude','restore','classification','note','promote')),
  before_state jsonb not null,
  after_state jsonb not null,
  resulting_version integer not null check (resulting_version > 0),
  created_at timestamptz not null default now()
);

alter table public.social_accounts enable row level security;
alter table public.social_threads enable row level security;
alter table public.social_review_batches enable row level security;
alter table public.social_review_events enable row level security;

create function public.prevent_social_review_audit_mutation()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  raise exception 'Social review audit records are immutable';
end;
$$;
create trigger social_review_batches_immutable before update or delete on public.social_review_batches
for each row execute function public.prevent_social_review_audit_mutation();
create trigger social_review_events_immutable before update or delete on public.social_review_events
for each row execute function public.prevent_social_review_audit_mutation();

create function public.canary_assert_social_reviewer(p_actor_user_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public, auth as $$
declare actor_role text;
begin
  select raw_app_meta_data ->> 'role' into actor_role from auth.users where id = p_actor_user_id;
  if actor_role is distinct from 'admin' then
    raise exception 'Canary reviewer access is required';
  end if;
end;
$$;

revoke all on function public.canary_assert_social_reviewer(uuid) from public, anon, authenticated;
grant execute on function public.canary_assert_social_reviewer(uuid) to service_role;
revoke all on public.social_accounts, public.social_threads, public.social_review_batches, public.social_review_events from public, anon, authenticated;

insert into public.districts (id, name) values ('district-a', 'District A'), ('district-b', 'District B');
insert into auth.users (id, raw_app_meta_data) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '{"role":"admin"}'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '{"role":"client"}');
insert into public.social_accounts (id, district_id, platform, provider, platform_account_id, handle, profile_url)
values
  ('11111111-1111-1111-1111-111111111111', 'district-a', 'facebook', 'meta', 'page-a', 'districta', 'https://facebook.test/districta'),
  ('22222222-2222-2222-2222-222222222222', 'district-b', 'facebook', 'meta', 'page-b', 'districtb', 'https://facebook.test/districtb');

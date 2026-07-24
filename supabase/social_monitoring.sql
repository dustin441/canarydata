-- Canary Data connected-account and public social monitoring schema.
-- REVIEW REQUIRED: do not apply to production until the schema change is approved.
-- Platform access tokens are intentionally NOT stored here. credential_reference points
-- to a secret/vault entry managed outside ordinary application-readable tables.

create table if not exists public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  district_id text not null references public.districts(id) on delete cascade,
  platform text not null check (platform in ('facebook','instagram','youtube','x','threads','tiktok','linkedin')),
  provider text not null default 'manual',
  platform_account_id text,
  handle text,
  display_name text,
  profile_url text,
  authorization_mode text not null default 'public' check (authorization_mode in ('public','official')),
  connection_status text not null default 'discovered' check (connection_status in ('discovered','pending','connected','error','disconnected')),
  credential_reference text,
  granted_scopes jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  connected_at timestamptz,
  token_expires_at timestamptz,
  last_successful_sync_at timestamptz,
  last_error_at timestamptz,
  last_error_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (authorization_mode <> 'official' or credential_reference is not null)
);

create unique index if not exists social_accounts_platform_id_uidx
  on public.social_accounts (district_id, platform, platform_account_id)
  where platform_account_id is not null;
create unique index if not exists social_accounts_handle_uidx
  on public.social_accounts (district_id, platform, lower(handle))
  where handle is not null;
create index if not exists social_accounts_district_active_idx
  on public.social_accounts (district_id, active, platform);

create table if not exists public.social_threads (
  id uuid primary key default gen_random_uuid(),
  district_id text not null references public.districts(id) on delete cascade,
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
  identity_confidence numeric check (identity_confidence is null or (identity_confidence >= 0 and identity_confidence <= 1)),
  visibility_status text not null default 'active' check (visibility_status in ('review','approved','active','excluded')),
  reviewer_note text check (reviewer_note is null or char_length(reviewer_note) <= 2000),
  review_version integer not null default 0,
  provider_metadata jsonb not null default '{}'::jsonb,
  reviewed_at timestamptz,
  reviewed_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (district_id, platform, external_thread_id)
);

create index if not exists social_threads_district_published_idx
  on public.social_threads (district_id, published_at desc);
create index if not exists social_threads_visibility_idx
  on public.social_threads (district_id, visibility_status, published_at desc);
create index if not exists social_threads_relationship_idx
  on public.social_threads (district_id, relationship_type, published_at desc);

create table if not exists public.social_comments (
  id uuid primary key default gen_random_uuid(),
  social_thread_id uuid not null references public.social_threads(id) on delete cascade,
  platform text not null,
  external_comment_id text not null,
  parent_external_comment_id text,
  author_name text,
  author_handle text,
  body text not null,
  permalink text,
  published_at timestamptz not null,
  reaction_count integer not null default 0 check (reaction_count >= 0),
  sentiment text,
  risk_level text,
  is_district_reply boolean not null default false,
  is_representative boolean not null default false,
  provider_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, external_comment_id)
);

create index if not exists social_comments_thread_published_idx
  on public.social_comments (social_thread_id, published_at);
create index if not exists social_comments_representative_idx
  on public.social_comments (social_thread_id, is_representative)
  where is_representative = true;

create table if not exists public.social_collection_runs (
  id uuid primary key default gen_random_uuid(),
  district_id text references public.districts(id) on delete cascade,
  social_account_id uuid references public.social_accounts(id) on delete set null,
  provider text not null,
  run_type text not null check (run_type in ('backfill','poll','webhook','public_search')),
  status text not null default 'running' check (status in ('running','success','empty','partial','failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  raw_items integer not null default 0,
  accepted_threads integer not null default 0,
  accepted_comments integer not null default 0,
  duplicate_items integer not null default 0,
  rejected_items integer not null default 0,
  provider_errors integer not null default 0,
  estimated_cost numeric,
  cursor_after text,
  error_code text,
  error_message text,
  diagnostics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (status not in ('success','empty','partial') or completed_at is not null),
  check (status <> 'success' or provider_errors = 0)
);

create index if not exists social_collection_runs_health_idx
  on public.social_collection_runs (district_id, provider, started_at desc);

create or replace function public.touch_social_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace trigger social_accounts_touch_updated_at
before update on public.social_accounts
for each row execute function public.touch_social_updated_at();
create or replace trigger social_threads_touch_updated_at
before update on public.social_threads
for each row execute function public.touch_social_updated_at();
create or replace trigger social_comments_touch_updated_at
before update on public.social_comments
for each row execute function public.touch_social_updated_at();

alter table public.social_accounts enable row level security;
alter table public.social_threads enable row level security;
alter table public.social_comments enable row level security;
alter table public.social_collection_runs enable row level security;

-- Service-role server code and approved ingestion workflows bypass RLS.
-- No anon/authenticated policies are created here; dashboard reads remain server-side
-- and district-scoped through protected app_metadata authorization.

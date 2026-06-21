-- Strategic Alignment source-of-truth tables for Canary Data.
-- Apply in Supabase SQL editor or via Supabase CLI once database admin access is available.

create table if not exists public.strategic_profiles (
  id uuid primary key default gen_random_uuid(),
  district_id text not null references public.districts(id) on delete cascade,
  source_confidence text not null default 'needs_review' check (source_confidence in ('high','medium','low','needs_review')),
  mission text,
  vision text,
  values jsonb not null default '[]'::jsonb,
  source_urls jsonb not null default '[]'::jsonb,
  notes text,
  last_reviewed_at timestamptz,
  reviewed_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (district_id)
);

create table if not exists public.strategic_priorities (
  id uuid primary key default gen_random_uuid(),
  district_id text not null references public.districts(id) on delete cascade,
  profile_id uuid references public.strategic_profiles(id) on delete cascade,
  label text not null,
  description text,
  aliases jsonb not null default '[]'::jsonb,
  source_urls jsonb not null default '[]'::jsonb,
  confidence text not null default 'needs_review' check (confidence in ('high','medium','low','needs_review')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (district_id, label)
);

create index if not exists strategic_priorities_district_active_idx
  on public.strategic_priorities (district_id, active);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists strategic_profiles_touch_updated_at on public.strategic_profiles;
create trigger strategic_profiles_touch_updated_at
before update on public.strategic_profiles
for each row execute function public.touch_updated_at();

drop trigger if exists strategic_priorities_touch_updated_at on public.strategic_priorities;
create trigger strategic_priorities_touch_updated_at
before update on public.strategic_priorities
for each row execute function public.touch_updated_at();

alter table public.strategic_profiles enable row level security;
alter table public.strategic_priorities enable row level security;

-- Public anon clients should not read/write strategic profile internals by default.
-- Service-role access bypasses RLS for n8n/backfill jobs.

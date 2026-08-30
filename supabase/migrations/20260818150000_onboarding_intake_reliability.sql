-- Structured Canary trial-onboarding persistence and recoverable ClickUp dispatch tracking.
-- Review and apply to the canonical Canary project before relying on structured intake.

create table if not exists public.onboarding_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text not null default 'submitted',
  trial_status text not null default 'not_started',
  payment_status text not null default 'pending',
  access_status text not null default 'pending_setup',
  organization_name text not null,
  website text not null,
  contact_name text not null,
  contact_email text not null,
  contact_title text,
  city text,
  state text,
  zip text,
  social_handles text,
  keywords text,
  school_names text,
  known_exclusions text,
  current_monitoring text,
  notes text,
  discovered_profile jsonb not null default '{}'::jsonb,
  confirmed_profile jsonb not null default '{}'::jsonb,
  trial_starts_at timestamptz,
  trial_ends_at timestamptz,
  paid_at timestamptz,
  paid_through timestamptz,
  po_number text,
  billing_phone text,
  billing_address_line1 text,
  billing_address_line2 text,
  billing_city text,
  billing_state text,
  billing_zip text,
  stripe_customer_id text,
  stripe_subscription_id text,
  clickup_task_id text,
  clickup_task_url text,
  clickup_synced_at timestamptz,
  clickup_sync_error text
);

alter table public.onboarding_requests add column if not exists access_status text not null default 'pending_setup';
alter table public.onboarding_requests add column if not exists trial_starts_at timestamptz;
alter table public.onboarding_requests add column if not exists paid_at timestamptz;
alter table public.onboarding_requests add column if not exists paid_through timestamptz;
alter table public.onboarding_requests add column if not exists po_number text;
alter table public.onboarding_requests add column if not exists billing_phone text;
alter table public.onboarding_requests add column if not exists billing_address_line1 text;
alter table public.onboarding_requests add column if not exists billing_address_line2 text;
alter table public.onboarding_requests add column if not exists billing_city text;
alter table public.onboarding_requests add column if not exists billing_state text;
alter table public.onboarding_requests add column if not exists billing_zip text;
alter table public.onboarding_requests add column if not exists clickup_task_id text;
alter table public.onboarding_requests add column if not exists clickup_task_url text;
alter table public.onboarding_requests add column if not exists clickup_synced_at timestamptz;
alter table public.onboarding_requests add column if not exists clickup_sync_error text;

alter table public.feedback add column if not exists clickup_task_id text;
alter table public.feedback add column if not exists clickup_task_url text;
alter table public.feedback add column if not exists clickup_synced_at timestamptz;
alter table public.feedback add column if not exists clickup_sync_error text;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'onboarding_requests' and column_name = 'trial_started_at'
  ) then
    execute 'update public.onboarding_requests set trial_starts_at = coalesce(trial_starts_at, trial_started_at) where trial_started_at is not null';
  end if;
end;
$$;

create index if not exists onboarding_requests_status_idx on public.onboarding_requests (status);
create index if not exists onboarding_requests_contact_email_idx on public.onboarding_requests (lower(contact_email));
create index if not exists onboarding_requests_created_at_idx on public.onboarding_requests (created_at desc);
create index if not exists onboarding_requests_clickup_task_idx on public.onboarding_requests (clickup_task_id) where clickup_task_id is not null;
create index if not exists feedback_clickup_task_idx on public.feedback (clickup_task_id) where clickup_task_id is not null;

create or replace function public.set_onboarding_requests_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists onboarding_requests_updated_at on public.onboarding_requests;
create trigger onboarding_requests_updated_at
before update on public.onboarding_requests
for each row execute function public.set_onboarding_requests_updated_at();

alter table public.onboarding_requests enable row level security;

comment on table public.onboarding_requests is
  'Server-controlled trial onboarding requests. Public/client writes use the Canary Next.js server action; service-role operations perform review, setup, and lifecycle transitions.';

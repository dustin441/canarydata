-- Canary Data onboarding/trial requests
-- Apply in Supabase SQL editor before relying on structured intake persistence.
-- The app also creates a ClickUp task as an operational fallback/notification.

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
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  stripe_customer_id text,
  stripe_subscription_id text,
  clickup_task_id text,
  clickup_task_url text,
  clickup_synced_at timestamptz,
  clickup_sync_error text
);

create index if not exists onboarding_requests_status_idx on public.onboarding_requests (status);
create index if not exists onboarding_requests_contact_email_idx on public.onboarding_requests (lower(contact_email));
create index if not exists onboarding_requests_created_at_idx on public.onboarding_requests (created_at desc);

create or replace function public.set_onboarding_requests_updated_at()
returns trigger language plpgsql as $$
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

-- Server-side service role writes/reads this table. Public/client writes should go through Next server actions only.

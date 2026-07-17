-- PROPOSAL ONLY. DO NOT APPLY WITHOUT APPROVAL, BACKUP, AND A REVIEWED DRY-RUN BACKFILL REPORT.

begin;

create table if not exists public.customer_organizations (
  id uuid primary key default gen_random_uuid(),
  district_id text unique references public.districts(id),
  legal_name text,
  display_name text not null,
  billing_email text,
  status text not null default 'active' check (status in ('pending', 'active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_memberships (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id),
  organization_id uuid not null references public.customer_organizations(id),
  role text not null default 'member' check (role in ('member', 'district_admin')),
  status text not null default 'active' check (status in ('invited', 'active', 'suspended', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (auth_user_id, organization_id)
);

create table if not exists public.platform_roles (
  auth_user_id uuid primary key references auth.users(id),
  role text not null check (role in ('admin', 'support')),
  status text not null default 'active' check (status in ('active', 'suspended', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.onboarding_requests (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users(id),
  organization_id uuid references public.customer_organizations(id),
  requested_district_id text references public.districts(id),
  organization_name text not null,
  contact_first_name text,
  contact_last_name text,
  contact_email text not null,
  contact_phone text,
  title text,
  website text,
  discovery_notes text,
  requested_monitoring_profile jsonb not null default '{}'::jsonb,
  stage text not null default 'submitted' check (stage in ('submitted', 'under_review', 'approved', 'rejected', 'provisioned')),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  provisioned_at timestamptz,
  clickup_task_id text,
  clickup_task_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.customer_organizations(id),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'pending', 'paid', 'past_due', 'refunded', 'waived')),
  access_status text not null default 'open' check (access_status in ('open', 'active', 'suspended')),
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  paid_at timestamptz,
  paid_through timestamptz,
  renewal_status text not null default 'not_due' check (renewal_status in ('not_due', 'upcoming', 'pending', 'renewed', 'expired', 'cancelled')),
  stripe_customer_id text unique,
  stripe_checkout_session_id text unique,
  stripe_subscription_id text unique,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text not null unique,
  organization_id uuid references public.customer_organizations(id),
  billing_account_id uuid references public.billing_accounts(id),
  event_type text not null,
  livemode boolean not null,
  stripe_customer_id text,
  stripe_checkout_session_id text,
  payload_sha256 text not null,
  processing_status text not null default 'received' check (processing_status in ('received', 'processed', 'ignored', 'failed')),
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create table if not exists public.billing_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.customer_organizations(id),
  billing_account_id uuid references public.billing_accounts(id),
  document_type text not null check (document_type in ('quote', 'w9', 'invoice', 'receipt')),
  document_number text,
  purchase_order_number text,
  provider_reference text,
  storage_path text,
  external_url text,
  amount_cents bigint check (amount_cents is null or amount_cents >= 0),
  currency text not null default 'usd',
  status text not null default 'draft' check (status in ('draft', 'issued', 'accepted', 'paid', 'void')),
  issued_at timestamptz,
  paid_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, document_type, document_number)
);

create index if not exists customer_memberships_auth_status_idx
  on public.customer_memberships (auth_user_id, status);
create index if not exists onboarding_requests_stage_created_idx
  on public.onboarding_requests (stage, created_at desc);
create index if not exists billing_events_account_received_idx
  on public.billing_events (billing_account_id, received_at desc);
create index if not exists billing_documents_org_created_idx
  on public.billing_documents (organization_id, created_at desc);

alter table public.customer_organizations enable row level security;
alter table public.customer_memberships enable row level security;
alter table public.platform_roles enable row level security;
alter table public.onboarding_requests enable row level security;
alter table public.billing_accounts enable row level security;
alter table public.billing_events enable row level security;
alter table public.billing_documents enable row level security;

-- Initial cutover uses server-only reads/writes. Add narrowly scoped authenticated
-- read policies only after the application query surface is separately reviewed.
revoke all on public.customer_organizations from anon, authenticated;
revoke all on public.customer_memberships from anon, authenticated;
revoke all on public.platform_roles from anon, authenticated;
revoke all on public.onboarding_requests from anon, authenticated;
revoke all on public.billing_accounts from anon, authenticated;
revoke all on public.billing_events from anon, authenticated;
revoke all on public.billing_documents from anon, authenticated;

-- Keep signed Stripe event rows immutable except for the one-way processing-state
-- transition performed by a future reviewed transaction function.
create or replace function public.prevent_billing_event_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'billing_events cannot be deleted';
end;
$$;

drop trigger if exists billing_events_no_delete on public.billing_events;
create trigger billing_events_no_delete
before delete on public.billing_events
for each row execute function public.prevent_billing_event_delete();

commit;

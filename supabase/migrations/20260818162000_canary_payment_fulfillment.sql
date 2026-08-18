begin;

create table if not exists public.canary_payment_fulfillments (
  checkout_session_id text primary key,
  stripe_event_id text unique,
  auth_user_id uuid not null references auth.users(id),
  district_id text not null,
  stripe_customer_id text not null,
  charge_paid_at timestamptz not null,
  is_test_purchase boolean not null default false,
  result jsonb not null,
  processed_at timestamptz not null default now()
);

alter table public.canary_payment_fulfillments enable row level security;
revoke all on public.canary_payment_fulfillments from public, anon, authenticated;
grant select, insert, update on public.canary_payment_fulfillments to service_role;

create or replace function public.fulfill_canary_stripe_payment(
  p_checkout_session_id text,
  p_stripe_event_id text,
  p_auth_user_id uuid,
  p_expected_email text,
  p_district_id text,
  p_customer_id text,
  p_request_id text,
  p_organization_name text,
  p_charge_paid_at timestamptz,
  p_is_test_purchase boolean,
  p_expected_app_metadata jsonb,
  p_app_patch jsonb,
  p_user_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_app jsonb;
  v_user jsonb;
  v_email text;
  v_existing public.canary_payment_fulfillments%rowtype;
  v_onboarding_id uuid;
  v_existing_paid_at timestamptz;
  v_existing_paid_through timestamptz;
  v_saved_paid_at timestamptz;
  v_saved_paid_through timestamptz;
  v_result jsonb;
begin
  if coalesce(p_checkout_session_id, '') = '' or coalesce(p_expected_email, '') = ''
    or coalesce(p_district_id, '') = '' or coalesce(p_customer_id, '') = ''
    or p_charge_paid_at is null then
    raise exception 'Complete protected payment ownership and charge time are required';
  end if;

  select coalesce(raw_app_meta_data, '{}'::jsonb), coalesce(raw_user_meta_data, '{}'::jsonb), lower(email)
    into v_app, v_user, v_email
  from auth.users
  where id = p_auth_user_id
  for update;

  if not found or v_email is distinct from lower(p_expected_email)
    or coalesce(v_app ->> 'district_id', '') = ''
    or v_app ->> 'district_id' is distinct from p_district_id
    or coalesce(v_app ->> 'stripe_customer_id', '') = ''
    or v_app ->> 'stripe_customer_id' is distinct from p_customer_id
    or p_expected_app_metadata is null
    or v_app is distinct from p_expected_app_metadata then
    raise exception 'Protected Canary account ownership changed before fulfillment';
  end if;

  select * into v_existing
  from public.canary_payment_fulfillments
  where checkout_session_id = p_checkout_session_id;

  if found then
    if v_existing.auth_user_id is distinct from p_auth_user_id
      or v_existing.district_id is distinct from p_district_id
      or v_existing.stripe_customer_id is distinct from p_customer_id then
      raise exception 'Checkout Session fulfillment ownership conflict';
    end if;
    if nullif(p_stripe_event_id, '') is not null and v_existing.stripe_event_id is null then
      update public.canary_payment_fulfillments
      set stripe_event_id = nullif(p_stripe_event_id, '')
      where checkout_session_id = p_checkout_session_id;
    end if;
    return v_existing.result || jsonb_build_object('alreadyProcessed', true);
  end if;

  if nullif(p_stripe_event_id, '') is not null and exists (
    select 1 from public.canary_payment_fulfillments where stripe_event_id = p_stripe_event_id
  ) then
    raise exception 'Stripe event was already claimed by a different Checkout Session';
  end if;

  if nullif(p_request_id, '') is not null then
    select id into v_onboarding_id
    from public.onboarding_requests
    where id::text = p_request_id
      and lower(contact_email) = lower(p_expected_email)
      and (coalesce(p_organization_name, '') = '' or trim(organization_name) = trim(p_organization_name))
    for update;
    if not found then
      raise exception 'Onboarding request ownership does not match protected payment account';
    end if;
  end if;

  if p_is_test_purchase then
    v_app := v_app || coalesce(p_app_patch, '{}'::jsonb);
    v_result := jsonb_build_object(
      'ok', true,
      'alreadyProcessed', false,
      'testPurchase', true,
      'onboardingUpdated', false,
      'userId', p_auth_user_id,
      'paidAt', p_charge_paid_at
    );
  else
    begin v_existing_paid_at := nullif(v_app ->> 'payment_paid_at', '')::timestamptz; exception when others then v_existing_paid_at := null; end;
    begin v_existing_paid_through := nullif(v_app ->> 'paid_through', '')::timestamptz; exception when others then v_existing_paid_through := null; end;
    v_saved_paid_at := greatest(coalesce(v_existing_paid_at, p_charge_paid_at), p_charge_paid_at);
    v_saved_paid_through := greatest(coalesce(v_existing_paid_through, p_charge_paid_at), p_charge_paid_at) + interval '1 year';
    v_app := v_app || coalesce(p_app_patch, '{}'::jsonb) || jsonb_build_object(
      'payment_paid_at', to_char(v_saved_paid_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'paid_through', to_char(v_saved_paid_through at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );
    v_user := v_user || coalesce(p_user_patch, '{}'::jsonb);
    v_result := jsonb_build_object(
      'ok', true,
      'alreadyProcessed', false,
      'testPurchase', false,
      'onboardingUpdated', v_onboarding_id is not null,
      'userId', p_auth_user_id,
      'paidAt', to_char(v_saved_paid_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'paidThrough', to_char(v_saved_paid_through at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );
  end if;

  insert into public.canary_payment_fulfillments (
    checkout_session_id, stripe_event_id, auth_user_id, district_id, stripe_customer_id,
    charge_paid_at, is_test_purchase, result
  ) values (
    p_checkout_session_id, nullif(p_stripe_event_id, ''), p_auth_user_id, p_district_id, p_customer_id,
    p_charge_paid_at, p_is_test_purchase, v_result
  );

  if v_onboarding_id is not null and not p_is_test_purchase then
    update public.onboarding_requests
    set payment_status = 'paid', stripe_customer_id = p_customer_id, access_status = 'active'
    where id = v_onboarding_id;
    if not found then raise exception 'Onboarding payment update failed'; end if;
  end if;

  update auth.users
  set raw_app_meta_data = v_app,
      raw_user_meta_data = case when p_is_test_purchase then raw_user_meta_data else v_user end,
      updated_at = now()
  where id = p_auth_user_id;
  if not found then raise exception 'Protected Canary Auth entitlement update failed'; end if;

  return v_result;
end;
$$;

revoke all on function public.fulfill_canary_stripe_payment(text, text, uuid, text, text, text, text, text, timestamptz, boolean, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.fulfill_canary_stripe_payment(text, text, uuid, text, text, text, text, text, timestamptz, boolean, jsonb, jsonb, jsonb) to service_role;

create or replace function public.patch_canary_protected_app_metadata(
  p_auth_user_id uuid,
  p_district_id text,
  p_expected_customer_id text,
  p_expected_app_metadata jsonb,
  p_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_app jsonb;
begin
  if coalesce(p_district_id, '') = '' or p_patch is null or jsonb_typeof(p_patch) is distinct from 'object' then
    raise exception 'Protected district and metadata patch are required';
  end if;

  select coalesce(raw_app_meta_data, '{}'::jsonb)
    into v_app
  from auth.users
  where id = p_auth_user_id
  for update;

  if not found or coalesce(v_app ->> 'district_id', '') = ''
    or v_app ->> 'district_id' is distinct from p_district_id
    or coalesce(v_app ->> 'stripe_customer_id', '') is distinct from coalesce(p_expected_customer_id, '')
    or (p_expected_app_metadata is not null and v_app is distinct from p_expected_app_metadata) then
    raise exception 'Protected Canary metadata changed before guarded update';
  end if;

  v_app := v_app || p_patch;
  update auth.users set raw_app_meta_data = v_app, updated_at = now() where id = p_auth_user_id;
  if not found then raise exception 'Protected Canary metadata update failed'; end if;
  return v_app;
end;
$$;

revoke all on function public.patch_canary_protected_app_metadata(uuid, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.patch_canary_protected_app_metadata(uuid, text, text, jsonb, jsonb) to service_role;

commit;

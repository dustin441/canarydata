begin;

create table public.canary_payment_receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_number text not null unique,
  payment_method text not null check (payment_method in ('card', 'check', 'ach')),
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null check (currency = lower(currency) and currency ~ '^[a-z]{3}$'),
  paid_at timestamptz not null,
  paid_through timestamptz not null check (paid_through > paid_at),
  stripe_checkout_session_id text,
  stripe_customer_id text,
  stripe_payment_intent_id text,
  stripe_charge_id text,
  stripe_receipt_url text,
  billing_email text not null,
  organization_name text not null,
  district_id text not null,
  payment_actor_user_id uuid not null references auth.users(id),
  source text not null,
  source_reference text not null,
  created_at timestamptz not null default now(),
  unique (source, source_reference),
  check (
    (payment_method = 'card' and stripe_checkout_session_id is not null and stripe_customer_id is not null
      and stripe_payment_intent_id is not null and stripe_charge_id is not null and stripe_receipt_url is not null)
    or
    (payment_method in ('check', 'ach') and stripe_checkout_session_id is null and stripe_customer_id is null
      and stripe_payment_intent_id is null and stripe_charge_id is null and stripe_receipt_url is null)
  )
);

create unique index canary_payment_receipts_stripe_charge_uidx
  on public.canary_payment_receipts (stripe_charge_id)
  where stripe_charge_id is not null;
create unique index canary_payment_receipts_checkout_session_uidx
  on public.canary_payment_receipts (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

alter table public.canary_payment_receipts enable row level security;
revoke all on public.canary_payment_receipts from public, anon, authenticated;
grant select, insert on public.canary_payment_receipts to service_role;

create or replace function public.prevent_canary_payment_receipt_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Canary payment receipts are immutable';
end;
$$;

create trigger canary_payment_receipts_immutable
before update or delete on public.canary_payment_receipts
for each row execute function public.prevent_canary_payment_receipt_mutation();

revoke all on function public.prevent_canary_payment_receipt_mutation() from public, anon, authenticated;

-- Keep the prior 13-argument signature during rollout so an in-flight deployment can
-- still finish a payment. PostgREST resolves these overloads by their named arguments.
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
  p_user_patch jsonb,
  p_amount_cents bigint,
  p_currency text,
  p_payment_intent_id text,
  p_charge_id text,
  p_receipt_url text,
  p_billing_email text,
  p_receipt_number text
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
  v_onboarding_id text;
  v_onboarding_access_status text;
  v_onboarding_rows integer;
  v_existing_paid_at timestamptz;
  v_existing_paid_through timestamptz;
  v_saved_paid_at timestamptz;
  v_saved_paid_through timestamptz;
  v_receipt_paid_through timestamptz;
  v_is_latest_payment boolean;
  v_result jsonb;
begin
  if coalesce(p_checkout_session_id, '') = '' or coalesce(p_expected_email, '') = ''
    or coalesce(p_district_id, '') = '' or coalesce(p_customer_id, '') = ''
    or p_charge_paid_at is null then
    raise exception 'Complete protected payment ownership and charge time are required';
  end if;
  if not p_is_test_purchase and (
    coalesce(p_organization_name, '') = '' or coalesce(p_billing_email, '') = ''
    or lower(p_billing_email) is distinct from lower(p_expected_email)
    or coalesce(p_receipt_number, '') = '' or coalesce(p_payment_intent_id, '') = ''
    or coalesce(p_charge_id, '') = '' or coalesce(p_receipt_url, '') = ''
    or p_amount_cents is null or p_amount_cents <= 0
    or lower(coalesce(p_currency, '')) !~ '^[a-z]{3}$'
  ) then
    raise exception 'Complete immutable Stripe receipt details are required';
  end if;

  select * into v_existing
  from public.canary_payment_fulfillments
  where checkout_session_id = p_checkout_session_id
  for update;

  if found then
    if v_existing.auth_user_id is distinct from p_auth_user_id
      or v_existing.district_id is distinct from p_district_id
      or v_existing.stripe_customer_id is distinct from p_customer_id then
      raise exception 'Checkout Session fulfillment ownership conflict';
    end if;
    if nullif(p_stripe_event_id, '') is not null and v_existing.stripe_event_id is not null
      and v_existing.stripe_event_id is distinct from p_stripe_event_id then
      raise exception 'Checkout Session fulfillment event conflict';
    end if;
    if nullif(p_stripe_event_id, '') is not null and v_existing.stripe_event_id is null then
      update public.canary_payment_fulfillments
      set stripe_event_id = nullif(p_stripe_event_id, '')
      where checkout_session_id = p_checkout_session_id;
    end if;
    if not p_is_test_purchase then
      begin v_saved_paid_through := nullif(v_existing.result ->> 'paidThrough', '')::timestamptz; exception when others then v_saved_paid_through := null; end;
      if v_saved_paid_through is null then
        raise exception 'Prior fulfillment is missing its authoritative paid-through date';
      end if;
      v_receipt_paid_through := v_saved_paid_through;
      insert into public.canary_payment_receipts (
        receipt_number, payment_method, amount_cents, currency, paid_at, paid_through,
        stripe_checkout_session_id, stripe_customer_id, stripe_payment_intent_id, stripe_charge_id,
        stripe_receipt_url, billing_email, organization_name, district_id, payment_actor_user_id, source, source_reference
      ) values (
        p_receipt_number, 'card', p_amount_cents, lower(p_currency), p_charge_paid_at, v_receipt_paid_through,
        p_checkout_session_id, p_customer_id, p_payment_intent_id, p_charge_id,
        p_receipt_url, lower(p_billing_email), p_organization_name, p_district_id, p_auth_user_id,
        'stripe_checkout', p_checkout_session_id
      ) on conflict (source, source_reference) do nothing;
    end if;
    return v_existing.result || jsonb_build_object('alreadyProcessed', true);
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

  if lower(coalesce(v_app ->> 'access_status', '')) in ('revoked', 'disabled', 'suspended_security', 'terminated')
    or lower(coalesce(v_app ->> 'account_enabled', 'true')) = 'false' then
    raise exception 'Payment cannot reactivate a disabled Canary account';
  end if;

  if nullif(p_stripe_event_id, '') is not null and exists (
    select 1 from public.canary_payment_fulfillments where stripe_event_id = p_stripe_event_id
  ) then
    raise exception 'Stripe event was already claimed by a different Checkout Session';
  end if;

  if nullif(p_request_id, '') is not null then
    execute 'select id::text, lower(coalesce(access_status, '''')) from public.onboarding_requests
      where id::text = $1 and lower(contact_email) = lower($2)
        and (coalesce($3, '''') = '''' or trim(organization_name) = trim($3)) for update'
      into v_onboarding_id, v_onboarding_access_status
      using p_request_id, p_expected_email, p_organization_name;
    if v_onboarding_id is null then
      raise exception 'Onboarding request ownership does not match protected payment account';
    end if;
    if v_onboarding_access_status in ('revoked', 'disabled', 'suspended_security', 'terminated') then
      raise exception 'Payment cannot reactivate a disabled Canary onboarding account';
    end if;
  end if;

  if p_is_test_purchase then
    v_app := v_app || coalesce(p_app_patch, '{}'::jsonb);
    v_result := jsonb_build_object(
      'ok', true, 'alreadyProcessed', false, 'testPurchase', true,
      'onboardingUpdated', false, 'userId', p_auth_user_id, 'paidAt', p_charge_paid_at
    );
  else
    begin v_existing_paid_at := nullif(v_app ->> 'payment_paid_at', '')::timestamptz; exception when others then v_existing_paid_at := null; end;
    begin v_existing_paid_through := nullif(v_app ->> 'paid_through', '')::timestamptz; exception when others then v_existing_paid_through := null; end;
    if v_app ->> 'stripe_checkout_session_id' = p_checkout_session_id
      and v_existing_paid_at is not null and v_existing_paid_through is not null then
      -- Historical recovery of the same payment must not grant a second year.
      v_saved_paid_at := v_existing_paid_at;
      v_saved_paid_through := v_existing_paid_through;
      v_receipt_paid_through := v_existing_paid_through;
      v_is_latest_payment := false;
    elsif v_existing_paid_at is not null and p_charge_paid_at < v_existing_paid_at then
      -- An older distinct payment gets its own receipt without replacing or extending newer account state.
      v_saved_paid_at := v_existing_paid_at;
      v_saved_paid_through := greatest(coalesce(v_existing_paid_through, p_charge_paid_at), p_charge_paid_at);
      v_receipt_paid_through := p_charge_paid_at + interval '1 year';
      v_is_latest_payment := false;
    else
      v_saved_paid_at := greatest(coalesce(v_existing_paid_at, p_charge_paid_at), p_charge_paid_at);
      v_saved_paid_through := greatest(coalesce(v_existing_paid_through, p_charge_paid_at), p_charge_paid_at) + interval '1 year';
      v_receipt_paid_through := v_saved_paid_through;
      v_is_latest_payment := true;
    end if;
    if v_is_latest_payment then
      v_app := v_app || coalesce(p_app_patch, '{}'::jsonb) || jsonb_build_object(
        'payment_paid_at', to_char(v_saved_paid_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'paid_through', to_char(v_saved_paid_through at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      );
      v_user := v_user || coalesce(p_user_patch, '{}'::jsonb);
    end if;
    v_result := jsonb_build_object(
      'ok', true, 'alreadyProcessed', false, 'testPurchase', false,
      'onboardingUpdated', v_onboarding_id is not null, 'userId', p_auth_user_id,
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

  if not p_is_test_purchase then
    insert into public.canary_payment_receipts (
      receipt_number, payment_method, amount_cents, currency, paid_at, paid_through,
      stripe_checkout_session_id, stripe_customer_id, stripe_payment_intent_id, stripe_charge_id,
      stripe_receipt_url, billing_email, organization_name, district_id, payment_actor_user_id, source, source_reference
    ) values (
      p_receipt_number, 'card', p_amount_cents, lower(p_currency), p_charge_paid_at, v_receipt_paid_through,
      p_checkout_session_id, p_customer_id, p_payment_intent_id, p_charge_id,
      p_receipt_url, lower(p_billing_email), p_organization_name, p_district_id, p_auth_user_id,
      'stripe_checkout', p_checkout_session_id
    );
  end if;

  if v_onboarding_id is not null and not p_is_test_purchase then
    execute 'update public.onboarding_requests set payment_status = ''paid'', stripe_customer_id = $1,
      access_status = ''active'', trial_status = ''converted'', paid_at = $2, paid_through = $3 where id::text = $4'
      using p_customer_id, v_saved_paid_at, v_saved_paid_through, v_onboarding_id;
    get diagnostics v_onboarding_rows = row_count;
    if v_onboarding_rows <> 1 then raise exception 'Onboarding payment update failed'; end if;
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

revoke all on function public.fulfill_canary_stripe_payment(text, text, uuid, text, text, text, text, text, timestamptz, boolean, jsonb, jsonb, jsonb, bigint, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.fulfill_canary_stripe_payment(text, text, uuid, text, text, text, text, text, timestamptz, boolean, jsonb, jsonb, jsonb, bigint, text, text, text, text, text, text) to service_role;

create or replace function public.record_canary_manual_payment(
  p_auth_user_id uuid,
  p_expected_email text,
  p_district_id text,
  p_request_id text,
  p_organization_name text,
  p_payment_method text,
  p_amount_cents bigint,
  p_currency text,
  p_paid_at timestamptz,
  p_paid_through timestamptz,
  p_receipt_number text,
  p_source text,
  p_source_reference text,
  p_expected_app_metadata jsonb
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
  v_onboarding_id text;
  v_onboarding_access text;
  v_rows integer;
  v_existing public.canary_payment_receipts%rowtype;
  v_existing_paid_at timestamptz;
  v_existing_paid_through timestamptz;
  v_effective_paid_at timestamptz;
  v_effective_paid_through timestamptz;
  v_is_latest_payment boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Manual Canary payment recording requires service_role';
  end if;
  if p_payment_method not in ('check', 'ach')
    or coalesce(p_expected_email, '') = '' or coalesce(p_district_id, '') = ''
    or coalesce(p_organization_name, '') = '' or coalesce(p_receipt_number, '') = ''
    or coalesce(p_source, '') = '' or coalesce(p_source_reference, '') = ''
    or p_amount_cents is null or p_amount_cents <= 0
    or lower(coalesce(p_currency, '')) !~ '^[a-z]{3}$'
    or p_paid_at is null or p_paid_through is null or p_paid_through <= p_paid_at then
    raise exception 'Explicit valid manual payment and receipt details are required';
  end if;

  select * into v_existing from public.canary_payment_receipts
    where source = p_source and source_reference = p_source_reference for update;
  if found then
    if v_existing.payment_actor_user_id is distinct from p_auth_user_id
      or v_existing.district_id is distinct from p_district_id
      or v_existing.billing_email is distinct from lower(p_expected_email)
      or v_existing.organization_name is distinct from p_organization_name
      or v_existing.receipt_number is distinct from p_receipt_number
      or v_existing.payment_method is distinct from p_payment_method
      or v_existing.amount_cents is distinct from p_amount_cents
      or v_existing.currency is distinct from lower(p_currency)
      or v_existing.paid_at is distinct from p_paid_at
      or v_existing.paid_through is distinct from p_paid_through then
      raise exception 'Manual payment reference conflicts with its immutable receipt';
    end if;
    return jsonb_build_object('ok', true, 'alreadyProcessed', true, 'receiptNumber', v_existing.receipt_number);
  end if;

  select coalesce(raw_app_meta_data, '{}'::jsonb), coalesce(raw_user_meta_data, '{}'::jsonb), lower(email)
    into v_app, v_user, v_email
  from auth.users where id = p_auth_user_id for update;
  if not found or v_email is distinct from lower(p_expected_email)
    or v_app ->> 'district_id' is distinct from p_district_id
    or p_expected_app_metadata is null or v_app is distinct from p_expected_app_metadata then
    raise exception 'Protected Canary account ownership changed before manual payment';
  end if;
  if lower(coalesce(v_app ->> 'access_status', '')) in ('revoked', 'disabled', 'suspended_security', 'terminated')
    or lower(coalesce(v_app ->> 'account_enabled', 'true')) = 'false' then
    raise exception 'Manual payment cannot reactivate a disabled Canary account';
  end if;

  begin v_existing_paid_at := nullif(v_app ->> 'payment_paid_at', '')::timestamptz; exception when others then v_existing_paid_at := null; end;
  begin v_existing_paid_through := nullif(v_app ->> 'paid_through', '')::timestamptz; exception when others then v_existing_paid_through := null; end;
  v_effective_paid_at := greatest(coalesce(v_existing_paid_at, p_paid_at), p_paid_at);
  v_effective_paid_through := greatest(coalesce(v_existing_paid_through, p_paid_through), p_paid_through);
  v_is_latest_payment := v_existing_paid_at is null or p_paid_at >= v_existing_paid_at;

  if nullif(p_request_id, '') is not null then
    select id::text, lower(coalesce(access_status, '')) into v_onboarding_id, v_onboarding_access
    from public.onboarding_requests
    where id::text = p_request_id and lower(contact_email) = lower(p_expected_email)
      and trim(organization_name) = trim(p_organization_name)
    for update;
    if v_onboarding_id is null then
      raise exception 'Onboarding request ownership does not match protected manual payment account';
    end if;
    if v_onboarding_access in ('revoked', 'disabled', 'suspended_security', 'terminated') then
      raise exception 'Manual payment cannot reactivate a disabled Canary onboarding account';
    end if;
  end if;

  insert into public.canary_payment_receipts (
    receipt_number, payment_method, amount_cents, currency, paid_at, paid_through,
    billing_email, organization_name, district_id, payment_actor_user_id, source, source_reference
  ) values (
    p_receipt_number, p_payment_method, p_amount_cents, lower(p_currency), p_paid_at, p_paid_through,
    lower(p_expected_email), p_organization_name, p_district_id, p_auth_user_id, p_source, p_source_reference
  );

  v_app := v_app || jsonb_build_object(
    'payment_status', 'paid', 'access_status', 'active', 'trial_status', 'converted',
    'payment_paid_at', to_char(v_effective_paid_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'paid_through', to_char(v_effective_paid_through at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  if v_is_latest_payment then
    v_app := v_app || jsonb_build_object(
      'payment_method', p_payment_method, 'payment_amount_cents', p_amount_cents,
      'payment_currency', lower(p_currency), 'receipt_number', p_receipt_number
    );
    v_user := v_user || jsonb_build_object('receipt_number', p_receipt_number, 'district_name', p_organization_name);
  end if;

  if v_onboarding_id is not null then
    update public.onboarding_requests set payment_status = 'paid', access_status = 'active', trial_status = 'converted',
      paid_at = greatest(coalesce(paid_at, p_paid_at), p_paid_at),
      paid_through = greatest(coalesce(paid_through, p_paid_through), p_paid_through)
    where id::text = v_onboarding_id;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then raise exception 'Onboarding manual payment update failed'; end if;
  end if;

  update auth.users set raw_app_meta_data = v_app, raw_user_meta_data = v_user, updated_at = now()
  where id = p_auth_user_id;
  if not found then raise exception 'Protected Canary manual payment entitlement update failed'; end if;

  return jsonb_build_object(
    'ok', true, 'alreadyProcessed', false, 'receiptNumber', p_receipt_number,
    'paidAt', to_char(p_paid_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'paidThrough', to_char(p_paid_through at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'coveragePaidThrough', to_char(v_effective_paid_through at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
end;
$$;

revoke all on function public.record_canary_manual_payment(uuid, text, text, text, text, text, bigint, text, timestamptz, timestamptz, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_canary_manual_payment(uuid, text, text, text, text, text, bigint, text, timestamptz, timestamptz, text, text, text, jsonb) to service_role;

notify pgrst, 'reload schema';
commit;

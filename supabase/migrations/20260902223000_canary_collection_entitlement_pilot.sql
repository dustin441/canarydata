-- Tighten the Canary entitlement shadow boundary and add one internal-only
-- collection decision gate. Customer districts remain explicitly unenforced.

revoke all on table public.district_entitlements
  from public, anon, authenticated, service_role;
revoke all on table public.district_entitlement_events
  from public, anon, authenticated, service_role;
revoke all on table public.canary_effective_district_entitlements
  from public, anon, authenticated, service_role;
revoke all on sequence public.district_entitlement_events_id_seq
  from public, anon, authenticated, service_role;

grant select on table public.district_entitlements to service_role;
grant select on table public.district_entitlement_events to service_role;
grant select on table public.canary_effective_district_entitlements to service_role;

create or replace function public.canary_collection_query_gate(
  p_query jsonb,
  p_at timestamptz default now()
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_district_id text;
  v_entitlement public.district_entitlements%rowtype;
  v_allowed boolean;
  v_effective_status text;
  v_reason text;
begin
  if p_query is null or jsonb_typeof(p_query) <> 'object' then
    raise exception using errcode = '22023', message = 'Canary collection gate requires a query object';
  end if;

  v_district_id := nullif(btrim(p_query ->> 'district_id'), '');
  if v_district_id is null then
    raise exception using errcode = '22023', message = 'Canary collection gate requires district_id';
  end if;

  -- The pilot is deliberately immutable at runtime. No environment variable,
  -- query field, or database row can expand enforcement to a customer district.
  if v_district_id <> 'canary-lesley-test-district' then
    return p_query || jsonb_build_object(
      '_canary_collection_entitlement', jsonb_build_object(
        'district_id', v_district_id,
        'pilot_district', false,
        'enforced', false,
        'allowed', true,
        'effective_access_status', null,
        'reason', 'not_in_internal_pilot'
      )
    );
  end if;

  select entitlement.*
  into v_entitlement
  from public.district_entitlements entitlement
  where entitlement.district_id = v_district_id;

  if not found then
    v_allowed := false;
    v_effective_status := 'missing';
    v_reason := 'pilot_entitlement_missing';
  elsif v_entitlement.access_status = 'revoked' then
    v_allowed := false;
    v_effective_status := 'revoked';
    v_reason := 'pilot_entitlement_revoked';
  elsif v_entitlement.access_status = 'manual_hold' then
    v_allowed := false;
    v_effective_status := 'manual_hold';
    v_reason := 'pilot_entitlement_manual_hold';
  elsif v_entitlement.access_status = 'inactive_frozen' then
    v_allowed := false;
    v_effective_status := 'inactive_frozen';
    v_reason := 'pilot_entitlement_inactive_frozen';
  elsif v_entitlement.ends_at is not null and v_entitlement.ends_at <= p_at then
    v_allowed := false;
    v_effective_status := 'inactive_frozen';
    v_reason := 'pilot_entitlement_expired';
  else
    v_allowed := true;
    v_effective_status := 'active';
    v_reason := 'pilot_entitlement_active';
  end if;

  return p_query || jsonb_build_object(
    '_canary_collection_entitlement', jsonb_build_object(
      'district_id', v_district_id,
      'pilot_district', true,
      'enforced', true,
      'allowed', v_allowed,
      'effective_access_status', v_effective_status,
      'reason', v_reason,
      'evaluated_at', p_at,
      'entitlement_version', v_entitlement.version
    )
  );
end;
$$;

revoke all on function public.canary_collection_query_gate(jsonb, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.canary_collection_query_gate(jsonb, timestamptz)
  to service_role;

comment on function public.canary_collection_query_gate(jsonb, timestamptz) is
  'Internal-only collection pilot. Enforces district_entitlements for canary-lesley-test-district; all customer districts are explicitly allowed with enforced=false.';

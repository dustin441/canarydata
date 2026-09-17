-- Public Conversation collection parity for every district with live entitlement.
-- Existing active social queries remain authoritative. Districts with collection
-- allowed but no active social query receive a deterministic exact-name fallback.

create or replace view public.canary_public_social_collection_queries
with (security_invoker = true)
as
with active_queries as (
  select
    search_queries.id::text as id,
    search_queries.district_id,
    coalesce(nullif(btrim(search_queries.district_name), ''), districts.name) as district_name,
    search_queries.query_text,
    'configured'::text as query_source
  from public.search_queries
  join public.districts on districts.id = search_queries.district_id
  where search_queries.active = true
    and search_queries.channels = 'social'
), entitled_fallbacks as (
  select
    'entitlement:' || districts.id as id,
    districts.id as district_id,
    districts.name as district_name,
    '"' || replace(districts.name, '"', '') || '"' as query_text,
    'active_entitlement_fallback'::text as query_source
  from public.canary_effective_district_entitlements entitlements
  join public.districts on districts.id = entitlements.district_id
  where entitlements.collection_allowed = true
    and districts.id not in ('canary-lesley-test-district', 'canary-payment-test-district')
    and not exists (
      select 1
      from active_queries
      where active_queries.district_id = districts.id
    )
)
select * from active_queries
union all
select * from entitled_fallbacks;

revoke all on table public.canary_public_social_collection_queries from public, anon, authenticated;
grant select on table public.canary_public_social_collection_queries to service_role;

comment on view public.canary_public_social_collection_queries is
  'Canonical Public Conversation collector roster: configured active social queries plus deterministic fallbacks for every district whose effective entitlement allows collection. Internal QA districts are excluded from entitlement fallback enrollment.';

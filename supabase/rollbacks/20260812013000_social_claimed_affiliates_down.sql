-- REVIEW-ONLY rollback for 20260812013000_social_claimed_affiliates.sql.

begin;

do $$
begin
  if exists (select 1 from public.social_affiliate_claims where status = 'active') then
    raise exception 'Refusing rollback while active affiliate claims exist';
  end if;
  if exists (select 1 from public.social_threads where affiliate_claim_id is not null) then
    raise exception 'Refusing rollback while Social records reference affiliate claims';
  end if;
end;
$$;

drop index if exists public.social_threads_affiliate_claim_idx;
alter table public.social_threads drop constraint if exists social_threads_affiliate_claim_district_fkey;
alter table public.social_threads drop column if exists affiliate_claim_id;
drop function if exists public.canary_revoke_social_affiliate(uuid,text,uuid,integer,text,text);
drop function if exists public.canary_claim_social_affiliate(uuid,text,uuid,text,text,text,text,text);
drop trigger if exists social_affiliate_claim_events_immutable on public.social_affiliate_claim_events;
drop function if exists public.prevent_social_affiliate_claim_event_mutation();
drop table if exists public.social_affiliate_claim_events;
drop table if exists public.social_affiliate_claims;
drop index if exists public.social_accounts_normalized_handle_uidx;
alter table public.social_accounts drop constraint if exists social_accounts_id_district_key;

commit;

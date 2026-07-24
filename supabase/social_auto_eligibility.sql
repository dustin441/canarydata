-- Canary Social: remove routine approval as the default official-post path.
-- Review this migration in Supabase SQL Editor before applying.
begin;

alter table public.social_threads
  alter column visibility_status set default 'active';

-- Existing verified official posts become report eligible automatically.
update public.social_threads thread
set visibility_status = 'active'
where thread.relationship_type = 'owned'
  and thread.visibility_status in ('review', 'approved')
  and exists (
    select 1
    from public.social_accounts account
    where account.id = thread.social_account_id
      and account.district_id = thread.district_id
      and account.platform = thread.platform
      and account.active = true
      and (nullif(btrim(account.handle), '') is not null or nullif(btrim(account.profile_url), '') is not null)
  );

commit;

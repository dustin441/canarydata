-- Canary Social: make accepted public Social visible without human approval.
-- Review this migration in Supabase SQL Editor before applying.
begin;

-- New accepted records are visible by default. Deterministic ingestion performs
-- relevance, geography, source, and duplicate checks before this lifecycle.
alter table public.social_threads
  alter column visibility_status set default 'active';

-- Existing accepted records become visible. Explicit exclusions remain hidden.
update public.social_threads
set visibility_status = 'active'
where visibility_status in ('review', 'approved');

commit;

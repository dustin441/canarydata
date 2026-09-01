begin;

do $$
begin
  if exists (
    select 1 from public.story_correction_events
    where action in ('mark_earned', 'unmark_earned')
  ) then
    raise exception 'Pre-use rollback refused: Earned Media audit history exists; use the post-use forward rollback';
  end if;
end;
$$;

drop function if exists public.canary_set_story_communications_earned(uuid, uuid, boolean, integer);
drop trigger if exists news_stories_guard_earned_source_reclassification on public.news_stories;
drop trigger if exists news_stories_guard_communications_earned_update on public.news_stories;
drop trigger if exists news_stories_guard_communications_earned_insert on public.news_stories;
drop function if exists public.canary_guard_earned_source_reclassification();
drop function if exists public.canary_guard_story_communications_earned_write();

alter table public.news_stories
  drop constraint if exists news_stories_communications_earned_external_check;
alter table public.news_stories
  drop column if exists communications_earned_updated_by,
  drop column if exists communications_earned_updated_at,
  drop column if exists communications_earned;

alter table public.story_correction_events
  drop constraint if exists story_correction_events_action_check;
alter table public.story_correction_events
  add constraint story_correction_events_action_check
  check (action in ('manual_add', 'exclude', 'restore'));

-- Restore the exact pre-migration runtime privilege surface only because this
-- rollback is permitted before any Earned audit history exists.
grant select, insert, update, delete on public.story_correction_events to service_role;

commit;

begin;

drop function if exists public.canary_add_manual_story(uuid,text,text,text,text,text,date,text,text);

create function public.canary_add_manual_story(
  p_actor_user_id uuid,
  p_district_id text,
  p_canonical_url text,
  p_link text,
  p_headline text,
  p_source text,
  p_date date,
  p_reason text,
  p_summary text default null,
  p_source_ownership text default 'external'
)
returns public.news_stories
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  existing public.news_stories;
  created public.news_stories;
  normalized_ownership text := lower(btrim(coalesce(p_source_ownership, '')));
begin
  if length(trim(coalesce(p_reason, ''))) < 10 then
    raise exception 'A correction reason of at least 10 characters is required';
  end if;
  if p_canonical_url is null or p_canonical_url !~ '^https://' then
    raise exception 'A canonical HTTPS URL is required';
  end if;
  if normalized_ownership not in ('owned', 'external') then
    raise exception 'Source ownership must be owned or external';
  end if;

  select * into existing
  from public.news_stories
  where district_id = p_district_id and canonical_url = p_canonical_url
  for update;

  if found then
    raise exception using
      message = 'A story with this canonical URL already exists',
      detail = json_build_object('story_id', existing.id, 'visibility_status', existing.visibility_status)::text;
  end if;

  insert into public.news_stories (
    district_id, canonical_url, link, headline, source, date, summary,
    source_type, source_query, is_earned_media, communications_earned,
    visibility_status, manual_override, correction_version
  ) values (
    p_district_id, p_canonical_url, p_link, p_headline, p_source, p_date, p_summary,
    'manual', 'Manual correction', normalized_ownership = 'external', false,
    'active', true, 1
  ) returning * into created;

  insert into public.story_correction_events (
    district_id, story_id, actor_user_id, action, reason,
    before_state, after_state, resulting_version
  ) values (
    p_district_id, created.id, p_actor_user_id, 'manual_add', trim(p_reason),
    null, to_jsonb(created), created.correction_version
  );

  return created;
end;
$$;

revoke all on function public.canary_add_manual_story(uuid,text,text,text,text,text,date,text,text,text)
  from public, anon, authenticated;
grant execute on function public.canary_add_manual_story(uuid,text,text,text,text,text,date,text,text,text)
  to service_role;

commit;

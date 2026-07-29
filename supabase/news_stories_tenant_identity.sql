-- Canary canonical news identity is tenant-scoped.
-- A single article can legitimately concern more than one district, so link must
-- not be globally unique. Scheduled ingestion upserts by district + canonical URL.

begin;

lock table public.news_stories in share row exclusive mode;

do $$
begin
  if exists (
    select 1
    from public.news_stories
    where canonical_url is not null
    group by district_id, canonical_url
    having count(*) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = 'Cannot enforce tenant-scoped canonical story identity while duplicate district/canonical_url groups exist.';
  end if;
end
$$;

-- This legacy constraint incorrectly prevents one source article from being
-- relevant to multiple Canary customers.
alter table public.news_stories
  drop constraint if exists news_stories_link_key;

-- Non-partial so PostgREST can infer ON CONFLICT (district_id, canonical_url).
-- PostgreSQL still permits multiple NULL canonical_url values.
create unique index if not exists news_stories_district_canonical_url_all_uidx
  on public.news_stories (district_id, canonical_url);

comment on index public.news_stories_district_canonical_url_all_uidx is
  'Canonical scheduled-ingestion identity. The same article may exist for multiple districts.';

commit;

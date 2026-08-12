create extension if not exists pgcrypto;
create schema if not exists auth;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
create table public.districts (id text primary key, name text not null);
create table auth.users (id uuid primary key, raw_app_meta_data jsonb not null default '{}'::jsonb);
create table public.social_accounts (
 id uuid primary key default gen_random_uuid(), district_id text not null references public.districts(id),
 platform text not null, platform_account_id text, handle text, display_name text, profile_url text,
 active boolean not null default true
);
create table public.social_threads (
  id uuid primary key default gen_random_uuid(), district_id text not null references public.districts(id),
  relationship_type text not null constraint social_threads_relationship_type_check check (relationship_type in ('owned','direct_tag','direct_mention','ambient')),
  published_at timestamptz not null default now()
);
create or replace function public.canary_assert_social_reviewer(p_actor_user_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public, auth as $$
begin
  if not exists (select 1 from auth.users where id=p_actor_user_id and raw_app_meta_data->>'role'='admin') then raise exception 'Canary reviewer access is required'; end if;
end;
$$;
insert into public.districts(id,name) values ('district-a','District A'),('district-b','District B');
insert into auth.users(id,raw_app_meta_data) values
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','{"role":"admin"}'),
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','{"role":"client","district_id":"district-a"}');
insert into public.social_accounts(id,district_id,platform,platform_account_id,handle,display_name,profile_url) values
 ('11111111-1111-1111-1111-111111111111','district-a','facebook','page-123','DistrictAthletics','District Athletics','https://facebook.com/DistrictAthletics'),
 ('22222222-2222-2222-2222-222222222222','district-b','facebook','page-456','OtherDistrict','Other District','https://facebook.com/OtherDistrict');
insert into public.social_accounts(id,district_id,platform,platform_account_id,handle,display_name,profile_url,active) values
 ('33333333-3333-3333-3333-333333333333','district-a','instagram','profile-789','RegistryOnlyAthletics','Registry Only Athletics','https://instagram.com/RegistryOnlyAthletics',false);

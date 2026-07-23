-- Persistent, database-atomic request windows for MELODI.
-- Apply before setting MELODI_ENABLED=true.

create table if not exists public.melodi_usage_windows (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now()
);

alter table public.melodi_usage_windows enable row level security;
revoke all on public.melodi_usage_windows from anon, authenticated;

create or replace function public.canary_check_melodi_rate_limit(
  p_user_id uuid,
  p_limit integer default 8,
  p_window_seconds integer default 600
)
returns table (allowed boolean, retry_after_seconds integer, request_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window_started timestamptz;
  v_count integer;
begin
  if p_user_id is null or p_limit < 1 or p_window_seconds < 60 then
    raise exception 'Invalid MELODI rate-limit arguments';
  end if;

  insert into public.melodi_usage_windows as usage (user_id, window_started_at, request_count, updated_at)
  values (p_user_id, v_now, 1, v_now)
  on conflict (user_id) do update
  set window_started_at = case
        when usage.window_started_at <= v_now - make_interval(secs => p_window_seconds) then v_now
        else usage.window_started_at
      end,
      request_count = case
        when usage.window_started_at <= v_now - make_interval(secs => p_window_seconds) then 1
        else usage.request_count + 1
      end,
      updated_at = v_now
  returning usage.window_started_at, usage.request_count
  into v_window_started, v_count;

  return query select
    v_count <= p_limit,
    greatest(0, ceil(extract(epoch from (v_window_started + make_interval(secs => p_window_seconds) - v_now)))::integer),
    v_count;
end;
$$;

revoke all on function public.canary_check_melodi_rate_limit(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.canary_check_melodi_rate_limit(uuid, integer, integer) to service_role;

comment on table public.melodi_usage_windows is
  'Server-only, persistent MELODI request windows used for bounded inference cost control.';

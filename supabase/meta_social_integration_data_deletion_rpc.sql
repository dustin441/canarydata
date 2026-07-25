begin;

create or replace function public.canary_complete_meta_data_deletion(
  p_provider_user_id text,
  p_provider_user_id_hash text,
  p_confirmation_code text
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  deleted_count integer := 0;
begin
  if coalesce(p_provider_user_id, '') = ''
    or coalesce(p_provider_user_id_hash, '') = ''
    or coalesce(p_confirmation_code, '') = '' then
    raise exception 'Meta deletion parameters are required';
  end if;

  delete from public.social_provider_connections
  where provider = 'meta'
    and provider_user_id = p_provider_user_id;
  get diagnostics deleted_count = row_count;

  insert into public.social_provider_deletion_requests (
    confirmation_code,
    provider,
    provider_user_id_hash,
    status,
    completed_at,
    detail
  ) values (
    p_confirmation_code,
    'meta',
    p_provider_user_id_hash,
    'completed',
    now(),
    format('Deleted %s Meta connection%s.', deleted_count, case when deleted_count = 1 then '' else 's' end)
  );

  return deleted_count;
end;
$$;

revoke all on function public.canary_complete_meta_data_deletion(text, text, text) from public, anon, authenticated;
grant execute on function public.canary_complete_meta_data_deletion(text, text, text) to service_role;

commit;

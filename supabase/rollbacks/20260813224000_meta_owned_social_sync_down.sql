begin;

-- Disable the runtime before applying this rollback.
-- This rollback removes only the additive native Meta synchronization boundary.

revoke all on function public.canary_claim_meta_sync_run(text, uuid, integer, timestamptz, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.canary_link_selected_meta_assets(text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.canary_ingest_owned_social_observation(uuid, jsonb) from public, anon, authenticated, service_role;

drop function public.canary_claim_meta_sync_run(text, uuid, integer, timestamptz, jsonb);
drop function public.canary_link_selected_meta_assets(text, uuid);
drop function public.canary_ingest_owned_social_observation(uuid, jsonb);

drop index if exists public.social_sync_runs_one_running_connection_uidx;
drop table public.social_thread_provider_observations;
drop table public.social_provider_account_links;

alter table public.social_sync_runs drop constraint if exists social_sync_runs_status_check;
alter table public.social_sync_runs add constraint social_sync_runs_status_check
  check (status in ('running','success','partial','failed'));
alter table public.social_sync_runs
  drop column if exists provider_errors,
  drop column if exists rejected_items,
  drop column if exists duplicate_items,
  drop column if exists next_cursor,
  drop column if exists lease_expires_at,
  drop column if exists heartbeat_at,
  drop column if exists diagnostics;

create or replace function public.canary_disconnect_meta_connection(
  p_connection_id uuid,
  p_district_id text,
  p_revocation_unconfirmed boolean
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_now timestamptz := now();
begin
  if not exists (select 1 from public.social_provider_connections where id=p_connection_id and district_id=p_district_id and provider='meta') then
    raise exception 'Meta connection does not belong to this district';
  end if;
  delete from public.social_account_mappings where district_id=p_district_id and provider_asset_id in (
    select id from public.social_provider_assets where connection_id=p_connection_id and district_id=p_district_id
  );
  update public.social_provider_assets set active=false, selected=false, last_seen_at=v_now
  where connection_id=p_connection_id and district_id=p_district_id;
  delete from public.social_provider_credentials where connection_id=p_connection_id and district_id=p_district_id;
  update public.social_provider_connections set status='revoked', revoked_at=v_now, updated_at=v_now,
    last_error_code=case when p_revocation_unconfirmed then 'remote_revocation_unconfirmed' else null end,
    last_error_message=case when p_revocation_unconfirmed then 'Local access was removed, but Meta revocation could not be confirmed.' else null end
  where id=p_connection_id and district_id=p_district_id and provider='meta';
  return true;
end;
$$;

create or replace function public.canary_complete_meta_data_deletion(
  p_provider_user_id text,
  p_provider_user_id_hash text,
  p_confirmation_code text
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare deleted_count integer := 0;
begin
  if coalesce(p_provider_user_id,'')='' or coalesce(p_provider_user_id_hash,'')='' or coalesce(p_confirmation_code,'')='' then
    raise exception 'Meta deletion parameters are required';
  end if;
  delete from public.social_provider_connections where provider='meta' and provider_user_id=p_provider_user_id;
  get diagnostics deleted_count=row_count;
  insert into public.social_provider_deletion_requests(confirmation_code,provider,provider_user_id_hash,status,completed_at,detail)
  values (p_confirmation_code,'meta',p_provider_user_id_hash,'completed',now(),format('Deleted %s Meta connection%s.',deleted_count,case when deleted_count=1 then '' else 's' end));
  return deleted_count;
end;
$$;

revoke all on function public.canary_disconnect_meta_connection(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.canary_complete_meta_data_deletion(text, text, text) from public, anon, authenticated;
grant execute on function public.canary_disconnect_meta_connection(uuid, text, boolean) to service_role;
grant execute on function public.canary_complete_meta_data_deletion(text, text, text) to service_role;

commit;

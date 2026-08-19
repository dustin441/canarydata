set lock_timeout = '10s';
set statement_timeout = '5min';

drop index concurrently if exists public.social_provider_metric_snapshots_latest_idx;

begin;
drop view if exists public.canary_latest_social_metric_snapshots;
commit;
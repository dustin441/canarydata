-- READ ONLY. Run after 20260819223000_social_metric_latest_view.sql.
select
  to_regclass('public.canary_latest_social_metric_snapshots') is not null as latest_view_ready,
  has_table_privilege('service_role', 'public.canary_latest_social_metric_snapshots', 'select') as service_role_select_allowed,
  not has_table_privilege('anon', 'public.canary_latest_social_metric_snapshots', 'select') as anon_select_denied,
  not has_table_privilege('authenticated', 'public.canary_latest_social_metric_snapshots', 'select') as authenticated_select_denied;

select count(*) as latest_rows
from public.canary_latest_social_metric_snapshots;
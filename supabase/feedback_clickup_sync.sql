alter table public.feedback
  add column if not exists clickup_task_id text,
  add column if not exists clickup_task_url text,
  add column if not exists clickup_synced_at timestamptz,
  add column if not exists clickup_sync_error text;

create index if not exists feedback_clickup_task_id_idx
  on public.feedback (clickup_task_id)
  where clickup_task_id is not null;

comment on column public.feedback.clickup_task_id is
  'ClickUp task ID created from this site feedback submission.';

comment on column public.feedback.clickup_task_url is
  'ClickUp task URL created from this site feedback submission.';

comment on column public.feedback.clickup_synced_at is
  'Timestamp when this site feedback row was last synced to ClickUp.';

comment on column public.feedback.clickup_sync_error is
  'Most recent ClickUp sync error for this site feedback row.';

-- Canary Social pre-migration visibility backup
-- READ ONLY. Run in the Canary production Supabase SQL Editor.
-- Downloading the normal Supabase CSV result is supported, including its quoted,
-- doubled-quote one-cell JSON representation. Raw/copy JSON remains supported.
-- The helper accepts the raw object, {"social_visibility_backup": {...}}, the
-- one-row JSON export [{"social_visibility_backup": {...}}], or that CSV download.
-- node scripts/backup-social-visibility.mjs --input <saved.json> \
--   --schema-contract <verified-contract.json> --output <protected-new-path.json>

begin transaction isolation level repeatable read read only;
set local statement_timeout = '60s';
set local lock_timeout = '5s';

select jsonb_build_object(
  'watermark', to_char(transaction_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'rows', coalesce(
    jsonb_agg(
      jsonb_build_object(
          'id', id::text,
          'district_id', district_id,
          'relationship_type', relationship_type,
          'visibility_status', visibility_status,
          'review_version', review_version,
          'reviewed_at', case
            when reviewed_at is null then null
            else to_char(reviewed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
          end,
          'reviewed_by', reviewed_by::text,
          'created_at', to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'updated_at', to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      ) order by id
    ),
    '[]'::jsonb
  )
) as social_visibility_backup
from public.social_threads;

rollback;

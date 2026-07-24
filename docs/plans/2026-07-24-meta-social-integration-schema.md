# Meta Social Integration and Account Metrics Schema

**Status:** Design proposal only. No production schema or Meta application mutation is authorized by this document.

## Goal

Let each district connect authorized Facebook Pages and associated Instagram professional accounts, map accounts to the district or individual schools, collect native post/account metrics, and reconcile monthly Canary reporting to Meta without cross-tenant access.

## Security boundary

- OAuth credentials and refreshable access tokens stay server-side and encrypted at rest.
- Browser code receives connection state and authorized page metadata, never long-lived tokens.
- Every connection, account mapping, metric row, post insight, and sync run carries `district_id`.
- Authorization derives district scope from protected application metadata, not editable user metadata.
- RLS denies cross-district reads and all direct customer token access.
- Service-role operations are restricted to server routes and ingestion workers.
- Disconnect revokes/deletes stored credentials where supported and stops future syncs.
- Store granted scopes, token expiry, last validation, and revocation reason.

## Proposed tables

### `social_provider_connections`

- `id uuid primary key`
- `district_id uuid not null`
- `provider text check (provider in ('meta'))`
- `status text check (status in ('pending','active','expired','revoked','error'))`
- `provider_user_id text`
- `encrypted_access_token text`
- `token_expires_at timestamptz`
- `granted_scopes text[]`
- `connected_by uuid`
- `connected_at timestamptz`
- `last_validated_at timestamptz`
- `last_error_code text`
- `last_error_message text`
- `revoked_at timestamptz`
- unique active connection policy per district/provider/authorized identity

### `social_provider_accounts`

- `id uuid primary key`
- `district_id uuid not null`
- `connection_id uuid not null`
- `provider_account_id text not null`
- `platform text check (platform in ('facebook','instagram'))`
- `account_type text`
- `name text`
- `handle text`
- `profile_url text`
- `parent_provider_account_id text`
- `active boolean`
- `metadata jsonb`
- unique `(district_id, platform, provider_account_id)`

### `social_account_mappings`

- `id uuid primary key`
- `district_id uuid not null`
- `provider_account_id uuid not null`
- `scope_type text check (scope_type in ('district','school','department'))`
- `scope_id uuid`
- `scope_label text not null`
- `reporting_enabled boolean default true`
- `mapped_by uuid`
- `mapped_at timestamptz`
- one active mapping per provider account

### `social_account_daily_metrics`

- `district_id uuid not null`
- `provider_account_id uuid not null`
- `metric_date date not null`
- `followers bigint`
- `net_follower_growth bigint`
- `reach bigint`
- `impressions bigint`
- `profile_views bigint`
- `views bigint`
- `metric_availability jsonb not null`
- `source_updated_at timestamptz`
- `collected_at timestamptz not null`
- primary key `(provider_account_id, metric_date)`

Unavailable metrics remain `null` with availability false. They are never coerced to zero.

### `social_post_insights`

- `district_id uuid not null`
- `social_thread_id uuid not null`
- `provider_account_id uuid not null`
- `provider_post_id text not null`
- `metric_date date not null`
- `impressions bigint`
- `reach bigint`
- `views bigint`
- `reactions bigint`
- `comments bigint`
- `shares bigint`
- `clicks bigint`
- `watch_time_seconds numeric`
- `metric_availability jsonb not null`
- `source_updated_at timestamptz`
- `collected_at timestamptz not null`
- unique `(provider_account_id, provider_post_id, metric_date)`

Preserve snapshots so monthly reports can be reproduced instead of silently changing when lifetime post metrics increase later.

### `social_sync_runs`

- `id uuid primary key`
- `district_id uuid not null`
- `connection_id uuid not null`
- `started_at timestamptz`
- `completed_at timestamptz`
- `status text check (status in ('running','success','partial','failed'))`
- `accounts_attempted integer`
- `accounts_succeeded integer`
- `posts_read integer`
- `metric_rows_written integer`
- `error_summary jsonb`
- `source_cutoff timestamptz`

## Reporting formulas

- Official posts: count of owned provider posts mapped to report-enabled official accounts.
- Interactions: sum of available reactions, comments, replies, and shares.
- Engagement rate: summed interactions divided by summed impressions, only when impressions are available and positive.
- Net follower growth: ending follower count minus beginning follower count or provider-supplied daily net growth, with method disclosed.
- District rollup: sum count metrics across mapped accounts. Deduplicate cross-posted provider IDs where Meta exposes a shared identity.
- School/page rollup: aggregate only accounts mapped to that scope.
- Completed month: first through last calendar day with successful or explicitly complete source coverage.
- Month to date: first day through the latest complete source day, clearly labeled.
- Previous comparison for month to date: equal day count in the prior month.

## Source completeness gate

For each district/month, record expected mapped accounts and successful source presence. If an expected account has no completed sync:

- mark dependent district totals incomplete;
- list the missing account;
- show unavailable rather than zero for affected metrics;
- retain unaffected post counts with a partial-data label.

## OAuth and mapping flow

1. Authenticated district administrator opens Integrations.
2. Canary creates signed state containing the protected district/user context and short expiry.
3. User authorizes the required Meta scopes.
4. Server exchanges the code and discovers authorized Pages and Instagram accounts.
5. User selects accounts and maps each to district, school, or department.
6. Canary validates access, stores encrypted credentials, and queues an initial bounded sync.
7. UI shows connection status, scopes, mapped accounts, source cutoff, and last successful sync.
8. Disconnect or revocation prevents future jobs and produces a reporting-health warning.

## Pilot

Use one consenting district with active Facebook and Instagram accounts. Keep public collection as a read-only fallback until reconciliation passes.

### Pilot acceptance criteria

- OAuth callback cannot be replayed and rejects cross-district state.
- Tokens never appear in browser payloads, logs, screenshots, or client bundles.
- Selected Pages and Instagram accounts read back correctly.
- One completed month reconciles post count, impressions, reach, interactions, and follower endpoints to native Meta totals.
- District rollup equals mapped account totals without duplicates.
- Revoking the connection changes health state and stops collection.
- Missing account/source data renders unavailable or partial, never zero.
- Admin and customer roles cannot access another district’s connection or metrics.
- Retry is idempotent and produces no duplicate daily or post-insight rows.

## Deferred

- Boosting or paid-ad creation
- Story-to-social publishing
- LinkedIn OAuth
- PESO visualization
- Public report share links
- Automated publishing

These require separate authorization, safety, and product review after read-only reporting is trusted.

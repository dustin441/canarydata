# Meta Social Integration Schema

Status: revised July 25, 2026

The earlier draft was replaced after repository and security review. The executable source of truth is:

- `supabase/meta_social_integration.sql`
- `docs/plans/2026-07-25-meta-integration-setup.md`

## First release boundary

This schema creates the server-only authorization foundation for:

- Facebook Pages
- connected Instagram professional accounts

Meta ad accounts are intentionally outside the first owned-Social authorization release. A later ad-reporting release can extend the existing asset model without broadening this release's OAuth scope.

It lets an authorized district integration manager choose which discovered assets belong to the district reporting workspace. It does not yet ingest native insight snapshots, publish content, manage comments, change advertising, or spend budget.

## Authorization

Only a protected Canary actor may manage this integration:

- platform administrator with one explicitly selected district, or
- district user whose protected `app_metadata.permissions` contains `manage_integrations`

Editable `user_metadata`, request-body roles, and request-body district assignments are never authorization sources.

## Permissions

The discovery release requests exactly:

- `pages_show_list`
- `pages_read_engagement`
- `instagram_basic`

`ads_read` is deferred to a separate ad-reporting release rather than requested by the owned-Social connection.

Insight-specific permissions are deferred until native metric ingestion is implemented and reconciled.

## Current tables

### `social_provider_oauth_states`

Stores only a SHA-256 OAuth state hash, protected user, text district ID, safe return path, expiry, and one-time consumption timestamp. An HttpOnly binding cookie and service-role-only atomic consume function prevent replay.

### `social_provider_connections`

Stores non-secret connection identity, including the authorizing Meta app ID, granted and declined scopes, lifecycle status, expiry metadata, and protected audit identity. The first release enforces one active Meta connection record per district so shared assets cannot be silently reassigned between competing connection owners.

### `social_provider_credentials`

Stores the separately encrypted long-lived user token. Encryption uses AES-256-GCM with a random IV, versioned ciphertext, and connection/district/provider AAD. Browser roles have no access.

### `social_provider_assets`

Stores allowlisted non-secret metadata for Facebook Pages, Instagram professional accounts, and ad accounts. It does not store Page access tokens or raw Meta responses.

### `social_account_mappings`

Maps selected provider assets to the authorized district. The first release supports district scope only because the repository does not yet have a canonical district-owned school/department scope table.

### `social_sync_runs`

Reserved for bounded ingestion outcome records after native metric sync is implemented.

### `social_provider_deletion_requests`

Stores privacy-safe completion records for Meta signed data-deletion callbacks.

## RLS and service boundary

All integration tables:

- use existing text district IDs with foreign keys to `districts(id)`
- have RLS enabled
- revoke all access from `anon` and `authenticated`
- are accessed only through server handlers after protected actor resolution and explicit district filters

## Future metric phase

When native reporting is implemented, add reviewed Page and Instagram insight permissions, then store reproducible daily snapshots. Missing or unsupported metrics remain unavailable, never zero. Organic Page/Instagram metrics and paid ad-account delivery remain distinct reporting populations.

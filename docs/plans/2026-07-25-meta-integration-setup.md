# Canary Meta integration setup

## Current release boundary

This owned-Social integration is read-only. Its first release requests access only to authorized Facebook Pages and connected Instagram professional accounts. Meta ad accounts, publishing, comment management, messaging, and Instagram publishing are outside this release.

## Dedicated Meta application

Use the dedicated `Canary Data` Business app owned by the Canary Data business portfolio. Do not reuse the EIC `Data Puller` app or either superseded Consumer/advertising Canary app. The production application must use the approved Facebook Login for Business configuration ID rather than a legacy scope-based Facebook Login URL.

## Meta application

Do not enable customer authorization until the customer-facing Canary configuration, app review, and pilot verification are complete.

Production values:

- App domain: `canarydata.media`
- Website URL: `https://www.canarydata.media`
- OAuth redirect URI: `https://www.canarydata.media/api/integrations/meta/callback`
- Privacy policy: `https://www.canarydata.media/privacy`
- User data deletion callback: `https://www.canarydata.media/api/integrations/meta/data-deletion`

Use Graph API `v25.0` unless a later version has been explicitly tested.

## Permissions

Request only:

- `business_management` (required by Meta's Business Pages use case; this does not grant ads access)
- `pages_show_list`
- `pages_read_engagement`
- `instagram_basic`

Add `read_insights` and `instagram_manage_insights` only with the first implemented native-insights sync, a separate permission review, and truthful metric reconciliation. Add `ads_read` only in a separate ad-reporting integration release.

For district users who are not app-role users, Meta App Review and business verification are required for advanced access. Marketing API access for other organizations' ad accounts may also require the appropriate Full Access tier.

## Database

Production base migration status: applied and verified July 25, 2026. Verification confirmed all seven tables, the original five service-role-only RPC functions, RLS on every integration table, no direct browser-role table grants, and the expected tenant and audit column types.

The post-review atomic data-deletion RPC in `supabase/meta_social_integration_data_deletion_rpc.sql` must also be applied and verified before enabling Meta. After that additive migration, the consolidated verifier expects six service-role-only RPC functions.

Apply `supabase/meta_social_integration.sql` before enabling the feature in any additional environment.

The schema intentionally exposes no anon or authenticated policies. OAuth state, tokens, connection metadata, selected assets, deletion requests, and sync runs are server-only through the Supabase service role after protected `app_metadata` district authorization.

## Production environment

Set these only in Vercel/server secrets:

- `META_INTEGRATION_ENABLED=true`
- `META_INTEGRATION_PILOT_DISTRICT_IDS=<comma-separated exact district IDs>`; the global flag alone enables nobody
- `META_APP_ID=<Canary Meta App ID>`
- `META_APP_SECRET=<Canary Meta App Secret>`
- `META_CONFIG_ID=<Canary Facebook Login for Business configuration ID>`
- `META_TOKEN_ENCRYPTION_KEY=<base64-encoded 32-byte random key>`
- `META_REDIRECT_URI=https://www.canarydata.media/api/integrations/meta/callback`

## Disabled-first migration order

Keep `META_INTEGRATION_ENABLED=false` while promoting schema and code. Apply in this order:

1. Existing base schema: `supabase/meta_social_integration.sql`
2. Owned sync: `supabase/migrations/20260813224000_meta_owned_social_sync.sql`
3. Insights: `supabase/migrations/20260814223000_meta_owned_social_insights.sql`
4. Row-RPC restriction: `supabase/migrations/20260814224500_meta_insights_restrict_row_rpc.sql`
5. OAuth attempt lifecycle CAS: `supabase/migrations/20260818190000_meta_oauth_attempt_lifecycle.sql`
6. Run `supabase/verify_meta_social_integration_consolidated.sql` and require every `passed` value to be true.

Only after the additive migration is catalog-verified, the schema-dependent application is deployed, provider configuration is verified, and an authenticated pilot passes may the global flag and exact district allowlist be enabled. This repository change does not apply production DDL or enable the pilot.

The first authorization pilot is discovery-only: it may verify OAuth, enumerate eligible Facebook Pages and connected Instagram professional accounts, save provider-asset selections, disconnect locally, and process signed Meta data deletion. Asset selection does not create canonical `social_accounts` or provider links, and `/api/integrations/meta/sync` remains hard-disabled in code. Do not release canonical Social writes until each commit is transactionally bound to both the connection lifecycle version and the provider-user deletion fence.

Reauthorization must use the same Meta provider identity already recorded for the district. The discovery pilot rejects an in-place switch to a different Meta user because overwriting that identity would erase the provenance required to honor a later deletion request for the former user. Identity replacement requires a future explicit, deletion-safe lifecycle rather than ordinary reconnect.

Ordinary district disconnect is intentionally local-only. Meta's `DELETE /me/permissions` revokes the application grant for the whole Meta user identity, so a district-scoped action must never call it. Users who intend to revoke Canary everywhere must remove Canary in Meta Business Integrations. A future in-product global revocation operation would require explicit identity-wide confirmation and provider-user-global serialization.
- `META_GRAPH_VERSION=v25.0`
- `META_NATIVE_SYNC_ENABLED=false` (currently inert because the sync route is hard-disabled pending transactional deletion fencing)

Generate the encryption key with a cryptographically secure tool. Never reuse the Meta App Secret as the encryption key.

## Pilot sequence

The introductory owned-Social baseline is capped at 90 days, followed by incremental synchronization. Longer history requires a separately approved and costed backfill rather than silently consuming recurring provider capacity.

1. Keep the Meta app in Development mode.
2. Add the pilot user's Facebook account as an app tester/developer.
3. Apply the production database schema.
4. Add protected `app_metadata.permissions: ['manage_integrations']` to the consenting pilot user. Do not place this capability in `user_metadata`.
5. Add production environment secrets.
6. Deploy Canary.
7. Sign into Canary as the consenting pilot district user.
8. Open Integrations and continue with Meta.
9. Confirm the OAuth dialog requests read-only permissions only.
10. Confirm the returned Pages and Instagram accounts match Meta Business Suite.
11. Select the intended assets. The first release maps them to the authorized district only.
12. Verify browser/network responses contain no access tokens.
13. Disconnect and confirm local credentials are removed and Meta revocation is reported.
14. Reconnect and complete one month of native reconciliation before using native Meta totals in customer reports.
15. Record the production flow for Meta App Review and request advanced access.
16. Move the app to Live only after App Review, business verification, privacy, deletion callback, tenant isolation, and reconciliation pass.

## App Review evidence

Prepare a screen recording showing:

- Canary authentication
- One protected district workspace
- The read-only explanation
- Meta authorization
- Facebook Page and connected Instagram professional-account discovery
- Asset selection and district mapping
- Reporting use of the selected assets
- Disconnect behavior

Explain separately why each permission is necessary. Do not describe planned publishing, boosting, comment replies, or ad changes because those are outside this release.

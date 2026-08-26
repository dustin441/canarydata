# Canary Direct Meta District-Pilot Readiness

Date: 2026-08-26
Baseline production commit reviewed: `39020550a7bd67b29c897a1d5c0a0ca6806a12d5`
Canonical production project: `fehdonfrlsrrkzaemkxp`

## Verdict

District-ready code is undergoing protected release verification. No external district is authorized or connected. The existing controlled test proves the technical provider path but is not a customer rollout.

## Verified on the production baseline

- Explicit district-bound integration authorization is enforced.
- Administrators cannot implicitly inherit the first district.
- OAuth state is one-time, expires, and captures the expected connection lifecycle version.
- Callback preparation/finalization is transactionally fenced against reconnect, disconnect, and deletion races.
- Page and linked Instagram discovery are represented as exact tenant-owned assets.
- Page access tokens are not stored during discovery.
- Provider tokens are encrypted at rest and are not returned through browser status endpoints.
- Browser roles have no direct table access; protected RPCs are service-role only.
- Canonical observations and metric writes are tenant-bound and deletion/disconnect fenced.
- The latest controlled bounded synchronization succeeded for two accounts with 33 posts read, 90 metric rows written, zero provider errors, and idempotent convergence evidence.
- No real customer or explicitly authorized external pilot appears in the source tasks.

## Confirmed baseline defects addressed by this patch

- Required permission constants now match released Facebook and Instagram reporting and remove unnecessary `business_management`.
- Meta's separate data-access deadline is persisted and exposed as the earlier reconnect deadline.
- Token/app/user/permission health is persisted with optimistic lifecycle comparison.
- Pending, permission-limited, expired, error, and revoked states remain visible and reconnectable.
- The authenticated pilot sync route is limited to one explicit platform and two items.
- Pilot canonical activation uses an exact asset-scoped fenced RPC only after current Meta Page tasks and the exact linked Instagram professional-account ID are revalidated; other selected or stale assets cannot activate as a side effect.
- Scoped pilot activation follows the provider-user, district, then connection-row lock order used by deletion fencing.
- Normalized provider failures remain retryable and are exposed through sanitized connection health.
- Signed deletion requests require a valid issued-at value; new stale requests fail.
- Signed deletion requests are atomically deduplicated by a canonical verified-HMAC fingerprint; alternate Base64URL encodings converge to the original receipt without deleting a later grant.
- Delayed deletion requests preserve connections whose authorization time is newer than the signed request issuance time, while receipt `completed_at` remains the actual processing time.
- OAuth prepare uses provider issuance time through a versioned RPC without changing externally reported completion semantics.
- Historical completed deletions no longer poison a genuinely newer OAuth authorization generation.
- Transient token-introspection, provider, and persistence failures preserve retry eligibility; permanent identity, expiry, and permission states remain explicit.
- Saving an empty or reduced asset selection transactionally deactivates stale canonical links/accounts.
- OAuth rediscovery deactivates prior canonical links/accounts in the same finalization transaction.
- Sync runs the fenced linker even for empty selections, preventing stale account activation.

## Automated release evidence

- `npm run test:meta`: pass, eight suites
- `npm run test:authz`: pass, three suites
- Targeted ESLint on changed JavaScript/MJS files: pass
- `npm run build`: pass
- `npm audit --omit=dev`: zero vulnerabilities
- PostgreSQL OAuth lifecycle/race rehearsal: pass
- PostgreSQL owned-sync/deletion/disconnect/unselection rehearsal: pass
- Reverse-order application rollback rehearsal: pass
- Independent post-fix review: pending

## Still configuration-dependent

The Meta developer console must be verified before an external user authorizes:

- App is Live
- Business ownership and verification are correct
- App domains include the Canary production domain
- Login for Business configuration ID matches production
- Exact configuration permissions are the approved read-only set
- Advanced Access/App Review is approved for every required permission
- External users outside app roles can authorize
- OAuth redirect URI exactly matches production
- Public data-deletion callback and status behavior are configured
- Privacy-policy and terms URLs are valid
- Consent-screen branding identifies Canary Data clearly

## Still production-release-dependent

- Apply the two additive pre-deploy migrations in order while legacy RPCs remain callable.
- Insert and read back migration-history versions for each completed phase.
- Confirm current controlled connection, credential, asset, mapping, link, observation, metric, and sync-history counts are unchanged.
- Run `verify_meta_social_integration_pre_cutover.sql` and require every check to pass.
- Deploy and verify the exact tested commit.
- Apply `20260826140000_meta_legacy_rpc_cutover.sql` only after callback/status smoke tests pass.
- Run the final consolidated verifier with every check true.
- Perform authenticated production UI QA without touching or synchronizing excluded assets.

## Still external-authorization-dependent

Required before a district pilot:

- Dustin's explicit pilot-district choice
- Canary tenant ID
- Authorized district Meta administrator name/contact
- Written consent
- Exact official Facebook Page
- Exact linked Instagram professional account, if any
- Approved asset list and QA window
- Approved two-post-per-platform bounded read
- Meta Business Suite reconciliation contact

Suggestions in task comments do not constitute authorization.

## Controlled test versus district pilot

The controlled test already establishes:

- Provider connectivity
- Facebook and linked Instagram discovery
- Encrypted credential use
- Bounded read and canonical write
- Metric persistence
- Zero-error execution
- Repeat convergence

A district pilot must additionally establish:

- An external authorized administrator outside the original controlled identity
- Consent-screen and app-review behavior for an external user
- Exact real-district Page/Instagram ownership
- Cross-tenant isolation using a separate QA tenant
- Permission denial and reconnect recovery
- Unselection, disconnect, and deletion lifecycle behavior
- Meta Business Suite reconciliation
- Temporary actor-lane shutdown with no duplicate collection or recurring paid-provider cost
- Recurring monitoring and rollback readiness

## Status rules

- Direct Meta integration task remains In Progress until schema, deployment, production QA, and Meta-console gates pass.
- Meta connection-status task remains In Progress until all lifecycle states and reconnect paths pass authenticated production QA.
- Controlled Meta pilot remains In Progress until an explicitly authorized district completes the bounded pilot and reconciliation.

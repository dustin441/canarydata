# Canary Direct Meta District Pilot Runbook

Status: protected operator procedure. This runbook does not authorize a district or a Meta administrator.

## Release prerequisites

Do not begin district authorization until all of the following are true:

- The production Supabase project is exactly `fehdonfrlsrrkzaemkxp`.
- The tested application commit and production deployment are recorded.
- Migrations `20260826130000_meta_connection_health.sql` and `20260826133000_meta_deletion_and_selection_lifecycle.sql` have passed rehearsal and production verification.
- Post-deploy cutover migration `20260826140000_meta_legacy_rpc_cutover.sql` is reserved until the v2 deployment is healthy.
- `npm run test:meta`, `npm run test:authz`, targeted ESLint, `npm run build`, and the production dependency audit pass.
- Meta is Live and Login for Business shows exactly six approved configuration entries: configuration-only `business_management` plus the five runtime-required read-only data scopes.
- The district and Meta administrator are explicitly authorized in writing.
- The exact Facebook Page and linked Instagram professional account are recorded before OAuth.
- The temporary actor lane and any paid provider schedule for those exact assets are identified.

## Required authorization record

Record without storing passwords or tokens:

- District legal/display name and Canary tenant ID
- Meta administrator name and contact
- Written consent timestamp and source
- Facebook Page name, URL, and provider ID
- Linked Instagram professional account name and provider ID, or explicit `none`
- Confirmation the administrator controls the Page and has an analytics-capable Page task
- Approved QA window
- Approved two-post-per-platform bounded read
- Meta Business Suite reconciliation contact
- Rollback owner

Never request or retain a Meta password, access token, app secret, encrypted credential, or credential screenshot.

## Least-privilege permission gate

The intended read-only release permissions are:

- `pages_show_list`
- `pages_read_engagement`
- `instagram_basic`
- `read_insights`
- `instagram_manage_insights`

The immutable Business Integration System User configuration also includes `business_management`, which Meta requires for this token model. Canary does not call Business Manager APIs and does not treat it as a runtime-required data scope.

Do not proceed if consent requests publishing, messaging, moderation, advertising, or any permission beyond these six configuration entries. Capture the permission names shown by Meta, not credential values.

## Pre-mutation evidence

Before the first production mutation, capture:

- Production deployment ID and commit
- Migration-history rows
- Definitions, owners, and grants for all affected RPCs
- Connection, credential, asset, mapping, link, account, sync-run, deletion-request, observation, and metric counts for the authorized tenant only
- Duplicate canonical post count for the exact selected assets
- Running and stale synchronization lease count
- Current temporary actor-lane status and last successful collection timestamp
- Paid provider schedule/status for the exact assets

Store counts and IDs only. Do not copy provider content, customer data, tokens, or encrypted credentials into the evidence artifact.

## OAuth and exact asset selection

1. Sign in as an authorized Canary district integration manager.
2. Confirm the integrations page is bound to the explicit district.
3. Start Meta authorization from that district only.
4. Confirm Meta displays the expected Canary Data app and exactly the approved six-entry configuration: configuration-only `business_management` plus the five runtime-required read-only data scopes.
5. Complete authorization as the approved Meta administrator.
6. On callback, verify the connection is visible for the same district only.
7. Verify provider identity, token deadline, data-access deadline, permission health, and last validation are present without exposing credentials.
8. Compare every discovered Page with Meta Business Suite.
9. Verify linked Instagram accounts are attached to the correct parent Page.
10. Select only the pre-authorized Page and linked Instagram account.
11. Save the selection and read it back.
12. Confirm unselected assets have no active mapping or canonical provider-account link.
13. From a different tenant, verify the connection and assets are inaccessible.

Stop if ownership, parent-child mapping, tenant binding, permission scope, or identity differs from the authorization record.

## Move from temporary actor lane to Meta primary

The two collection lanes must never run concurrently for the same official asset.

1. Record the temporary lane's last successful collection timestamp and provider object IDs.
2. Pause its schedule for the exact Facebook and Instagram assets.
3. Verify there is no running execution or queued retry for those assets.
4. Disable recurring paid-provider collection for those exact assets.
5. Preserve the temporary lane configuration for rollback, but do not leave it scheduled.
6. Confirm Meta asset selection is saved and tenant-bound.
7. Run the bounded Facebook pilot.
8. Run the bounded Instagram pilot only when an approved linked professional account exists.
9. Do not enable recurring Meta collection yet.

## Bounded initial synchronization

Run one platform at a time. The pilot route is hard-capped at two provider items.

For each platform, record only sanitized output:

- Status
- Accounts attempted and succeeded
- Posts read
- Metric rows written
- Rejected items
- Provider errors
- Duplicate items
- Continuation required
- Sync-run ID from server-side evidence

Verify:

- Exactly one selected platform asset was attempted.
- No unselected asset was linked or written.
- Every canonical row belongs to the authorized district and selected account.
- Every observation and metric is linked to the correct provider-account link.
- No credential or provider token appears in logs, URLs, errors, or artifacts.

## Idempotent repeat synchronization

1. Repeat the same bounded platform call against the same source window.
2. Confirm no duplicate canonical post is created.
3. Confirm provider observations converge on the existing canonical post.
4. Confirm metric snapshots follow the expected effective-time uniqueness rules.
5. Confirm manually excluded/reviewed visibility is preserved.
6. Compare sanitized counts and IDs with the initial run.

Do not enable recurring collection if the repeat creates duplicate canonical content, changes tenant/account ownership, or loses review state.

## Business Suite reconciliation

With the authorized administrator:

- Compare selected Page and Instagram identities.
- Compare the two sampled posts or media objects.
- Compare supported account/content metrics for the same reporting period.
- Record expected Meta availability limitations separately from provider errors.
- Treat missing, stale, or mismatched raw-source evidence as a failed gate.

## Health and recovery QA

Verify each state remains visible to authorized administrators and inaccessible cross-tenant:

- `pending`: abandon or restart safely after expiry
- `active`: current scopes and reconnect deadline visible
- `needs_permissions`: missing scopes visible and reconnect available
- `expired`: earlier token/data-access deadline visible and reconnect available
- `error`: safe error code/message visible and reconnect available
- `revoked`: disconnected history visible and reconnect available

Exercise reconnect without changing the provider identity. Confirm stale callbacks and stale health writers cannot overwrite newer lifecycle state.

## Unselection, disconnect, and deletion

### Unselection

- Unselect one asset and read back mappings.
- Confirm its provider-account link and orphaned canonical account become inactive in the same transaction.
- Unselect all assets and confirm no active Meta links/accounts remain.
- A later sync attempt must not reactivate unselected assets.

### Disconnect

- Capture pre-disconnect counts and grants.
- Disconnect locally for the explicit district.
- Confirm credentials are deleted, assets unselected/inactive, mappings removed, links inactive, and canonical accounts disconnected.
- Confirm in-flight or later writes fail after the lifecycle fence.
- Confirm the disconnected state remains visible and recoverable.

### Meta deletion callback

Use only an approved dedicated test identity. Do not submit a deletion against a real district during routine pilot QA.

- A new signed request outside the freshness window must fail.
- The first fresh signed request must complete transactionally and return a durable receipt.
- A byte-for-byte replay must return the original receipt without deleting a newer grant.
- A newer authorization after completed deletion must pass the generation-aware write fence.
- The public status URL must return the durable receipt without exposing user or credential data.

## Enable Meta primary

Enable recurring Meta collection only after:

- Initial and repeat bounded syncs pass
- Meta Business Suite reconciliation passes
- Cross-tenant negative tests pass
- Temporary and paid-provider lanes are confirmed inactive
- Health monitoring is active
- Rollback evidence is complete

Record the activation timestamp and exact selected asset IDs. Monitor the first recurring execution and maintain an observation window before closing temporary-lane infrastructure.

## Monitoring and stop conditions

Alert on:

- Permission loss or token/data-access deadline
- Provider identity/app mismatch
- Repeated provider errors
- Stale or overlapping sync leases
- Partial runs without continuation
- Duplicate canonical posts
- Writes after unselection, disconnect, or deletion
- Unexpected active paid-provider jobs for Meta-primary assets

Stop immediately for tenant/security exposure, a customer unable to authenticate, a broad production outage, or billing/activation failure. Queue unrelated defects for later triage.

## Rollback

Application rollback order:

1. Disable the district pilot allowlist and recurring Meta collection.
2. Verify no Meta sync is running.
3. Apply `20260826140000_meta_legacy_rpc_cutover_down.sql` before restoring an application that calls legacy RPCs.
4. Roll back the application deployment to the recorded prior deployment.
5. Leave the two additive migrations in place unless application compatibility explicitly requires their reverse-order emergency rollbacks.
6. Verify credentials, connection state, asset selection, and historical reporting counts.
7. Keep hardened deletion evidence and generation-aware fences unless an emergency compatibility rollback explicitly requires otherwise.
8. Restore the temporary actor lane only after confirming Meta primary is inactive and no execution is queued.
9. Verify only one collection lane is scheduled.

## Completion evidence

A district pilot is complete only when the ClickUp record contains:

- Written district/admin authorization
- Exact selected asset IDs
- Tested commit and deployment ID
- Migration IDs and verifier result
- Initial and repeat sync-run IDs and sanitized counts
- Business Suite reconciliation result
- Tenant-isolation and lifecycle QA results
- Temporary-lane shutdown and cost verification
- Rollback evidence
- Remaining blockers, if any

A controlled internal test is technical evidence only and does not constitute a real-customer rollout.

# District-claimed affiliate foundation

Status: Review-only design. Do not apply to production until schema review, target verification, backup, disposable-record QA, and rollback rehearsal pass.

## Goal

Allow a Canary administrator to register an exact school, athletics, fine arts, CTE, booster, foundation, PTO/PTA, club, or program account as part of a district's communications ecosystem without misrepresenting it as a central-district-controlled account.

## Smallest safe first slice

The first slice is an additive account registry and immutable audit trail. It does not automatically reactivate excluded posts, start provider collection, or alter client-visible records.

### New registry

`social_affiliate_accounts` stores:

- protected `district_id`
- platform
- exact provider account ID when available
- normalized handle
- display name and safe profile URL
- affiliate type
- active/removed status
- verification source and note
- verifying Canary administrator and timestamp
- optimistic `claim_version`

### Immutable audit

`social_affiliate_account_events` stores each claim, update, and removal with before/after state, actor, idempotency key, and resulting version. Direct update/delete of audit rows is prohibited.

### Thread relationship

`social_threads.relationship_type` gains `affiliate`. This identifies content published by a verified claimed-affiliate account. It remains distinct from `owned`, `direct_tag`, `direct_mention`, and `ambient`.

The registry does not bulk-change existing threads. Previously excluded affiliate posts remain excluded until an exact account is verified and a separately reviewed, backed-up correction plan identifies the exact rows to reclassify.

## Authorization

- Only protected Canary administrators may claim, edit, or remove affiliate accounts in v1.
- Server actions re-read the actor from Supabase Auth `app_metadata`.
- Database RPCs independently validate the actor through `canary_assert_social_reviewer`.
- Direct table access remains revoked from `anon` and `authenticated`.
- Service-role use is server-only.

## Concurrency and identity

- The database serializes account mutations with a transaction-scoped advisory lock derived from district, platform, provider account ID, and normalized handle.
- Active account IDs are unique per district/platform.
- Active normalized handles are unique per district/platform.
- Mutations require the exact expected `claim_version`.
- Every request carries a deterministic idempotency key.
- A stale editor receives an explicit version error and cannot overwrite a newer claim.
- Removal is soft deletion. It never deletes audit history or silently changes Social records.

## Reporting behavior

- `owned`: central-district publishing performance.
- `affiliate`: district-ecosystem content, shown separately.
- `direct_tag`, `direct_mention`, `ambient`: Public conversation.
- Affiliate metrics must not be blended into central-district publishing totals.
- Affiliate posts may contribute to Strategic Alignment, emerging-issue, reputation, and future convergence signals.

## Release sequence

1. Review migration and rollback SQL.
2. Prove the Canary Supabase project/key boundary.
3. Back up current social schema, counts, and existing account/thread rows.
4. Apply to a disposable PostgreSQL/Supabase fixture.
5. Test duplicate claims, stale updates, remove/reclaim races, idempotent retries, invalid URLs, invalid platform/type, and audit immutability.
6. Apply to Canary production only through the approved SQL Editor or verified migration credential.
7. Read back constraints, functions, grants, and zero-row baseline.
8. Add server actions and admin UI only after deployed schema readback passes.
9. Pilot one exact affiliate account with no provider collection.
10. Verify client/admin tenant boundaries, then remove the disposable claim and confirm immutable audit evidence.
11. Rehearse rollback before enabling collection or reclassifying historical rows.

## Rollback boundary

The rollback refuses to proceed while active affiliate claims or affiliate-classified threads exist. Operators must first remove claims and separately restore/reclassify affected threads through an audited plan. This prevents rollback from erasing active business state.
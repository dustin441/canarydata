# Claimed-affiliate controlled release plan

Status: Prepared, not authorized for production

## Current boundary

- Application code, additive migration, rollback, server actions, admin-only registry UI, and tests are prepared locally.
- No Canary production schema change has been applied.
- No affiliate account has been claimed.
- No excluded or active Social record has been reclassified.
- No provider collection has been started or expanded.
- Repository changes have not been pushed because the required explicit Canary `push` authorization has not been given.

## Pre-deployment gate

1. Independently review the complete diff, including earlier Auburn and Social policy changes already in the worktree.
2. Confirm the target Canary Supabase project reference from the live URL and harmless core-table reads.
3. Export current `social_accounts`, `social_threads`, `social_review_events`, constraints, functions, and grants.
4. Record canonical News and Social counts by district, relationship, and visibility.
5. Confirm the reviewed migration and rollback checksums.
6. Re-run quality, Social, authorization, PostgreSQL migration, lint, build, and diff checks.

## Production sequence

1. Apply `supabase/migrations/20260812013000_social_claimed_affiliates.sql` through the approved Canary Supabase SQL Editor.
2. Read back:
   - both new tables
   - active identity indexes
   - immutable audit trigger
   - RPC definitions and grants
   - expanded `social_threads.relationship_type` constraint
   - zero affiliate claims and zero affiliate-classified threads
3. Deploy the application commit to Canary `main` and wait for Vercel readiness.
4. Verify the public route, admin authentication, client authentication, and one-district Social view.
5. Confirm clients cannot receive affiliate registry data and cannot invoke claim/remove operations.
6. In admin Social, verify the claimed-affiliate manager appears only for one selected district.

## Controlled pilot

1. Select one exact district-confirmed affiliate account.
2. Record exact account ID/handle, profile URL, verifier, and verification evidence.
3. Claim the account in the admin UI.
4. Read back the registry row and immutable event.
5. Retry the same request key and verify no duplicate.
6. Verify the client Social totals and existing records do not change.
7. Remove the claim and verify soft removal plus immutable audit.
8. Reclaim only after pilot acceptance.

## Rollback rehearsal

- With no active claim and no affiliate-classified thread, apply the down migration in a disposable fixture and verify the original relationship constraint.
- Production rollback must refuse while an active claim or affiliate-classified thread exists.
- If rollback becomes necessary after pilot activity, first soft-remove claims, back up evidence, and reclassify any affiliate threads through a separately approved correction plan.

## Post-pilot work, not included in this release

- Provider collection for claimed affiliates
- Historical affiliate reactivation or backfill
- Affiliate content reporting and convergence cards
- Customer self-service claiming
- District user permission delegation
- Automatic account inference or bulk claiming

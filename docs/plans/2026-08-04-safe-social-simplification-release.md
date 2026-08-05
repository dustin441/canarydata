# Safe Social Simplification Release Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Simplify Canary Social and remove approval gating without changing authentication, exposing hidden content, mixing official performance with public mentions, or requiring an all-at-once production release.

**Architecture:** Separate UI, lifecycle, schema/data migration, writer, compatibility, and cutover work into independently verified stages. Production remains on commit `6fa872818bf729b0979d30ecfa8aaba44836bd09` until preview, schema, compatibility, exclusion replay, and rollback evidence pass. The database owns visibility transitions and exclusion preservation atomically. Every production mutation has a retained N-1 artifact, fingerprint, checksum, and executable reversal path.

**Tech Stack:** Next.js, Supabase Auth/PostgREST/PostgreSQL, n8n Cloud, Vercel Git deployments, Playwright, Node test scripts.

---

## Release invariants

- Do not modify `/login`, middleware, Supabase Auth metadata, tenant resolution, billing access gates, or Vercel environment variables as part of Social work.
- The production Auth preflight is canonical, strictly read-only, and uses only the three named production variables in Task 2.
- `excluded` always wins over ingestion replay. The authoritative writer path enforces this in one database statement, never with a read followed by an upsert.
- Both owned and public `active` rows are client-visible. Only verified owned/official rows are eligible for official performance calculations.
- Status is a visibility lifecycle field, not proof of ownership or official-report eligibility.
- Immutable audit events and optimistic `review_version` checks are required for every hide and restore mutation.
- No direct production data or n8n mutation occurs before preview approval.
- During production cutover, all affected writers remain quiesced through migration, application promotion, and signed role smoke tests.
- A release is not complete until signed-in admin and client production smoke tests pass, bounded writer canaries pass, and exactly one trigger per source/district is proven.
- Any failed cutover check starts the rehearsed rollback immediately. Exact N-1 cannot be claimed until schema, data, application, and writer state are restored and verified.

## Canonical status, visibility, and reporting contract

The backup taken immediately before the cutover watermark is authoritative for rollback of every preexisting row. Forward migration is deterministic for every ownership class:

| Pre-cutover status | Ownership/classification | Forward status | Client visibility after N | Official performance eligibility |
| --- | --- | --- | --- | --- |
| `review` | Verified owned/official | `active` | Visible | Eligible if all existing official-source verification rules pass |
| `review` | Public/ambient | `active` | Visible | Never eligible from status alone |
| `approved` | Verified owned/official | `active` | Visible | Eligible if all existing official-source verification rules pass |
| `approved` | Public/ambient | `active` | Visible | Never eligible from status alone |
| `active` | Verified owned/official | `active` | Visible | Eligible if all existing official-source verification rules pass |
| `active` | Public/ambient | `active` | Visible | Never eligible from status alone |
| `excluded` | Verified owned/official | `excluded` | Hidden | Ineligible |
| `excluded` | Public/ambient | `excluded` | Hidden | Ineligible |

The inverse policy is not a lossy status substitution. On rollback, every row present in the cutover backup is restored to its exact backed-up status and backed-up fields, so a preexisting `review` row returns to `review`, a preexisting `approved` row returns to `approved`, and existing `active` and `excluded` rows remain exact. For rows created after the cutover watermark:

1. Capture every created or changed row in a post-watermark change set before rollback, with IDs, tenant, source, ownership, payload checksum, status, `review_version`, audit IDs, and timestamps.
2. Preserve real content. Replay it through the N-1 writer contract using its source identity and idempotency key, mapping N-created `active` content to the N-1 creation status and retaining `excluded` as excluded. Reconcile IDs and checksums after replay.
3. Do not delete post-watermark rows during generic rollback, including rows labeled as QA fixtures. Replay every row through the N-1 writer contract from sealed source identity and audit evidence; any row that cannot be replayed blocks exact rollback.
4. Retain the pre-cutover backup, post-watermark change set, replay results, and unresolved reconciliation failures. Any unresolved row blocks exact N-1 and keeps writers quiesced.

### Task 1: Rebuild the feature from the stable production baseline

**Objective:** Prevent the rejected mixed release from being reused as-is.

**Files:**
- Create a fresh feature worktree from `origin/main` after confirming it equals stable commit `6fa8728`.
- Reference only: `/opt/data/worktrees/canary-social-simplify`

**Steps:**
1. Fetch origin and verify `origin/main` before creating a new branch.
2. Create `feat/social-simplification-v2` in a new worktree.
3. Do not cherry-pick `729da75a8981a3cd2084ae3e34c9a5af73152676`, any descendant of it, or any other rejected commit. Do not copy a whole file from the rejected worktree. Starting from baseline `6fa872818bf729b0979d30ecfa8aaba44836bd09`, manually reimplement only the named `Approved candidate for later manual reapplication` hunk families in `2026-08-04-social-v2-diff-inventory.md`:
   - exclusion-preservation test intent in `scripts/test-social-monitoring.mjs`, implemented against the Task 4 atomic contract rather than incomplete event pagination;
   - `Overview`, `Posts & mentions`, hide/restore, correction-history, and matching style assertions in `scripts/test-social-review.mjs`;
   - monthly-report and report-copy markers in `scripts/test-social-review.mjs`, while preserving owned-only calculations;
   - approval/action-filter import cleanup required by approved UI changes in `src/app/dashboard/DashboardClient.js`;
   - replacement of visible review, approval, selection, and bulk-approval controls with authorized hide/restore correction controls in `src/app/dashboard/DashboardClient.js`;
   - collapsed optional analyst note, with unavailable metric-card removal reviewed independently, in `src/app/dashboard/DashboardClient.js`;
   - `Overview` and `Posts & mentions` tabs plus compact-feed default in `src/app/dashboard/DashboardClient.js`;
   - Action Queue UI and action-filter removal in `src/app/dashboard/DashboardClient.js`, without changing data or advisory semantics;
   - review-audit to correction-history presentation in `src/app/dashboard/DashboardClient.js`, without hiding event types;
   - minimal Communications Brief navigation/copy changes required by the approved Social UI in `src/app/dashboard/DashboardClient.js`; and
   - Social page-tab, analyst-details, correction-control, and matching mobile styles in `src/app/globals.css`.
4. Treat every `Requires independent redesign` family as new work in its assigned later task and every `Forbidden/out-of-scope` family as prohibited.
5. Reject all auth, middleware, billing, credential, tenant-resolution, or unrelated dashboard changes.
6. Before the first implementation commit, run `git diff --check`, review `git diff --name-only`, and map every changed hunk to one allowlisted family and assigned task.

**Gate:** Attach a hunk-by-hunk allowlist map. Every manually reimplemented rejected-diff hunk maps to one named approved-candidate family, no whole file was copied, rejected SHA `729da75` is absent from branch ancestry, and no unlisted or forbidden hunk is present.

### Task 2: Add credential and authentication preflight checks

**Objective:** Detect revoked or mismatched production credentials before any release action.

**Files:**
- Create: `scripts/preflight-production-auth.mjs`
- Test: `scripts/test-production-preflight.mjs`

**Steps:**
1. Make the production preflight strictly read-only and require exactly `CANARY_PROD_SUPABASE_URL`, `CANARY_PROD_SUPABASE_ANON_KEY`, and `CANARY_PROD_SUPABASE_SERVICE_ROLE_KEY`. Do not fall back to generic or legacy names.
2. Validate the Supabase project reference and anonymous key through `/auth/v1/settings` without printing credentials.
3. Validate the service-role credential with a bounded existing-user admin list, then call `auth.admin.getUserById` for one returned existing user. Do not create, update, invite, or delete any record.
4. Compare fingerprints of the three canonical variables with corresponding Vercel production variables. Log only variable names and match/mismatch status.
5. Fail closed on 401, project mismatch, missing canonical variable, empty verification set, or Vercel fingerprint mismatch.

**Gate:** The canonical read-only preflight exits 0 immediately before preview and production promotion.

### Task 3: Implement the UI simplification without changing visibility

**Objective:** Ship the simpler Social presentation independently from the data contract.

**Files:**
- Modify: `src/app/dashboard/DashboardClient.js`
- Modify: `src/app/globals.css`
- Test: `scripts/test-social-review.mjs`

**Steps:**
1. Write failing source/UI tests for `Overview` and `Posts & mentions` tabs.
2. Remove normal approval-oriented controls and approval/bulk-approval entry points from the visible UI, but do not delete N-1-compatible server RPCs yet.
3. Keep authorized `Hide as irrelevant` and restore controls, owned/public labels, immutable correction history, and report exports.
4. Keep all reads and reporting semantics on the existing contract in this UI-only slice.
5. Run Social tests, targeted ESLint, build, and desktop/mobile Playwright QA.
6. Deploy only this UI slice to a Vercel preview.

**Gate:** Authenticated admin and client preview sessions load normally, tenant navigation is unchanged, and no data-contract change is included.

### Task 4: Implement the final lifecycle and atomic writer contract

**Objective:** Establish one authorized, versioned database lifecycle and one atomic ingestion path before data migration.

**Files:**
- Modify: `src/app/actions.js`
- Modify: `src/lib/socialIngestion.mjs`
- Modify: `scripts/ingest-social-pilot.mjs`
- Create: `supabase/migrations/<timestamp>_social_visibility_lifecycle.sql`
- Test: `scripts/test-social-lifecycle.mjs`
- Test: `scripts/test-social-exclusion-replay.mjs`
- Test: `scripts/test-social-monitoring.mjs`

**Lifecycle contract:**
- Hide accepts only lifecycle-eligible `review`, `approved`, or `active` statuses and transitions them to `excluded`.
- Restore accepts only `excluded` and transitions it to `active`.
- Admin/district authorization and tenant predicates remain mandatory.
- The caller supplies expected `review_version`; stale versions fail with a typed conflict and no row or audit mutation.
- Every successful state change increments `review_version` once and appends one immutable audit event in the same transaction.
- Double-submit with the same idempotency key returns the first outcome without a second version increment or audit event. A conflicting reused key fails closed.
- Client reads remain `active`-only. Legacy approval RPCs remain temporarily available for exact N-1 application rollback compatibility, but normal N UI entry points are removed. Their authorization cannot be weakened.

**Atomic ingestion contract:**
- Add a timestamped database RPC or equivalent single-statement upsert that inserts new eligible content with the N status and, on conflict, preserves stored `excluded` atomically while updating allowed non-lifecycle fields.
- A read-then-upsert sequence is prohibited. Both `scripts/ingest-social-pilot.mjs` and every staged n8n writer in Task 6 must call the same authoritative contract.
- Because the database contract is authoritative, do not add incomplete event-pagination visibility filters to `src/lib/data.js` or `src/app/api/melodi/route.js`. Keep their existing active-only reads unchanged unless a separately designed and tested database-side visibility contract is approved.
- Do not edit `supabase/social_auto_eligibility.sql` or `supabase/social_review_workflow.sql` in place. All function, trigger, grant, and RPC changes must be in the timestamped migration.

**Steps:**
1. Write failing tests for authorized hide/restore, eligible source states, active-only client reads, immutable audit events, and exact version changes.
2. Add cross-tenant denial tests for admin and client contexts, stale-version conflicts, repeated/double submissions, idempotency-key conflicts, and failed-transition audit absence.
3. Write failing insert, hide, replay, restore, and replay-again tests against the atomic writer RPC for owned and public rows.
4. Implement the lifecycle migration/RPC definitions and update `src/app/actions.js` to use only that mutation contract.
5. Implement the single-statement ingestion RPC/upsert and update the direct writer to call it.
6. Run tests under signed admin/client roles and verify no legacy approval control remains in the normal N UI.

**Gate:** All lifecycle, cross-tenant, stale-version, idempotency, audit, visibility, and exclusion-replay tests pass. No default-active writer change or data migration may proceed until the database-atomic exclusion contract is proven.

### Task 5: Prepare reversible schema and data migrations

**Objective:** Move to the N schema and deterministic status mapping while preserving executable restoration of exact N-1 schema and rows.

**Files:**
- Create: `supabase/migrations/<timestamp>_social_visibility_active.sql`
- Create: `supabase/rollbacks/<timestamp>_social_visibility_active_down.sql`
- Create: `supabase/verify_social_visibility_contract.sql`
- Create: `scripts/capture-social-schema-contract.mjs`
- Create: `scripts/backup-social-visibility.mjs`
- Create: `scripts/restore-social-visibility.mjs`
- Test: `scripts/test-social-visibility-migration.mjs`

**Steps:**
1. Before implementation, identify an approved, audited SQL/DB execution channel capable of forward migration, reverse migration, catalog inspection, and transaction-safe verification. If no approved channel exists, fail closed before implementing or releasing schema changes.
2. Capture an N-1 schema-contract artifact and fingerprint for affected column definitions/defaults, check/foreign-key/unique constraints, functions including exact definitions and privileges, triggers, indexes, table/function grants, and RLS-related grants/policies where affected. Capture schema identity, migration state, timestamp, and tool version.
3. Export every affected preexisting row with ID, tenant, ownership/classification, all migration-touched fields, exact prior status, `review_version`, timestamps, and a canonical row checksum. Record the cutover watermark, row count, aggregate checksum, backup location, and immutable artifact checksum.
4. Make the forward migration map valid existing `review` and `approved` rows to `active`, retain `active`, retain `excluded`, and change only the approved default/contracts. It must not infer official eligibility from status.
5. Make the reverse migration restore the complete exact N-1 schema, including reversal of Task 4 lifecycle/RPC objects and Task 5 defaults/data-contract objects, plus exact N-1 defaults, constraints, function definitions, triggers, indexes, and grants. It must also support the exact-row restore script and the post-watermark inverse policy defined above.
6. Run forward migration against a disposable N-1 copy. Execute `supabase/verify_social_visibility_contract.sql` and the Node capture script to compare expected N fingerprints, status-by-ownership counts, row checksums, exclusion counts, official-report sets, and lifecycle behavior.
7. Capture post-watermark rows, run the reverse migration, restore preexisting rows, replay every post-watermark row through N-1 from sealed source identity and audit evidence, fail closed on any unreplayable row, and execute the verification SQL/script again.
8. Require exact N-1 fingerprints and restoration checks for column defaults, constraints, functions, triggers, indexes, grants, migration state, row counts, per-row checksums, aggregate checksums, statuses, versions, and audit linkage.

**Gate:** Forward and reverse SQL run through the approved channel in a disposable environment and produce machine-readable N-1, N, and restored-N-1 evidence. Any missing schema object, grant mismatch, row/checksum mismatch, unresolved post-watermark row, or unavailable approved DB channel blocks implementation and release.

### Task 6: Inventory, quiesce, stage, and cut over every writer

**Objective:** Prevent overlapping old/new triggers and retain exact definitions for every affected writer.

**Known required workflow IDs:**
- `Dz0F0PGyZaWppZY9`
- `LhYW2M5c6u6BxVfh`
- `cp60akEmtVY8GJMp`
- `q4kQbkBNt74rjxFZ`
- `Wfnzq4tbkYUqb3CQ`
- `ahyNaIeDA5NecJ0h`

**Artifacts:**
- Retained pre-change exports under `/opt/data/backups/n8n/<release-id>/`
- A writer manifest containing writer ID, name, exported definition checksum, version ID, trigger type/configuration, source/district bounds, and active/inactive state
- Staged inactive replacement workflows using the Task 4 atomic RPC

**Steps:**
1. Discover writers from application code, n8n workflow search/export, schedules, webhooks, database functions/triggers, and operational documentation. Reconcile all discoveries with the six known IDs above. An unclassified writer blocks cutover.
2. Export and checksum every affected definition, including inactive writers. Record ID/name/version/trigger/active state, source/district scope, credentials by non-secret reference, and last execution ID/time.
3. Create inactive replacement copies. Change each replacement to use the Task 4 single-statement RPC and create the mapped N state without ever overwriting stored `excluded`.
4. Test staged copies with controlled owned/public records and attach execution IDs, row/audit/version outcomes, and cleanup evidence.
5. Immediately before the final production backup and migration, deactivate or otherwise quiesce every affected old trigger. Verify by API/read-back that every schedule and webhook is inactive and that the overlap interval contains zero executions/writes. If zero overlap cannot be proven, stop.
6. Take the final writer exports and schema/data backup only after quiescence. Restore definitions during rollback while they remain inactive.
7. After migration, N app promotion, and signed role smoke tests pass, activate replacements one bounded source/district at a time. Before each activation, reconfirm all corresponding old triggers are inactive.
8. Run a bounded canary, then prove exactly one active schedule/webhook per source/district and no duplicate execution or row. Resume general schedules only after all bounded canaries pass.

**Gate:** The manifest includes all six known IDs plus every discovered writer, every export is restorable and checksummed, zero trigger overlap is proven, and each source/district has exactly one active replacement with no duplicate execution.

### Task 7: Run the executable compatibility matrix and rollback drill

**Objective:** Produce machine-verifiable evidence across roles, statuses, ownership classes, transitions, and exact rollback.

**Files:**
- Create: `scripts/fixtures/social-compatibility-matrix.json`
- Create: `scripts/test-social-compatibility-matrix.mjs`
- Create: `scripts/run-social-rollback-drill.mjs`
- Modify: `package.json`

**Required package scripts:**
- `test:social:compatibility`: execute `scripts/test-social-compatibility-matrix.mjs`
- `drill:social:rollback`: execute `scripts/run-social-rollback-drill.mjs`

**N/N-1 compatibility matrix:**

N is the Social v2 application, lifecycle/schema/data contract, and atomic writer set. N-1 is stable application `6fa8728`, the exact pre-migration schema/data state, and prior writer exports.

| Combination | Required proof | Safe stop point |
| --- | --- | --- |
| New app N + old schema/data N-1 + old writers N-1 | Both roles load without query errors; legacy states retain N-1 visibility; mutations are compatibility-safe; reports remain owned-only. | Preview-only safe stop. Writers remain quiesced for production cutover. |
| New app N + new schema/data N + old writers N-1 | Old payloads are accepted through the compatibility contract without resetting excluded; mapped visibility/reporting is exact. | Migration verification stop only. Writers remain quiesced. |
| New app N + new schema/data N + new writers N | Atomic ingestion, visibility, reporting, audit, versioning, and tenant isolation match N. | Fully upgraded state after canaries. |
| Prior app N-1 + upgraded schema/data N + new writers N | Stable `6fa8728` can serve as an application rollback bridge without exposure or mutation failure. | Bridge only, never exact N-1. Writers stay quiesced while schema/data/writers are restored. |

**Harness requirements:**
1. Seed every `review`, `approved`, `active`, and `excluded` status crossed with verified-owned and public ownership, in at least two tenants, plus controlled QA fixture markers.
2. Exercise every forward mapping, reverse restoration, hide, restore, ingestion replay, old-writer payload, new-writer payload, stale-version, double-submit/idempotency, and cross-tenant denial transition.
3. Execute as signed admin and client roles. Assert exact row visibility, official-report membership, audit-event count/content/immutability, `review_version`, HTTP/RPC outcome, and unchanged unauthorized rows.
4. Prove exclusion preservation inside the authoritative database statement under concurrent or adversarial replay, not by manual inspection.
5. Exercise N-1 to every safe stop, each safe stop to N, N to the rollback bridge, schema/data restoration, post-watermark replay, and the bridge to exact N-1.
6. Emit machine-readable JSON evidence containing release/run IDs, fixture and real artifact IDs, schema/data/writer/application fingerprints, row and aggregate checksums, timestamps, each assertion/outcome, cleanup results, rollback phase durations, total recovery time, and unresolved items.
7. Fail nonzero on any skipped combination, prose-only/manual assertion, cleanup failure, checksum mismatch, duplicate writer execution, or recovery-objective breach.

**Commands:**
- `npm run test:social`
- `npm run test:social:compatibility`
- `npm run drill:social:rollback`
- `npm run test:quality`
- `npm run lint`
- `npm run build`
- `git diff --check`
- `node scripts/preflight-production-auth.mjs`

**Authenticated browser matrix:**
- Admin: dashboard, district switching, Social, hide, restore, MELODI.
- Client: assigned district only, active Social visibility, no admin navigation, no cross-tenant results.
- Desktop and mobile screenshots.
- No failed first-party requests or console/page errors.

**Executable rollback order:**
1. Start the recovery timer and quiesce all affected old/new writers. Prove no writes continue.
2. Capture the post-watermark change set and current N fingerprints/checksums.
3. Restore prior writer definitions while inactive.
4. Point traffic to the verified N-1 deployment only as the rehearsed bridge permits; otherwise keep N serving or enter maintenance until schema compatibility is safe.
5. Run `supabase/rollbacks/<timestamp>_social_visibility_active_down.sql`, restore exact preexisting rows, and replay every post-watermark row through N-1. Any unreplayable row blocks rollback; no generic or manifest-based deletion is allowed.
6. Verify exact N-1 schema fingerprints, grants, row checksums, statuses, versions, audits, report sets, and migration state with the SQL and Node schema-contract tools.
7. Restore/confirm the prior Vercel deployment ID and Git SHA.
8. Reinstate prior writer active states one bounded source at a time, after all schema/data/app checks pass. Verify exactly one trigger and no duplicates.
9. Run signed admin/client N-1 smoke tests. Stop the timer only after all read-back and cleanup checks pass.

**Gate:** The executable matrix and drill exit 0 and attach their JSON evidence. Prose or manual claims alone fail. Exact N-1 requires verified schema restoration before writer reactivation and before the recovery timer stops.

### Task 8: Controlled production promotion and exact rollback readiness

**Objective:** Release through one coordinated, quiesced, and reversible production window.

**Steps:**
1. Confirm Task 7 passed, its artifact checksums and runbook are current, and the window can satisfy the measured recovery objective.
2. Run the canonical read-only Auth preflight. Record deployment IDs/SHAs, complete writer manifest/exports, approved SQL channel, N-1 schema fingerprint, row backup/checksums, and exact commands.
3. Quiesce every affected writer and verify zero overlap. Keep writers quiesced for all remaining migration, application, and smoke-test steps.
4. Take the final post-quiescence schema/data backup and cutover watermark. Verify its immutable checksum.
5. Apply Task 4 lifecycle and Task 5 forward migrations through the approved channel. Verify N schema fingerprints, forward status mapping, row counts/checksums, exclusions, and owned-only official reporting.
6. Promote the reviewed N application. Run signed admin and client production smoke tests, including tenant denial, active-only client reads, hide/restore, audit/version outcomes, and MELODI.
7. Only after signed role smoke tests pass, activate one replacement writer for one bounded source/district, confirm its corresponding old trigger is inactive, run a bounded canary, and verify exact atomic outcomes and no duplicates. Repeat one source/district at a time.
8. Verify exactly one schedule/webhook per source/district, then resume normal schedules. Attach final deployment, schema, data, writer version/state, execution, and checksum read-backs.
9. If any check fails, keep or return all writers to quiesced state and execute Task 7 rollback in exact order: capture post-watermark changes; restore writer definitions inactive; use the app bridge only when verified; reverse schema; restore preexisting rows; replay every new row through N-1 and fail closed on any unreplayable row; verify exact N-1 schema/data; restore N-1 app; then reactivate prior writers one bounded source at a time.
10. Only after all checks pass, update ClickUp as live and ask Lesley to verify.

**Gate:** Production is complete only after signed role evidence, exact N schema/data fingerprints, bounded canary evidence, exactly-one-trigger evidence, and deployment/writer read-back are attached. Rollback is complete only after exact N-1 schema restoration, exact preexisting-row restoration, reconciled post-watermark content, signed N-1 smoke evidence, and safe prior-writer reactivation are attached.

# Safe Social Simplification Release Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Simplify Canary Social and remove approval gating without changing authentication, exposing hidden content, mixing official performance with public mentions, or requiring an all-at-once production release.

**Architecture:** Separate the work into independently releasable UI, visibility-contract, ingestion, and migration changes. Production remains on commit `6fa872818bf729b0979d30ecfa8aaba44836bd09` until a preview has passed authenticated admin and client QA, an exclusion replay test, and a rollback rehearsal. Every production mutation has a retained backup and exact reversal command.

**Tech Stack:** Next.js, Supabase Auth/PostgREST, n8n Cloud, Vercel Git deployments, Playwright, Node test scripts.

---

## Release invariants

- Do not modify `/login`, middleware, Supabase Auth metadata, tenant resolution, billing access gates, or Vercel environment variables as part of Social work.
- `excluded` always wins over ingestion replay.
- Official-owned posts and public mentions may appear together visually, but official performance calculations use owned posts only.
- No direct production data or n8n mutation occurs before preview approval.
- A release is not called complete until signed-in admin and client production smoke tests pass.
- Any failed smoke test automatically points production traffic back to the prior deployment before debugging continues.

### Task 1: Rebuild the feature from the stable production baseline

**Objective:** Prevent the rejected mixed release from being reused as-is.

**Files:**
- Create a fresh feature worktree from `origin/main` after confirming it equals stable commit `6fa8728`.
- Reference only: `/opt/data/worktrees/canary-social-simplify`

**Steps:**
1. Fetch origin and verify `origin/main` before creating a new branch.
2. Create `feat/social-simplification-v2` in a new worktree.
3. Do not cherry-pick `729da75a8981a3cd2084ae3e34c9a5af73152676`, any descendant of it, or any other rejected commit. Do not copy a whole file from the rejected worktree. Starting from baseline `6fa872818bf729b0979d30ecfa8aaba44836bd09`, manually reimplement only the specifically named `Approved candidate for later manual reapplication` hunk families in `2026-08-04-social-v2-diff-inventory.md`:
   - exclusion-preservation and latest-event filtering assertions in `scripts/test-social-monitoring.mjs`;
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
4. Treat every `Requires independent redesign` family as new work that must be designed from the stable baseline in its assigned later task. Treat every `Forbidden/out-of-scope` family as prohibited.
5. Reject all auth, middleware, billing, credential, tenant-resolution, or unrelated dashboard changes.
6. Before the first implementation commit, run `git diff --check`, review `git diff --name-only`, and map every changed hunk to one allowlisted family and assigned task.

**Gate:** The reviewer must attach a hunk-by-hunk allowlist map. Every manually reimplemented rejected-diff hunk maps to one named `Approved candidate` family above, no whole file was copied, rejected SHA `729da75` is absent from branch ancestry, and no unlisted or forbidden hunk is present. A Social-related filename alone does not satisfy this gate.

### Task 2: Add credential and authentication preflight checks

**Objective:** Detect revoked or mismatched production credentials before any release action.

**Files:**
- Create: `scripts/preflight-production-auth.mjs`
- Test: `scripts/test-production-preflight.mjs`

**Steps:**
1. Make the production preflight strictly read-only and require exactly `CANARY_PROD_SUPABASE_URL`, `CANARY_PROD_SUPABASE_ANON_KEY`, and `CANARY_PROD_SUPABASE_SERVICE_ROLE_KEY`. Do not fall back to generic or legacy variable names.
2. Validate the configured Supabase project reference and anonymous key through `/auth/v1/settings` without printing credentials.
3. Validate the service-role credential with a bounded existing-user admin list, then call `auth.admin.getUserById` for one returned existing user. An equivalent bounded, no-mutation admin verification is acceptable. Do not create, update, invite, or delete a user or any other production record.
4. Compare fingerprints of the three tested canonical variables with the corresponding Vercel production variables. Log only variable names and match/mismatch status, never values, reversible encodings, or full fingerprints.
5. Fail closed if any check returns 401, a project mismatch, a missing canonical variable, an empty bounded verification set, or a Vercel fingerprint mismatch.

**Gate:** Preflight exits 0 immediately before preview and production promotion.

### Task 3: Implement the UI simplification without changing visibility

**Objective:** Ship the simpler Social presentation independently from the data contract.

**Files:**
- Modify: `src/app/dashboard/DashboardClient.js`
- Modify: `src/app/globals.css`
- Test: `scripts/test-social-review.mjs`

**Steps:**
1. Write failing source/UI tests for `Overview` and `Posts & mentions` tabs.
2. Remove normal approval-oriented controls from the visible interface.
3. Keep `Hide as irrelevant` and restore controls.
4. Keep owned/public labels on every combined card.
5. Run Social tests, targeted ESLint, build, and desktop/mobile Playwright QA.
6. Deploy only this UI slice to a Vercel preview.

**Gate:** Authenticated admin and client preview sessions load normally and tenant navigation is unchanged.

### Task 4: Make exclusion replay-safe before changing defaults

**Objective:** Prove hidden content cannot be reactivated by any ingestion path.

**Files:**
- Modify: `src/lib/socialIngestion.mjs`
- Modify: `scripts/ingest-social-pilot.mjs`
- Modify: `src/lib/data.js`
- Modify: `src/app/api/melodi/route.js`
- Test: `scripts/test-social-monitoring.mjs`
- Create: `scripts/test-social-exclusion-replay.mjs`

The stable baseline has one direct application writer, `scripts/ingest-social-pilot.mjs`. `src/lib/meta-page-sync.mjs` does not exist in the stable baseline and is not part of the rejected 11-file diff, so it is not a Task 4 file. Production n8n writers are changed only through the staged inactive copies in Task 6. Any future Meta sync writer must be delivered and reviewed separately before it can enter this release inventory.

**Steps:**
1. Write a disposable insert → hide → replay → restore integration test.
2. Make the direct application writer's upsert preserve stored `excluded` state atomically.
3. Add a defense-in-depth client/MELODI read filter based on the latest exclude/restore event.
4. Run the integration test against a disposable district and delete all test records.
5. Verify official reporting still excludes ambient/public mentions.

**Gate:** The direct application writer and every Task 6 staged n8n writer pass the replay test before any writer is changed to create `active` rows. No un-inventoried writer may enter this release.

### Task 5: Prepare a reversible data migration

**Objective:** Convert legacy `review` rows without losing the ability to restore exact prior states.

**Files:**
- Create: `supabase/migrations/<timestamp>_social_visibility_active.sql`
- Create: `scripts/backup-social-visibility.mjs`
- Create: `scripts/restore-social-visibility.mjs`
- Test: `scripts/test-social-visibility-migration.mjs`

**Steps:**
1. Export `id`, tenant, prior status, and update timestamp to a retained backup artifact.
2. Run the migration against a disposable data copy first.
3. Verify row-count parity and preserve all `excluded` rows.
4. Run the exact restore script in the disposable environment.
5. Compare restored rows byte-for-byte on backed-up fields.

**Gate:** Migration and restoration both pass before a production migration window is approved.

### Task 6: Stage n8n changes from exported workflow copies

**Objective:** Avoid editing active production workflows before application compatibility is proven.

**Files:**
- Store retained pre-change exports under `/opt/data/backups/n8n/`.
- Create staged inactive workflow copies for each affected collector.

**Steps:**
1. Clone each affected active workflow into an inactive staging copy.
2. Change staging copies to create `active` rows while preserving `excluded` on conflict.
3. Run controlled records through staging and verify resulting rows/audit events.
4. Compare staging node configuration with the approved diff.
5. Keep production workflows unchanged until the production application and migration are ready.

**Gate:** Staging outputs pass the replay test and official/public classification checks.

### Task 7: Run the release candidate matrix

**Objective:** Require evidence across roles, devices, data states, and rollback.

**N/N-1 forward/backward compatibility matrix:**

Here, N is the Social v2 application, schema/data contract, and writer set. N-1 is stable application `6fa8728`, the pre-migration schema/data state, and the prior production writer exports. Run every row in a disposable or staging environment with representative owned posts, public mentions, review/active rows, excluded rows, and exclude/restore history.

| Combination | Required proof | Safe stop point |
| --- | --- | --- |
| New app N + old schema/data N-1 + old writers N-1 | Both roles load without query or mutation errors; old `review`, `approved`, and `excluded` states retain their prior visibility; hide/restore remains authorized and replay-safe; official reports remain owned-only. | Yes. The application may remain here after preview promotion while migration and writer activation are paused. |
| New app N + new schema/data N + old writers N-1 | Explicit old-writer payloads remain accepted without resetting `excluded`; the new app correctly renders rows written with old defaults/statuses; migration parity and owned/public classification remain intact. | Yes, only after this row passes. The release may pause after migration while production writers remain unchanged. |
| New app N + new schema/data N + new writers N | Direct and staged workflow writers create the intended state, preserve exclusions atomically, maintain tenant boundaries, and keep official reporting owned-only. | Yes. This is the fully upgraded steady state, but production is not complete until signed smoke tests and read-back checks pass. |
| Prior app N-1 + upgraded schema/data N + new writers N | Stable `6fa8728` loads and operates safely against upgraded rows and workflow outputs; no content becomes newly exposed; hide/restore and owned-only reporting remain correct. | Rollback bridge only. It must pass before cutover so application rollback is safe while data/workflow restoration is in progress. Do not treat it as the final rollback state. |

Test transitions in both directions, including N-1 to each safe stop, each safe stop to N, N back to the rollback bridge, and the rollback bridge back to exact N-1. Every rollout and rollback combination above must pass before production promotion. A failure removes that stop point and blocks promotion rather than forcing an all-at-once release.

**Commands:**
- `npm run test:social`
- `npm run test:quality`
- `npm run lint`
- `npm run build`
- `git diff --check`
- `node scripts/preflight-production-auth.mjs`
- `node scripts/test-social-exclusion-replay.mjs`

**Authenticated browser matrix:**
- Admin: dashboard, district switching, Social, hide, restore, MELODI.
- Client: assigned district only, Social visible, no admin navigation, no cross-tenant results.
- Desktop and mobile viewport screenshots.
- No failed first-party requests or console/page errors.

**Mandatory disposable/staging end-to-end rollback drill:**
1. Capture the candidate and prior Vercel deployment IDs and Git SHAs, exact n8n workflow exports and version IDs, each workflow's active/inactive state, the visibility backup, row counts, and checksums before exercising the candidate.
2. Advance the disposable/staging stack through the same application, migration, and workflow sequence planned for production, then run the signed admin/client candidate smoke tests.
3. Start the recovery timer and quiesce every affected writer so no writes race restoration.
4. Restore the exact prior n8n exports while keeping affected workflows inactive.
5. Restore the visibility backup, then verify backed-up-field row parity and checksums before allowing a writer to run.
6. Restore the prior Vercel deployment and verify its deployment ID and Git SHA.
7. Reinstate the exact recorded n8n active/inactive states, verify workflow version IDs and active states, and confirm ingestion resumes without changing an excluded record.
8. Run signed admin and client smoke tests against the restored stack. Verify Auth and tenant isolation, cross-tenant denial, exclusion persistence, owned/public classification, owned-only official reporting, hide/restore behavior, and no first-party or console errors.
9. Stop the recovery timer only after read-back verification succeeds. Record measured recovery time and compare it with the approved recovery objective.
10. Retain the commands, timestamps, deployment evidence, n8n exports, workflow/version/state evidence, visibility backup and checksums, signed screenshots/results, observed recovery time, and an operator-ready rollback runbook in the release task.

**Gate:** Any compatibility, browser, or rollback-drill failure blocks production promotion. Cutover requires retained evidence that every N/N-1 row and transition passed and that the complete rollback finished within the approved recovery objective.

### Task 8: Controlled production promotion and rollback readiness

**Objective:** Release one coordinated, reversible change window.

**Steps:**
1. Confirm the mandatory Task 7 rollback drill passed, its retained runbook is current, and the production window has enough time to meet the measured recovery objective.
2. Record the current production deployment ID and Git SHA, visibility backup path and checksums, exact n8n exports and workflow version IDs, every active/inactive state, and exact rollback commands.
3. Run the read-only credential preflight again.
4. Promote the reviewed preview application and verify the first compatibility safe stop.
5. Run the bounded data migration and verify the second compatibility safe stop, row parity, checksums, exclusions, and owned-only reporting before proceeding.
6. Activate the reviewed workflow versions and verify the fully upgraded state.
7. Run signed-in admin and client production smoke tests and read back deployment, data, workflow version, and workflow active-state identifiers.
8. If any check fails, execute the rehearsed dependency-safe rollback: quiesce affected writers, restore exact prior workflow exports while inactive, restore and verify the visibility backup, restore the prior Vercel deployment, reinstate exact prior workflow active states, then rerun signed smoke and read-back checks.
9. Only after all checks pass, update ClickUp as live and ask Lesley to verify.

**Gate:** Production is called complete only after authenticated evidence, compatibility-stop evidence, checksums, workflow version/active-state read-back, and deployment read-back are attached to the release task. A rollback is complete only when exact N-1 state and signed restored-stack smoke evidence are attached.

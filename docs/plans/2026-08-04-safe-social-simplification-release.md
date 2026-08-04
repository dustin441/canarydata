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
3. Cherry-pick or manually reapply only reviewed Social-specific hunks.
4. Reject all auth, middleware, billing, credential, or unrelated dashboard changes.
5. Run `git diff --check` and review `git diff --name-only` before the first commit.

**Gate:** Diff contains only approved Social UI, Social data, Social ingestion, tests, and migration files.

### Task 2: Add credential and authentication preflight checks

**Objective:** Detect revoked or mismatched production credentials before any release action.

**Files:**
- Create: `scripts/preflight-production-auth.mjs`
- Test: `scripts/test-production-preflight.mjs`

**Steps:**
1. Add a read-only check that validates the configured Supabase project reference.
2. Validate the anonymous key through `/auth/v1/settings`.
3. Validate the server credential through one bounded read and `auth.admin.getUserById` against a temporary QA user.
4. Verify Vercel production variables match the tested credential by fingerprint, without printing secret values.
5. Fail closed if any check returns 401, a project mismatch, or a missing environment variable.

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
- Modify: `src/lib/meta-page-sync.mjs`
- Modify: `src/lib/data.js`
- Modify: `src/app/api/melodi/route.js`
- Test: `scripts/test-social-monitoring.mjs`
- Create: `scripts/test-social-exclusion-replay.mjs`

**Steps:**
1. Write a disposable insert → hide → replay → restore integration test.
2. Make every upsert preserve stored `excluded` state.
3. Add a defense-in-depth client/MELODI read filter based on the latest exclude/restore event.
4. Run the integration test against a disposable district and delete all test records.
5. Verify official reporting still excludes ambient/public mentions.

**Gate:** All ingestion writers pass the replay test before any writer is changed to create `active` rows.

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

**Gate:** Any failure blocks production promotion.

### Task 8: Controlled production promotion and rollback rehearsal

**Objective:** Release one coordinated, reversible change window.

**Steps:**
1. Record the current production deployment ID, Git SHA, data backup path, workflow versions, and exact rollback commands.
2. Run credential preflight again.
3. Promote the reviewed preview application.
4. Run the bounded data migration.
5. Activate the reviewed workflow versions.
6. Run signed-in admin and client production smoke tests.
7. If any smoke test fails, immediately restore the prior deployment, workflow exports, and visibility backup.
8. Only after all checks pass, update ClickUp as live and ask Lesley to verify.

**Gate:** Production is called complete only after authenticated evidence and read-back verification are attached to the release task.

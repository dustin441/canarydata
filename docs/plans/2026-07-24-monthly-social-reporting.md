# Monthly Social Reporting Implementation Plan

> **For Hermes:** Implement this plan task-by-task with tests before UI delivery.

**Goal:** Make Canary Social visibly useful for completed-month reporting with truthful metrics, prior-period context, a human analyst note, top-post evidence, CSV detail, and a leadership-ready PDF.

**Architecture:** Extend the pure `socialReport.mjs` contract for adjacent-period comparisons and content/platform rollups. Reuse verified official post eligibility and existing scorecard/PDF primitives. Add an additive reporting-first section before the legacy monitoring workspace while preserving administrative correction controls until direct Meta ownership makes automatic eligibility safe.

**Tech Stack:** Next.js, React, JavaScript modules, Node assertion scripts, CSS, Supabase-backed social records.

---

### Task 1: Monthly reporting contract

**Files:**
- Modify: `src/lib/socialReport.mjs`
- Modify: `scripts/test-social-monitoring.mjs`

**Steps:**
1. Add failing assertions for previous-month windows, prior-period comparisons, and content-format rollups.
2. Run `npm run test:social` and confirm failure.
3. Implement pure helpers with null-preserving metric semantics.
4. Rerun the test and confirm pass.

### Task 2: Reporting-first Social surface

**Files:**
- Modify: `src/app/dashboard/DashboardClient.js`
- Modify: `src/app/globals.css`

**Steps:**
1. Add a Monthly Performance section before review controls.
2. Reuse the existing period selector, verified official posts, and source mappings.
3. Show scorecards, prior-period changes, platform/content rollups, metric coverage, and top six evidence posts.
4. Keep impressions, reach, and follower growth explicitly unavailable until direct Meta data exists.

### Task 3: Human context and PDF scope

**Files:**
- Modify: `src/app/dashboard/DashboardClient.js`
- Modify: `src/app/globals.css`
- Modify: `scripts/test-social-monitoring.mjs`

**Steps:**
1. Add a local analyst-note field to the reporting surface.
2. Include it in the print/PDF artifact.
3. Keep complete evidence in CSV and remove the all-post appendix from the default PDF.
4. Preserve top three per platform with truthful N/A disclosures.

### Task 4: Verification and release

**Steps:**
1. Run `npm run test:social`, `npm run test:quality`, `npm run lint`, `npm run build`, and `git diff --check`.
2. Inspect the diff for eligibility, privacy, missing-data, and PDF regressions.
3. Commit and push to `main`.
4. Wait for Vercel production deployment.
5. Run authenticated Alabaster admin/client browser QA and visually inspect the reporting section and PDF.

### Task 5: Meta schema proposal

**Files:**
- Create: `docs/plans/2026-07-24-meta-social-integration-schema.md`

**Steps:**
1. Specify tenant-scoped connections, page/school mappings, encrypted token handling, daily account metrics, post insights, sync runs, metric availability, and RLS.
2. Define one-district pilot and native Meta reconciliation acceptance criteria.
3. Do not apply production schema or initiate Meta app review without explicit approval.

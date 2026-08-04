# Canary Social v2 Rejected Diff Inventory

## Baseline and review scope

- Stable baseline SHA: `6fa872818bf729b0979d30ecfa8aaba44836bd09`
- Destination worktree: `/opt/data/worktrees/canary-social-simplification-v2`
- Destination branch: `feat/social-simplification-v2`, tracking `origin/main`
- Rejected implementation source, read only: `/opt/data/worktrees/canary-social-simplify`
- Rejected implementation SHA: `729da75a8981a3cd2084ae3e34c9a5af73152676`
- Compared range: `6fa872818bf729b0979d30ecfa8aaba44836bd09..729da75a8981a3cd2084ae3e34c9a5af73152676`
- Safe plan source: `/opt/data/worktrees/canary-social-safe-plan/docs/plans/2026-08-04-safe-social-simplification-release.md`
- Safe plan destination: `/opt/data/worktrees/canary-social-simplification-v2/docs/plans/2026-08-04-safe-social-simplification-release.md`
- Review result: 11 changed runtime, test, script, and SQL files, with 300 insertions and 391 deletions. No rejected commit was cherry-picked and no runtime hunk was applied.

## Classification rules

- **Approved candidate for later manual reapplication:** The intent matches the safe plan, but the hunk must still be manually reapplied from the stable baseline in its assigned task and verified independently.
- **Forbidden/out-of-scope:** Do not reapply. This includes auth, middleware, billing, credentials, tenant resolution, production configuration, and unrelated dashboard work.
- **Requires independent redesign:** The goal may be valid, but the rejected implementation combines release stages, has incomplete safety properties, or needs a new design and tests before any code is applied.

A candidate classification is not approval to copy a whole file. Only the named hunk family may be considered later.

## File and hunk-family inventory

| Rejected file | Hunk family | Classification | Review decision |
| --- | --- | --- | --- |
| `scripts/ingest-social-pilot.mjs` | Read existing `visibility_status` and call a helper to preserve an existing exclusion during upsert | Requires independent redesign | Revisit in Task 4 only after the disposable hide, replay, and restore test exists. The lookup plus upsert is not atomic and the current hunk couples replay safety to the default-visibility change. |
| `scripts/ingest-social-pilot.mjs` | Change accepted records and diagnostics from review-oriented to immediately active | Requires independent redesign | This changes ingestion behavior before the visibility contract, migration, staged writer validation, and rollback gates. Do not reapply in the UI task. |
| `scripts/test-social-monitoring.mjs` | Change normalization expectations from `review` to `active` | Requires independent redesign | Valid only with the later ingestion and visibility-contract work. Recreate from the approved contract rather than copying the rejected assertions. |
| `scripts/test-social-monitoring.mjs` | Add exclusion-preservation and latest-event filtering assertions | Approved candidate for later manual reapplication | The test intent matches Task 4. Expand it into the required disposable insert, hide, replay, restore integration test before changing writers. |
| `scripts/test-social-monitoring.mjs` | Rename Board Report wording expectation from review-only to visible | Requires independent redesign | Couple this to the final reporting eligibility contract. Official performance must continue to use owned posts only. |
| `scripts/test-social-review.mjs` | Load and assert the broad auto-visibility SQL migration | Requires independent redesign | The rejected SQL updates all review and approved rows without the required backup, disposable rehearsal, parity checks, and exact restore test. |
| `scripts/test-social-review.mjs` | Remove approval and bulk-review action expectations, add restore-to-active expectation | Requires independent redesign | Server action and database lifecycle changes must not be smuggled into the UI-only slice. Rebuild after the contract and migration order are approved. |
| `scripts/test-social-review.mjs` | Assert `Overview`, `Posts & mentions`, hide/restore language, correction history, and tab/correction styles | Approved candidate for later manual reapplication | This directly supports the Task 3 UI simplification. Reapply as failing UI/source tests against the stable baseline. |
| `scripts/test-social-review.mjs` | Change monthly report and report-copy markers | Approved candidate for later manual reapplication | The optional analyst-insight presentation and neutral report wording can be reviewed as UI-only changes, while preserving owned-only report calculations. |
| `scripts/test-social-review.mjs` | Assert the new cross-channel dashboard snapshot | Forbidden/out-of-scope | This is unrelated dashboard expansion and is not part of the Social simplification release. |
| `src/app/actions.js` | Remove `approve` from allowed single-record review actions and delete approval verification/promotion flow | Requires independent redesign | This changes the server-side visibility contract. Keep stable behavior during Task 3 and redesign only after exclusion replay safety and migration sequencing are proven. |
| `src/app/actions.js` | Delete bulk approval action and its district, account, eligibility, and optimistic-version checks | Requires independent redesign | UI controls may be hidden later, but deleting the protected action is a separate server-contract decision. Do not copy this deletion with the UI slice. |
| `src/app/actions.js` | Force a restored row from `review` to `active` after the RPC for mixed database versions | Requires independent redesign | The compatibility update creates a second mutation path and relies on version assumptions. Use one reviewed database contract with tests instead. |
| `src/app/api/melodi/route.js` | Read up to 500 exclude/restore events and filter non-admin Social context | Requires independent redesign | Defense in depth is required by Task 4, but a fixed event limit can miss the authoritative event and ordering needs a deterministic tie-break. Design and test a complete district-scoped query. |
| `src/app/dashboard/DashboardClient.js` | Remove unused approval and action-filter imports after UI deletion | Approved candidate for later manual reapplication | Reapply only as cleanup required by approved Task 3 UI changes. Do not touch payment imports or billing behavior. |
| `src/app/dashboard/DashboardClient.js` | Replace review badges, classification, notes, approval, selection, and bulk approval controls with admin hide/restore correction controls | Approved candidate for later manual reapplication | This is the core UI-only simplification. Keep owned/public labels, admin authorization, and stable data visibility unchanged in Task 3. |
| `src/app/dashboard/DashboardClient.js` | Change report and Board Report copy from approved to visible | Requires independent redesign | Wording must follow, not precede, the final visibility and report-eligibility contract. Owned-only official reporting remains invariant. |
| `src/app/dashboard/DashboardClient.js` | Collapse the optional analyst note and remove unavailable metric cards | Approved candidate for later manual reapplication | The collapsed optional note is a presentational simplification. Review removal of unavailable metric cards independently during Task 3 so capability boundaries remain clear. |
| `src/app/dashboard/DashboardClient.js` | Add `Overview` and `Posts & mentions` tabs and default the feed to compact mode | Approved candidate for later manual reapplication | This matches Task 3. Verify both roles and mobile/desktop behavior in preview. |
| `src/app/dashboard/DashboardClient.js` | Replace review-state filtering with visible/hidden language | Requires independent redesign | On the stable contract, review and approved are distinct states. Do not make the UI imply immediate visibility until the later contract and migration are complete. |
| `src/app/dashboard/DashboardClient.js` | Remove Action Queue UI and action filters | Approved candidate for later manual reapplication | This is Social UI simplification, but manually reapply without changing underlying data or advisory semantics. |
| `src/app/dashboard/DashboardClient.js` | Remove the duplicate top-posts section, feed export buttons, platform selector, and bulk-review panel | Requires independent redesign | Bulk approval controls may be hidden in Task 3, but removing unrelated feed capabilities needs product review and targeted tests. Keep report exports available from the Overview. |
| `src/app/dashboard/DashboardClient.js` | Rename review audit history to correction history | Approved candidate for later manual reapplication | Suitable for Task 3 if immutable history remains complete and no event types are hidden from administrators. |
| `src/app/dashboard/DashboardClient.js` | Add the combined latest news and Social snapshot to the main dashboard | Forbidden/out-of-scope | This is an unrelated dashboard feature. Do not reapply its state, rendering, counts, links, or copy. |
| `src/app/dashboard/DashboardClient.js` | Change Communications Brief wording and Action Queue button | Approved candidate for later manual reapplication | Reapply only the minimal navigation and copy changes needed after the approved Social UI simplification. |
| `src/app/globals.css` | Add Social page-tab, analyst-details, and correction-control styles, including mobile rules | Approved candidate for later manual reapplication | Reapply only alongside the corresponding Task 3 components and test desktop/mobile layouts. |
| `src/app/globals.css` | Add cross-channel snapshot and chip styles, including mobile rules | Forbidden/out-of-scope | These styles support the unrelated main-dashboard snapshot and must not be copied. |
| `src/lib/data.js` | Fetch exclude/restore events by thread batches and filter client-visible Social before loading comments | Requires independent redesign | The defense-in-depth goal matches Task 4, but completeness, deterministic event precedence, query cost, pagination, and failure behavior need independent tests and design. |
| `src/lib/socialIngestion.mjs` | Add `resolveIngestionVisibilityStatus` to preserve `excluded` and otherwise return `active` | Requires independent redesign | Preserving exclusions is required, but default activation is a separate gated change. Design an atomic writer contract and test every ingestion path first. |
| `src/lib/socialIngestion.mjs` | Add in-memory latest exclude/restore event filtering | Requires independent redesign | The concept is useful defense in depth, but the helper depends on callers supplying a complete and deterministically ordered event set. Prefer a complete authoritative query or database-side contract. |
| `src/lib/socialIngestion.mjs` | Change normalized provider default from `review` to `active` | Requires independent redesign | This is feature behavior and cannot be applied until Tasks 4 through 6 pass their gates. |
| `supabase/social_auto_eligibility.sql` | Change the column default from review-safe behavior to `active` | Requires independent redesign | Move to a timestamped, reversible migration with retained backup and restore scripts. Do not edit or apply this SQL as-is. |
| `supabase/social_auto_eligibility.sql` | Convert every `review` or `approved` row to `active`, instead of only verified owned posts | Requires independent redesign | This is the highest-risk hunk. It lacks backup, tenant-bounded rehearsal, row-count parity, exclusion proof, and rollback. It also combines public mentions with official-post eligibility. |
| `supabase/social_review_workflow.sql` | Restore excluded records directly to `active` instead of `review` | Requires independent redesign | Define the restore target in the approved visibility lifecycle and test versioning, audit state, client visibility, and rollback before changing the function. |

## Explicit forbidden boundaries

The reviewed 11-file diff contains no changed auth, middleware, billing, credential, or tenant-resolution file. That absence does not make such changes permissible. The following are explicitly rejected for every later Social task:

- Any change to `/login`, authentication/session behavior, Supabase Auth metadata, role checks, or identity claims.
- Any middleware or route-protection change.
- Any billing, Stripe, payment, entitlement, or access-gate change.
- Any credential, secret, environment-variable, provider-key, or project-reference change.
- Any district/client tenant-resolution, district access, cross-tenant query, or navigation-scope change.
- Any unrelated dashboard feature, including the rejected combined latest news and Social snapshot.

The existing admin and district access checks visible only as unchanged context in `src/app/actions.js` are not candidates for modification. The existing payment imports visible only as unchanged context in `src/app/dashboard/DashboardClient.js` are not candidates for modification.

## Manual reapplication order

1. Task 3 may manually reapply only approved UI and UI-test candidates from the stable baseline.
2. Task 4 must independently design and prove exclusion replay safety before any default-active writer change.
3. Task 5 must replace the rejected broad SQL edit with a timestamped, backed-up, reversible migration and restore test.
4. Task 6 must stage inactive workflow copies before any production writer changes.
5. No candidate may be cherry-picked from `729da75a8981a3cd2084ae3e34c9a5af73152676`.

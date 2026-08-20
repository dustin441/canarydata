# Canary Social Performance Direction

## Goal
Use the controlled EIC native Social history to add a truthful executive decision layer that answers whether performance is improving, declining, mixed, steady, or still building a baseline, without implying that post lifetime metrics are date-scoped activity.

## Non-negotiable semantics
- Keep customer-triggered native synchronization hard-disabled in this change.
- Do not alter Meta OAuth scopes, selected assets, credentials, or production environment flags.
- Do not sum Facebook unique viewers and Instagram reach.
- Do not rename views as impressions.
- Treat latest post lifetime metrics as published-content cohort performance, not period activity.
- Build account trends only from like-for-like daily account metrics with exact effective dates.
- Mark status as `insufficient_history` unless a dimension has complete current and previous daily windows with at least 3 points each.
- Keep source windows and coverage visible.
- Raw historical snapshots remain service-role/server-only and district scoped.

## Task 1: Historical account metric loading and derivation
Files:
- Create `src/lib/socialPerformance.mjs`
- Modify `src/lib/data.js`
- Create `scripts/test-social-performance.mjs`
- Modify `package.json`

Behavior:
- Add a bounded, district-scoped server loader for account-level rows from `social_provider_metric_snapshots` for the last 95 complete calendar days.
- Return no history for an unscoped `All` request.
- Attach sanitized account identity from active Meta links/assets, as the latest loader does.
- Build daily series by account, platform, normalized metric, and period.
- Deduplicate same effective date deterministically, keeping the latest observation.
- Use Facebook `period=day` values and Instagram `metric_variant=time_series`, `period=day` values as daily series.
- Do not derive arbitrary-window totals from rolling week/days_28 or Instagram total_value rows.
- Build four dimensions: visibility, engagement, audience, output. Output is provided from current/previous post counts by the UI; the historical summary covers only platform/account metrics.
- Platform metrics remain separate. Return trends and source labels per account/platform.
- A trend requires at least 3 daily points in both selected current and comparison windows. Compare sums for additive daily metrics. Use `improving`, `declining`, or `steady`, with steady inside ±5 percent. Otherwise `insufficient_history`.
- Overall native status: `improving`, `declining`, `mixed`, `steady`, or `insufficient_history`, requiring at least two comparable native dimensions and preserving platform separation.
- Include coverage dates, comparable dimension count, and a baseline explanation.

Tests:
- Facebook day metrics compare correctly.
- Instagram time-series metrics compare correctly.
- Rolling and total_value rows are excluded from arbitrary-window comparisons.
- Same-day observations deduplicate to the latest observation.
- Facebook and Instagram audiences are never summed.
- One observation period returns insufficient history.
- Mixed/improving/declining/steady classifications are deterministic.

## Task 2: Wire tenant-scoped history into the dashboard
Files:
- Modify `src/app/dashboard/page.js`
- Modify `src/app/dashboard/DashboardClient.js`

Behavior:
- Load history only for the selected district through `loadDashboardDataset`.
- Build and pass `socialPerformanceHistory` keyed by district.
- Never send another district's history to a client-scoped user.
- Select the current district history in `SocialView` and pass it to `MonthlySocialPerformance`.
- Derive current and comparison window native summaries from the exact selected report windows.

## Task 3: Executive decision layer and report parity
Files:
- Modify `src/app/dashboard/DashboardClient.js`
- Modify `src/app/globals.css`
- Extend `scripts/test-social-review.mjs`

Behavior:
- Replace the `Monthly reporting` eyebrow with `Social performance`.
- Add a top decision panel before detailed scorecards.
- Status language: `Improving`, `Declining`, `Mixed`, `Steady`, or `Building baseline`.
- Use `Building baseline` whenever native history is insufficient, regardless of post cohort comparisons.
- Show four labeled dimensions: Visibility, Engagement, Audience, Publishing output.
- Native dimensions use historical like-for-like account trends; publishing output uses selected post counts vs the comparison window and is explicitly labeled a post-volume comparison.
- Add a concise generated explanation from deterministic metrics only; no AI claim and no causal inference.
- Distinguish `Period performance` from `Published-content cohort`.
- Keep current post scorecards under a `Published-content cohort` heading.
- Move latest native account snapshot into a collapsed `Data details and source windows` disclosure on-screen; keep it visible in PDF.
- Include the decision panel in PDF output.
- Do not change CSV row semantics.
- Add responsive CSS and status colors with text labels, not color-only meaning.

Tests:
- Static dashboard assertions require the decision panel/status vocabulary and cohort labeling.
- Static assertions forbid `impressions` as a headline KPI.
- Existing dynamic date, PDF, CSV, and account-source-window tests remain green.

## Task 4: Verification and preview
- Run `node scripts/test-social-performance.mjs` first and verify RED before implementation, then GREEN.
- Run `npm run test:social`, `npm run test:quality`, `npm run test:authz`, `npm run test:meta`, `npm run lint`, `npm run build`, and `git diff --check`.
- Run a credential-pattern diff scan.
- Independent spec review, then code-quality/security review. Fix and re-review every important finding.
- Build a signed-in local production-mode preview against Canary production read-only data.
- Verify EIC renders `Building baseline`, platform-specific history, cohort scorecards, PDF, CSV, no 5xx/JS errors, and no cross-tenant leakage.
- Produce screenshots and a concise Lesley walkthrough.
- Do not push or deploy without a separate explicit production promotion decision.

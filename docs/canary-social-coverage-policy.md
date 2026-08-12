# Canary Social coverage and historical-depth policy

Status: Approved operating policy, August 2026

## Product lanes

### Our Social

Content from district-controlled accounts that the district can authorize and manage. This includes the district's primary Facebook, Instagram, and other supported first-party accounts.

### District-claimed affiliates

School, athletics, fine arts, CTE, club, booster, foundation, PTO/PTA, and similar accounts are not automatically owned and are not automatically irrelevant.

An affiliate enters this lane only after the district or a Canary administrator identifies the exact account as part of the district's communications ecosystem. Store the exact platform account ID or normalized handle, the district relationship, who claimed it, and when it was verified.

Claimed affiliates remain visibly distinct from district-controlled accounts. Their posts can contribute to district narrative, Strategic Alignment, emerging-issue, and reputation signals without being reported as central-district publishing performance.

### Public conversation

Meaningful external posts, tags, mentions, and discussion about the district or its claimed ecosystem. Public conversation may include discussion around a district-controlled or claimed-affiliate post. Excluding an affiliate's routine post must not categorically suppress substantive external conversation about that post.

### Excluded

Wrong geography, duplicates, unsafe or invalid URLs, irrelevant commercial promotion, generic tag spam, static low-information pages, and content with no meaningful district connection.

## Default historical package

- News: trailing 18 months.
- District-controlled Social: current school year or trailing 12 months, whichever produces the more useful continuous baseline.
- District-claimed affiliates: collect prospectively after verification. Historical backfill is limited to the same owned-Social window only when capacity and customer value justify it.
- Public conversation: trailing 90 days.
- Extended history: paid add-on or explicitly approved exception with a documented business reason and provider-cost estimate.

The goal is a useful baseline, not the maximum history a provider can technically return.

## Provider-capacity rules

1. Recurring monitoring capacity has priority over historical backfill.
2. Before every paid run, require:

   `remaining provider capacity - maximum possible run charge >= recurring reserve + $10 safety floor`

3. Stop broad historical retrieval when the default package is representative, even if a provider has older results.
4. Split capped runs into bounded, non-overlapping windows only within the approved historical depth.
5. Do not continue spending merely to exhaust provider pagination or close an immaterial historical gap.
6. Record the requested range, returned range, result cap, cost, terminal status, and remaining capacity for every run.
7. Never describe a capped or partial run as complete.

## New-customer workflow

1. Verify the district's controlled accounts.
2. Invite the district to identify exact affiliate accounts it considers part of its communications ecosystem.
3. Capture a pre-run baseline and estimate maximum provider cost.
4. Backfill controlled accounts to the approved owned-Social depth.
5. Backfill Public conversation to 90 days.
6. Add claimed affiliates prospectively unless an extended affiliate backfill is explicitly approved.
7. QA wrong geography, ownership, claimed-affiliate classification, spam, duplicates, URLs, and district isolation.
8. Reconcile dashboard, table, card, and CSV counts.
9. Preserve enough provider capacity for the next recurring cycle.

## Acceptance criteria

- Every visible Social record is classified as district-controlled, district-claimed affiliate, or Public conversation.
- Claimed affiliates have exact account-level evidence and provenance.
- District-controlled and claimed-affiliate metrics are not blended in performance reporting.
- Substantive external discussion remains discoverable even when the originating affiliate post is not shown as district-controlled content.
- Historical coverage stays inside the default package unless an exception is documented.
- Provider cost and capacity evidence exists for each backfill run.
- No cross-district leakage, duplicate canonical identities, unsafe URLs, or legacy review-state rows remain.
- Client-role UI and exports match the reconciled database counts.

## Migration rule for previously excluded affiliates

Do not bulk-reactivate previously excluded school, athletics, program, or booster accounts. First obtain an exact district claim or administrator verification, then reclassify those exact accounts through the audited correction path with backup and readback verification. Existing spam, commercial, duplicate, and wrong-geography exclusions remain excluded.

# Canary manual story corrections

Status: **implemented in production on 2026-07-17**

Production verification completed after application: schema/function read-back, canonical-URL collision analysis, backup-first canonical backfill, audited add → exclude → restore smoke test, dashboard release checks, and ingestion duplicate/tombstone protection.

## Objective

Allow an authorized Canary user to add a missing story, exclude a false positive without deleting evidence, and restore an excluded story. Every change must be district-scoped, attributable, reasoned, atomic, reversible, and safe from ingestion re-creating a duplicate.

## Product behavior

### Add story

Required fields:

- District (fixed to the signed-in user's protected district; selectable only for Canary admins)
- Canonical HTTPS story URL
- Headline
- Source
- Publication date
- Reason for manual addition (minimum 10 characters)

Optional fields: summary, tags, strategic alignment, recommendation, sentiment, and risk. Missing analysis fields can be enriched later by the existing analysis path; the manual story is immediately visible and marked `Manual`.

If the canonical URL already exists:

- Active story: show the existing record; do not duplicate it.
- Excluded story: offer **Restore**; do not insert another record.

### Exclude story

From a story row, select **Exclude**, provide a required reason, and confirm. The story becomes hidden from normal dashboard/export queries but remains stored. No hard delete is permitted.

### Restore story

Excluded stories are visible only in an admin/correction-history view. **Restore** reverses the exclusion and creates a linked audit event. The original exclusion event remains immutable.

## Authorization

- All actions call `requireCanaryActor()` and `assertDistrictAccess()` before mutation.
- Non-admin users cannot submit or override a district ID.
- Canary admins may act across districts; their actor ID is still recorded.
- Browser/client input is never authoritative for actor, role, district ownership, prior state, or timestamps.
- Direct browser access to the audit table is denied; writes occur only through server actions/RPC.

## Proposed storage

### `news_stories` additions

| Column | Purpose |
|---|---|
| `canonical_url text` | Normalized dedupe key |
| `visibility_status text` | `active` or `excluded` |
| `manual_override boolean` | Marks manually added/restored records |
| `correction_version integer` | Optimistic concurrency guard |

A partial unique index on `(district_id, canonical_url)` prevents ingestion from recreating an excluded or manually added story.

### `story_correction_events`

Immutable event ledger containing:

- actor user ID
- district and story IDs
- action (`manual_add`, `exclude`, `restore`)
- required reason
- complete before/after snapshots
- event being reversed, when applicable
- correlation ID, timestamp, and resulting correction version

The ledger is append-only. Updates and deletes are disallowed.

## Atomicity and reversibility

Mutations use transaction-scoped Postgres functions rather than separate browser/API writes:

1. Lock/read the story if one exists.
2. Verify the expected `correction_version`.
3. Mutate/insert the story.
4. Insert the immutable event snapshot.
5. Commit both or neither.

Restore requires the exclusion event ID and records it in `reverses_event_id`.

## Application changes after approval

1. Add protected server actions: `addManualStory`, `excludeStory`, `restoreStory`.
2. Filter normal dashboard/export reads to `visibility_status = 'active'`.
3. Add an **Add story** dialog and per-row **Exclude** action.
4. Add a district-scoped correction-history view for restore and audit review.
5. Show `Manual` and `Restored` badges where applicable.
6. Add deterministic tests for cross-tenant denial, duplicate prevention, required reason, stale-version rejection, exclusion hiding, restoration, and immutable audit history.
7. Update ingestion upserts to use `canonical_url` and preserve excluded/manual records.

## Rollout and verification

1. Back up `news_stories` and capture row/count checksums.
2. Apply the approved migration.
3. Backfill canonical URLs in batches; quarantine collisions for review.
4. Deploy read filtering and server actions together.
5. Test one add → exclude → restore cycle in a designated QA district.
6. Re-run ingestion against the same URL and verify no duplicate/reappearance.
7. Confirm dashboards and exports exclude tombstoned stories and tenant boundaries remain intact.
8. Retain the rollback script and pre-migration backup until production acceptance.

## Approval boundary

No SQL in the companion proposal should be applied until Dustin approves the schema and the collision report from the canonical-URL backfill.

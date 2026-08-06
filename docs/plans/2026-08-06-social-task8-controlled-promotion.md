# Canary Social Task 8 controlled promotion package

## Scope

Promote the reviewed Social v2 application and staged atomic-RPC writers without overlapping the prior writer set. This runbook does not authorize a direct push or merge to `main`; the feature branch must go through the approved pull-request review gate.

## Required preconditions

All conditions must be true immediately before promotion:

1. Task 7 compatibility evidence reports `passed: true`, all four N/N-1 combinations executed, cleanup passed, zero unresolved items, and exact N-1 restoration verified.
2. Task 7 rollback drill reports `passed: true`, zero unresolved replay items, checksum verification passed, and a measured recovery time within the release window.
3. `npm run test:social`, `npm run test:social-migration`, `npm run test:social-db`, `npm run test:quality`, `npm run lint`, `npm run build`, `git diff --check`, and `node scripts/preflight-production-auth.mjs` pass on the exact candidate SHA.
4. Independent review has no unresolved blocking or important findings.
5. The pull request is approved and the candidate is integrated onto current `origin/main` without removing newer production work.
6. The main Canary news ingestion workflow `dVIf6KnZklHYzQvi` is active and has a verified successful post-recovery execution with downstream Supabase writes.
7. All original and staged Social writers are inactive, no Social execution is running, and there is exactly one planned writer for each bounded source/district activation.
8. The production Social row count, excluded count, official-account identity set, schema fingerprint, and rollback artifact checksums match the sealed pre-promotion manifest.

Any failed precondition stops promotion.

## Writer inventory and activation order

Original writers remain inactive throughout the canary period. Staged writers start inactive and contain no inherited schedule trigger until intentionally configured.

| Order | Scope | Original writer | Staged writer |
| --- | --- | --- | --- |
| 1 | Alabaster owned Social POC | `q4kQbkBNt74rjxFZ` | `wtdqOREu9rx9A90x` |
| 2 | Hoover owned Social | `ahyNaIeDA5NecJ0h` | `AX0RTKjCIJt4v6Pv` |
| 3 | Shelby owned Social | `Wfnzq4tbkYUqb3CQ` | `nrj9IFwl2CGdqVin` |
| 4 | Alabaster TikTok discovery | `cp60akEmtVY8GJMp` | `Tx9TwAipVAFfbODj` |
| 5 | Public Social discovery POC | `LhYW2M5c6u6BxVfh` | `WcTnqYT3lEVxfzdB` |
| 6 | All-district Facebook public listening | `Dz0F0PGyZaWppZY9` | `SLZABQRPOmXstYV7` |

Do not activate the next writer until the previous canary passes every verification below.

## Promotion sequence

### 1. Seal the candidate

1. Record the approved application SHA, pull-request URL, Vercel deployment ID, and production alias.
2. Record SHA-256 checksums for the compatibility evidence, rollback evidence, schema/data backups, writer exports, and writer manifest.
3. Re-read the production workflow inventory and Social database boundary immediately before deployment.
4. Abort if a writer is active, a Social execution is running, or counts/fingerprints drifted.

### 2. Promote the application only

1. Merge the approved pull request through GitHub. Do not push directly to `main`.
2. Wait for Vercel to report `READY` for the exact merged SHA.
3. Verify the production alias resolves to that deployment.
4. Run signed admin and client smoke tests:
   - Dashboard and Social Overview load.
   - Posts & mentions loads.
   - Admin can hide and restore a disposable controlled row with exactly one version increment and audit event per action.
   - Client sees only its assigned district and `active` Social rows.
   - Client has no admin navigation or correction controls.
   - MELODI loads active-only Social context.
   - No failed first-party requests or severe console errors occur.
5. If any application check fails, keep every writer inactive and roll the application back to the verified bridge deployment.

### 3. Activate one bounded writer

For each staged writer in the table:

1. Reconfirm the corresponding original writer is inactive.
2. Back up and checksum the staged definition before changing its trigger state.
3. Configure only the approved bounded source/district trigger.
4. Activate the staged writer and read it back by workflow ID.
5. Run one controlled canary execution.
6. Reconcile the execution funnel:
   - provider/raw items
   - normalized valid items and provider errors
   - atomic RPC calls
   - inserted versus refreshed rows
   - duplicates
   - final Social rows
7. Verify every written row has the expected tenant, provider, platform, external identity, canonical URL, relationship type, visibility status, and lineage metadata.
8. Verify stored `excluded` rows remain excluded under replay.
9. Verify no duplicate workflow execution and no duplicate row identity occurred.
10. Verify official-account reporting still uses verified ownership identity, not visibility status.
11. Observe one normal scheduled cycle before advancing to the next writer.

### 4. Final acceptance

After all six bounded writers pass:

1. Confirm exactly one active writer per approved source/district scope.
2. Confirm all original writers remain inactive.
3. Run the complete signed admin/client browser matrix again.
4. Reconcile final Social row counts, excluded counts, official identity checksum, audit events, collection-run health, and provider error states.
5. Save the final manifest and evidence checksums.
6. Post stakeholder/ClickUp updates only after all readbacks are complete.

## Rollback order

Start the recovery timer at the first rollback decision.

1. Deactivate every staged writer and verify no Social execution remains running.
2. Capture post-watermark changes and current N fingerprints/checksums.
3. Restore prior writer definitions while keeping them inactive.
4. Use the verified N-1 application bridge only when its compatibility row remains valid; otherwise keep N serving or enter maintenance.
5. Reverse the schema using the sealed Task 5 rollback package.
6. Restore every preexisting row from the sealed exact-row backup.
7. Replay every post-watermark row through the N-1 inverse policy and fail closed on any unresolved row.
8. Verify the exact N-1 schema fingerprint, grants, functions, triggers, indexes, row counts, per-row checksums, aggregate checksum, statuses, versions, and audit linkage.
9. Restore the N-1 application.
10. Reactivate prior writers one bounded source at a time only after exact N-1 verification passes.

## Stop conditions

Stop immediately and keep or return writers to inactive if any of these occur:

- Application deployment SHA cannot be proven.
- Production schema/data fingerprint differs from the sealed manifest.
- A legacy and staged writer overlap.
- A staged execution produces an unclassified provider error or ambiguous zero-result success.
- An excluded row becomes visible or changes status during replay.
- Tenant isolation, authorization, audit immutability, idempotency, or version checks fail.
- A post-watermark row cannot be deterministically replayed.
- Any backup, evidence, or definition checksum fails.

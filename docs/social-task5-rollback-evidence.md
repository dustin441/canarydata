# Task 5 Social rollback evidence handoff

This is a fail-closed rollback workflow, not authorization to execute against production. Keep every Social writer paused throughout capture, schema reversal, replay, and verification. Retain all generated JSON/SQL files in the approved protected evidence location; the tools create new files with mode `0600` and refuse to overwrite them.

## Required retained inputs

- The production-sealed visibility backup created with `--schema-contract`. `--schema-identity`, `--schema-fingerprint`, and `--expected-row-count` are accepted only with the explicitly unsafe `--unsafe-dev-schema-assertions` flag; such artifacts are labeled `unsafe-development-only` and cannot be restored.
- The hashed schema-contract artifact. It records capture tool version and `task5-n` or `task5-n-1` migration-state identity.
- A fresh rollback-evidence artifact captured from the same watermark. It contains every correction request's payload, stored result, actor, idempotency key, timestamps, row checksum, aggregate checksum, and artifact hash; every post-watermark row's complete content, source identity, replay key, current checksum, audit IDs, and tenant; and immutable audit counts/linkage checksum.
- An optional controlled-QA manifest. Deletion requires exact row ID, `controlled-qa:*` marker, tenant, and current checksum. Rows absent from that manifest are replayed; there is no general-delete disposition.

Normal one-column Supabase SQL Editor CSV downloads are supported by both schema-contract and visibility-backup capture, including quoted JSON cells with doubled quotes. Raw JSON remains supported.

## Handoff sequence

1. Generate/run the read-only contract SQL and create the hashed N contract artifact.
2. Confirm the retained visibility backup is production-sealed and its watermark is authoritative.
3. Set `canary.social_backup_watermark` to that exact watermark and run `supabase/capture_social_rollback_evidence_readonly.sql` read-only. Save the single result cell as JSON or CSV.
4. Create the evidence artifact with `npm run social:rollback:evidence -- --input <export> --visibility-backup <backup> --output <new-evidence-path>`. Add `--qa-fixture-manifest <manifest>` only for controlled fixtures.
5. Create the only accepted schema-reversal handoff with `npm run social:rollback:prepare -- --evidence-artifact <evidence> --sql-output <new-down-sql>`. This embeds evidence counts/hashes into the same transaction as the down migration. The standalone down migration fails closed.
6. Execute the generated down SQL only through the separately approved database channel. It locks and rechecks correction-request content and audit linkage before removing Task 4 runtime/idempotency objects. Missing audit tables, empty look-alikes, changed rows, or changed linkage abort the transaction.
7. Generate restore/replay SQL with `npm run social:visibility:restore -- --artifact <backup> --rollback-evidence <evidence> --sql-output <new-restore-sql>`.
8. Execute the generated restore SQL through the approved channel. It restores backed-up rows exactly, replays real N-created `active` rows to N-1 `review`, keeps N-created `excluded` rows excluded, and removes only exact manifest-verified QA fixtures. Any unresolved row, checksum drift, source-identity mismatch, audit mismatch, or replay failure aborts the transaction.
9. Capture and compare the restored N-1 contract and retain the visibility backup, schema contracts, rollback evidence, generated SQL, and verification output together.

Never edit artifact hashes, generate a fresh checksum to bless changed current state, use the unsafe development mode for a sealed backup, recreate missing audit tables, or delete an unresolved real row.

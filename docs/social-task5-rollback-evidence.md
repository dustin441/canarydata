# Task 5 Social rollback evidence handoff

This is a fail-closed rollback workflow, not authorization to execute against production. Keep every Social writer paused throughout capture, schema reversal, replay, and verification. Retain all generated JSON/SQL files in the approved protected evidence location; the tools create new files with mode `0600` and refuse to overwrite them.

## Required retained inputs

- The production-sealed visibility backup created with `--schema-contract`. `--schema-identity`, `--schema-fingerprint`, and `--expected-row-count` are accepted only with the explicitly unsafe `--unsafe-dev-schema-assertions` flag; such artifacts are labeled `unsafe-development-only` and cannot be restored.
- The hashed production schema-contract artifact. For a production rollback backup it must record capture tool version, the exact additive `task5-n-1` identity, complete Task 4 objects, and the exact Task 4 table/function OIDs. The production verifier seals only `task5-n-1` and `task5-n`; pure N-1 is never a sealable production contract.
- A separate non-sealing pure N-1 baseline artifact captured with `social:schema:verify-restored` before Task 4. It contains the exact object-definition fingerprint for baseline tables, functions, grants, triggers, indexes, policies, and RLS state.
- A fresh rollback-evidence artifact captured from the same watermark. It contains every correction request's payload, stored result, actor, idempotency key, timestamps, row checksum, aggregate checksum, and artifact hash; every post-watermark row's complete content, source identity, replay key, current checksum, audit IDs, and tenant; and immutable audit counts/linkage checksum.
- Every post-watermark row must be replayable through the N-1 writer contract from sealed source identity and audit evidence. There is no generic or manifest-based deletion path; any row that cannot be replayed blocks exact rollback.

Normal one-column Supabase SQL Editor CSV downloads are supported by both schema-contract and visibility-backup capture, including quoted JSON cells with doubled quotes. Raw JSON remains supported.

## Handoff sequence

1. After Task 4 is present and before Task 5, run the read-only contract SQL with `canary.expected_social_state='N-1'` and `canary.expected_social_rows='1032'`, then create the hashed `task5-n-1` contract artifact. The captured fingerprint must include the Task 4 correction/ingestion objects; the N-1 identity describes the pre-Task-5 visibility contract, not their absence.
2. Confirm the retained visibility backup is production-sealed and its watermark is authoritative.
3. Set `canary.social_backup_watermark` to that exact watermark and run `supabase/capture_social_rollback_evidence_readonly.sql` read-only. Save the single result cell as JSON or CSV.
4. Create the evidence artifact with `npm run social:rollback:evidence -- --input <export> --visibility-backup <backup> --output <new-evidence-path>`. Every post-watermark row must carry the sealed source and audit evidence required for N-1 replay.
5. Create the only accepted schema-reversal handoff with `npm run social:rollback:prepare -- --evidence-artifact <evidence> --sql-output <new-down-sql>`. This embeds evidence counts/hashes into the same transaction as the down migration. The standalone down migration fails closed.
6. Execute the generated down SQL only through the separately approved database channel. It locks and rechecks correction-request content and audit linkage before removing Task 4 runtime/idempotency objects. Missing audit tables, empty look-alikes, changed rows, or changed linkage abort the transaction.
7. Generate restore/replay SQL with `npm run social:visibility:restore -- --artifact <backup> --rollback-evidence <evidence> --sql-output <new-restore-sql>`.
8. Execute the generated restore SQL through the approved channel. It restores backed-up rows exactly, replays every N-created `active` row to N-1 `review`, and replays every N-created `excluded` row as excluded. There is no deletion path. Any unresolved row, checksum drift, source-identity mismatch, audit mismatch, or replay failure aborts the transaction.
9. Generate the OID-bound restored verifier from the pure baseline and sealed additive contract with `npm run social:schema:verify-restored -- --baseline-artifact <pure-baseline> --additive-contract <task5-n-1-contract> --sql-output <verify-restored.sql>`. It succeeds only when all three captured Task 4 OIDs are absent and the exact pure baseline object fingerprint is restored. Capture its output with the same tool as non-sealing restored evidence. Production visibility-backup sealing never accepts this evidence.

Never edit artifact hashes, generate a fresh checksum to bless changed current state, use the unsafe development mode for a sealed backup, recreate missing audit tables, or delete an unresolved real row.

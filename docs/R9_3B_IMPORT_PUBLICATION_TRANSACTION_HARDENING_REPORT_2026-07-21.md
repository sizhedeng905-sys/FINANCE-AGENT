# R9.3B Import Publication Transaction Hardening Report

> Date: 2026-07-21
> Status: `engineering_verified_locally / remote_ci_running`
> Issue: `R9-CONFIRM-PUBLICATION-002`

## Failure evidence

GitHub Actions run `29768468874` failed the 30,196-row capacity case after 180 seconds. PostgreSQL facts showed that all 30,196 rows had been processed, all 30,196 staged records existed, and no row error had occurred, while the task remained `confirming`. The final publication path was therefore the failure boundary.

The old path performed three expensive operations in one 120-second interactive transaction:

1. Re-read and deterministically rebuilt every preview row to recompute approval hashes.
2. Published all staged `BusinessRecord`, `ImportRow`, and per-record ledger rows.
3. Wrote the terminal task, audit, and batch ledger facts.

Each 500-row staging transaction also repeated three whole-task count queries. This created avoidable quadratic read pressure and left the atomic publication transaction with insufficient timing margin during WAL/checkpoint pressure.

## Remediation

- Batch progress now advances with lease-fenced atomic increments in the same transaction that stages that batch. A recovered lease still reconstructs counters from PostgreSQL facts before continuing.
- Full deterministic row-set and normalized-output hashes are recomputed before the publication transaction using bounded 500-row keyset batches.
- The integrity preflight renews the owned confirmation lease at one-third of the lease interval and fails immediately if ownership changes.
- The final transaction locks the task and project, revalidates the current approver, account status, project authorization, source, template version, approval snapshot, task version, row counts, record counts, and precomputed hashes before publishing.
- A lease takeover or task-version change invalidates the prepared integrity result. Recovery recomputes it instead of reusing stale data.
- Transient final-publication failures continue to release the lease for bounded recovery. Deterministic record IDs, unique constraints, approval hashes, and terminal ledger idempotency keys prevent duplicate publication.
- Transaction limits and acceptance thresholds were not increased.

No database schema or migration changed.

## Automated evidence

| Command or scenario | Result | Evidence |
| --- | --- | --- |
| Backend build | passed | `npm run build`, exit 0, Prisma generate and both TypeScript builds |
| Backend unit regression | passed | 47 suites, 428 tests, 0 failures, Jest 23.279 s |
| Finalization `P2028` injection | passed | Integrity ran outside the publication transaction twice; lease recovery committed 1,001 records once; one terminal batch ledger event |
| Capacity regression | passed | 2 tests, 30,196 and 49,999 rows, total Jest time 110.318 s |
| Full local PostgreSQL/Redis integration | passed | Redis required; 13 suites / 114 tests passed; 0 skips; 0 failures; 198.807 s |
| Diff hygiene | passed | `git diff --check`, exit 0 |

Capacity samples from the isolated run:

| Rows | Validation | Confirmation | Peak RSS delta | Peak DB connections |
| ---: | ---: | ---: | ---: | ---: |
| 30,196 | 2.836 s | 25.069 s | 406.38 MiB | 6 |
| 49,999 | 5.948 s | 43.300 s | 418.83 MiB | 7 |

The full integration run with all Redis suites required repeated the confirmation times at 25.502 s and 42.954 s. Both cases verified record/value counts, unique source linkage, Decimal totals, confirmed row state, audit events, ledger summaries, and report visibility. Its temporary fixed-digest Redis container was healthy and was removed after the run; the resident Qwen and Paddle containers were not changed.

## Remaining gates

1. Commit `cc033d4` and the R11 documentation are pushed at head `9e889bb`. Build run `29771646166` and CodeQL run `29771646143` must complete successfully; the current status is `remote_ci_running`.
2. H13 target-host testing remains required for storage latency, WAL/checkpoint behavior, p95/p99 latency, and concurrent workload capacity. Local and CI evidence is not a production sizing result.
3. Automatic recovery remains bounded by `IMPORT_CONFIRM_MAX_ATTEMPTS`; exhaustion fails closed for manual investigation.
4. The atomic final update still writes every staged row. If target-host evidence exceeds the publication budget, a separate reviewed design for an atomic batch-visibility marker is required. Timeout inflation alone is not an accepted remedy.

# Ownership repair and V2 transfer test matrix

**2026-10-09 superseding result:** The prior fixture-only table below is historical. A new additive V2 candidate was exercised on a post-repair isolated restore: core, adversarial/RLS, and failure-injection tests passed locally, but the fourth real two-session concurrency case created a source/save ownership mismatch in a local clone. See `V2_TRANSFER_CONCURRENCY_REPORT.md`, `V2_TRANSFER_SECURITY_REPORT.md`, and `V2_TRANSFER_FAILURE_INJECTION.md`. The candidate is rejected outside migrations; Production V2 remains unmodified. This is an absolute release stop, not an outstanding test to waive.

All PASS entries below ran against an **isolated PostgreSQL 18 restore of the Production schema/data** in a transaction that rolled back. No Production test performed a write. The fixture scripts use synthetic UUIDs and `example.invalid` sources. They test ownership semantics and a proposed merge shape, **not** a completed V2 RPC.

| Scenario | Result / evidence |
|---|---|
| Existing one-row mismatch; USER_A and USER_B RLS | **PASS** `scripts/testOwnershipAnomalyRls.sql`: A sees child 1/parent 0; B sees child 0/parent 1; neither authenticated role can UPDATE/DELETE source table. |
| Narrow row repair; repeat; rollback | **PASS** `scripts/testOwnershipRepairDryRun.sql`: 1 row updated, replay matched 0, mismatch 1→0, source row retained, four other-user source links retained, B sees parent+child and A sees neither; outer ROLLBACK restored mismatch 1. |
| Child owner guard rejects foreign owner | **PASS** `scripts/testSourceOwnershipTransferFixtures.sql`: insertion with owner different from save raised the expected trigger error. |
| Unique saved place + source | **PASS fixture**: destination owned one save and its one source in the same local transaction. |
| Duplicate destination place; unique and already-present source identities | **PASS fixture**: both original saved rows preserved; A retained two links; B retained its primary and gained one missing link. |
| Retry same duplicate association | **PASS fixture**: `ON CONFLICT DO NOTHING` inserted zero; B still had one row for that identity. |
| Inject exception after parent owner change | **PASS fixture**: PL/pgSQL exception subtransaction restored original parent/source owners. |
| Zero real saves, tutorial-only; multiple duplicate places; conflicting notes/reminders; jobs/tasks/results/notifications/public shares | **NOT RUN** against a V2 implementation; no V2 RPC exists here. |
| Foreign UUID, tampered/expired grant, cross-user auth, complete-result replay, lost HTTP response, concurrent two-session transfer | **NOT RUN** against a V2 implementation. Must be hard gates. |
| Old-client and 1.5 live end-to-end compatibility/physical upgrade | **NOT RUN** in this forensic pass. |

The three scripts print no real IDs or URLs. They require an isolated restored database and must **never** be pointed at Production. They do not weaken existing tests. Concurrency, complete graph preservation, and client parity remain release blockers.

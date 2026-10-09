# Production ownership repair execution — 2026-10-09

Status: **the one authorized relationship-owner correction committed; release remains BLOCKED pending all later gates.** This report uses the established pseudonyms `USER_A`, `USER_B`, `PLACE_X`, and `SOURCE_Y`. Exact UUIDs remain only in the restricted DPAPI-encrypted local evidence map, not in Git.

## Preconditions and scope

- Production project `rlqvxdwtetxsqxhqztkw`; migration ledger still ended at `20260907000003`; `process-share-jobs` was active v123 with bundle SHA-256 `578f81df4c87b54ec178ee0ce32aadd35be527d6d6f30c0760a0bb8add925339`.
- The 2026-10-08 encrypted `auth,public,storage`-metadata logical backup remained present. Primary archive SHA-256 matched `6680880694350352549680C513A548E1689CA3F079DF7C87FC3A860041591474`; its DPAPI key decrypted, `7z t` passed, and no plaintext SQL/dump files were present in the restricted directory. Its earlier isolated PostgreSQL 18 restore is documented in `PRODUCTION_BACKUP_AND_RESTORE_REPORT.md`.
- Fresh Production read immediately before mutation: global source/save owner mismatches `1`; the only row was the investigated `SOURCE_Y` on `PLACE_X`, owned by `USER_A` while the parent belonged to `USER_B`. It remained the sole child. The completed grant/session still bound A to B and referenced the same saved place. Four independent same-identity links remained. No related job, result, media task, recognition rejection, public share, conflicting unfinished grant, or wrong-owner notification was found.
- The target source still had its exact 2026-09-05 creation/update timestamp and Instagram platform; the parent still had its exact 2026-09-09 update timestamp. Pre-image hashes of the parent, source excluding owner/update timestamp, and the other four complete link rows were captured and used as equality guards.

## Transaction

A single `SERIALIZABLE` Production transaction locked the parent, child, and completed grant/session, verified all preconditions and dependent-row absences, then executed one guarded `UPDATE public.saved_place_sources SET user_id=USER_B WHERE id=SOURCE_Y AND saved_place_id=PLACE_X AND user_id=USER_A AND identity_key=<locked identity> AND updated_at=<expected timestamp>`. The executor required `ROW_COUNT=1` before commit. It then asserted global mismatch count `0`, the same parent and source non-owner hashes, the same four-link hash, unchanged save/source totals, and the same target child count. Any failed assertion raised an exception to roll back the transaction. The CLI returned success; independent read-back below confirms the commit. No SQL containing real IDs was written to the repository or printed in this report.

## Immediate independent read-back

| Check | Before | After |
|---|---:|---:|
| Source/save owner mismatches | 1 | **0** |
| Target child rows on `PLACE_X` | 1 | **1** |
| Other same-identity source links | 4 | **4**, complete-row hash unchanged |
| Total `saved_place_sources` rows | 545 | **545** |
| Total `saved_places` rows | 627 | **627** |

`SOURCE_Y` retained the exact row ID and `saved_place_id`, now with `user_id=USER_B`. Its canonical identity and every non-owner/non-update field retained the same hash. `PLACE_X` retained its complete-row hash. The source `updated_at` changed as expected under the existing trigger to `2026-10-09 19:25:45.6392+00`; its `created_at` did not change. No other same-identity link changed.

Authenticated-role RLS read-back with each user's claim: `USER_A` sees `0` target source rows and `0` target saves; `USER_B` sees `1` source and `1` save. Neither role has source-table UPDATE or DELETE privilege. The full relationship audit is in `PRODUCTION_RELATIONSHIP_INTEGRITY_POST_REPAIR.md`.

No schema migration, Edge deployment, Railway deployment, Production OTA, App Store upload, or main merge was part of this repair. A fresh encrypted post-repair backup and restore test are required before any 1.5 parity deployment.

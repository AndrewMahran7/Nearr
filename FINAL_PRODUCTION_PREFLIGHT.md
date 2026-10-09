# Final Production preflight — 2026-10-09 UTC

Status: **PASS for read-only integrity; deployment NOT authorized.** This is not an immediately-before-deployment recheck. Repeat it if the release resumes.

- Production Supabase ref: `rlqvxdwtetxsqxhqztkw`. The isolated CLI workdir was used; the release worktree's Supabase link still targets Development `qnfxnmvxpjzfydgudtvs`.
- Migration ledger last entry: `20260907000003`. The October 8/9 compatibility migrations are not applied.
- Auth users/profiles: 105/105; saved places/source relationships: 627/545; share jobs/notification events: 903/337.
- Saved-source ownership mismatches: 0; orphan relationships: 0; duplicate `(saved_place_id, identity_key)` groups: 0; relevant live unexpired pending transfer grants: 0.
- `process-share-jobs`: ACTIVE v123, bundle SHA-256 `578f81df4c87b54ec178ee0ce32aadd35be527d6d6f30c0760a0bb8add925339`, JWT verification disabled.
- Railway Nearr Production service `59234570-e2ec-4a7e-86de-22826da86c66`: deployment `6e78ebe9-58f7-4799-a90e-86238a1b14e9`, SUCCESS; unchanged.
- Previously repaired ownership row was not mutated again. Aggregate mismatch count remains zero. The earlier one-row identity/access proof is in the existing repair report; it was not unnecessarily repeated.

The notification no-duplicate gate is red; see `FINAL_NOTIFICATION_QUALIFICATION.md`. No Production schema, Edge, or Railway release change was made.

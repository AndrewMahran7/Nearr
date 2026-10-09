# Saved-place/source ownership race — final local qualification

Status: **FIXED IN CODE / READY TO RESUME THE NEARR 1.5 RELEASE GATES.** This is not Production deployment approval. The five migrations in `supabase/migrations/20261009000001`–`20261009000005` are the deployable successor; `V2_TRANSFER_REJECTED_CANDIDATE.sql` remains explicitly outside that directory. The unsafe Development V2 migration was not promoted.

## Restore and migration rehearsal

The previously created encrypted post-repair Production logical backup was restored to an isolated local PostgreSQL 18 database; no storage object bytes were handled. Inner schema/data hashes were reverified against the encrypted archive. A fresh clone of that restore accepted the provider-name migration followed by all five new migrations in filename order. The starting and final restored counts were **627 saved places, 545 source links, 0 owner mismatches**. Validated constraints: `saved_places_id_user_id_key` and `saved_place_sources_owner_fk`. Both tables retained RLS, and V1/attach and V2 RPCs remained executable by authenticated users.

After qualification, the temporary plaintext restore SQL files were re-archived into a separate encrypted, password-verified 7z archive and removed from the restricted work directory. Six databases created for this task were dropped by exact name; the two pre-existing `nearr_prod_rehearsal` databases and local PostgreSQL cluster were left alone.

Restored-row parity before versus after the complete ordered migration replay (MD5 of ID-ordered JSON rows):

| Table | Rows | Before = after |
|---|---:|---|
| `saved_places` | 627 | `4bfa724ce637ac7b1b13f9ed5d1f8247` |
| `saved_place_sources` | 545 | `f7cf15619f14760f6ce7af18d733144d` |
| `auth.users` | 105 | `e3659c7c4b46cf21eab04465e3844fe0` |

## Gates run

- All seven SQL suites passed on the clean ordered replay: `testSavedPlaceSourceOwnerInvariant.sql`, `testSafeOnboardingV2Core.sql`, `testSafeOnboardingV2Security.sql`, `testSafeOnboardingV2Failure.sql`, `testLegacyV1TransferSafety.sql`, `testSourceAttachmentClientContracts.sql`, and `testDualClientDatabaseContracts.sql`.
- Three deterministic two-session scripts passed: V2 duplicate late source, V1 duplicate late source, and V2 late new save. They tested both transfer-first and writer-first interleavings.
- The original four-case V2 concurrency harness passed on the final ordered replay.
- `testSavedPlaceSourceOwnerRaces.ps1` passed 260 real two-session pairs: 50 same-grant completions, 60 transfer/source inserts, 50 forced source-first transfers, 50 distinct duplicate merges, and 50 same-source races. A focused 50-pair run through the actual attachment RPC alternated authenticated/manual and service-role/recognition-worker calls. Final mismatch **0**, deadlock delta **0** in both runs; see `V2_TRANSFER_CONCURRENCY_REPORT.md` for timings and rejected approaches.
- `testProductionDualClientStaticContracts.ts` and `testAnonymousOnboardingV2.ts` passed against the public 1.4.55 and build-58 source contracts. These static checks complement, but do not replace, the authenticated database suites.
- A separate read-only Production query through an isolated CLI work directory returned **mismatch_count = 0**. Its local CLI link was subsequently unlinked. No Production data/schema, Edge, Railway, OTA, or App Store Connect change was made in this task.

## Boundaries and next step

The database-level composite FK prevents any supported writer from committing a source relationship whose owner differs from its parent; the converted-account guards prevent loss of a late A source or save after duplicate conversion. Existing V1 public-client signatures remain; V2 is additive. Ambiguous metadata/reminder and active-work cases fail transactionally instead of silently dropping user data. The database and static client tests do **not** constitute physical-device or live-Production smoke qualification. Resume the wider Nearr 1.5 release plan, including notification concurrency, zero-diff recognition replay, trustworthy Edge v123 rollback, old/new live client checks, Production rollout/monitoring, and only then any existing-build upload. No forced update, main merge, public release, or Production OTA is authorized by this report.

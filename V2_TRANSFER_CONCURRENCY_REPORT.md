# V2 transfer concurrency — final local qualification

The former parent-lock-only candidate failed a real two-session unique-transfer/late-child race with one committed owner mismatch. It remains quarantined as `V2_TRANSFER_REJECTED_CANDIDATE.sql`, outside migrations. The new composite owner FK plus post-conversion write guards were tested on disposable clones of the repaired Production-schema/data restore; no Production migration was run.

`scripts/testSavedPlaceSourceOwnerRaces.ps1` completed 260 independent two-session pairs on the final migration set:

| Race | Pairs | Result |
|---|---:|---|
| Two completions of one grant | 50 | One completion and one replay each; one grant, one destination save/link graph. |
| Transfer versus direct source INSERT | 60 | One child committed first and cascaded; 59 stale inserts rejected; none remained A-owned under a B parent. |
| Forced child-first source transaction, then transfer | 50 | All children committed and cascaded. The advisory-lock signal proved INSERT completed before transfer began. |
| Two distinct anonymous accounts merging one B place | 50 | Both transfers completed; B retained three distinct source identities, both original A graphs retained. |
| B receives the same canonical source through direct insert and V2 copy | 50 | Exactly one B identity/link and one retained A link each. |

Final global mismatch count in the stress clone: **0**. `pg_stat_database.deadlocks` delta: **0**. Pair wall-clock p95 **2688.1 ms**, max **2884.9 ms**; this includes PowerShell job/psql startup and deliberate two-second forced-order fixture sleeps, so it is not an RPC latency benchmark. The script cloned only a local rehearsal database and dropped the clone in `finally`. A separate 50-pair run through the actual `attach_saved_place_source` RPC alternated authenticated/manual and service-role/recognition-worker modes: all passed, mismatch **0**, deadlock delta **0**, p95 **911.6 ms**, max **1066.1 ms** with process startup included.

The original four-case `testSafeOnboardingV2Concurrency.ps1` also passed on the final ordered replay: duplicate completion, concurrent duplicate merge, destination same-source race, and transfer/late-source race. Deterministic V1 and V2 duplicate-late-source scripts each passed transfer-first rejection and child-first copy. The V2 late-new-save script passed transfer-first rejection and save-first transfer of both save and source.

Two *fixture* problems were fixed during iteration: a 0.7-second advisory signal occasionally expired before PowerShell polling (raised to two seconds), and `$i:a1`-style interpolation collapsed distinct test identities (changed to `${i}`). Neither was accepted as a product pass. A genuine intermediate product failure—duplicate A source committed after B's copy while ownership mismatch stayed zero—led to migration `20261009000004`; a late whole-save gap led to `20261009000005`.

These results measure representative same-save contention and show no broad table lock or observed deadlock in the tested cases. They do not claim exhaustive scheduling coverage or production latency. PostgreSQL's [composite FK cascade](https://www.postgresql.org/docs/current/ddl-constraints.html) and [row-lock conflict behavior](https://www.postgresql.org/docs/current/explicit-locking.html) supply the invariant beyond sampled interleavings.

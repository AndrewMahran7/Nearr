# Recognition fix integration

## Lineage

The current Development OTA was re-verified as group `d511f9b0-40bc-4630-ab17-4336932d0147`, runtime `1.4.55`, iOS and Android, Git commit `497e4f49162ce45a40f351eb6e2f18b9b51a96fa`. The isolated branch `integrate/recognition-fix-dev-migration-reconciliation` was created from that exact commit. Recognition source `9b0bda39f22b7b810c3c7d49b76e26d6156b5586` is a direct child, so integration was a clean `--ff-only` update with no content conflict and no loss of newer Development work.

The seven historical SQL blobs were then restored without importing historical app/Edge/worker monetization implementation. That repairs migration provenance while preserving the current suspended runtime.

## Semantic overlap review

| Surface | Resolution |
| --- | --- |
| `process-share-jobs` | Recognition commit retained structured source geography, non-null `evidence_snapshot: []`, deterministic-error fail-fast classification, terminal-state cleanup, and stage diagnostics. |
| `process-share-link` | Entity-role classification and Greece geography extraction layer on the existing Priority-1 geography policy. Bare brand/person/product/event/ambiguous mentions do not receive venue-identity boosts. |
| recognition pipeline / worker | Worker retains the quality pipeline; only deterministic schema/contract errors terminate immediately. Transient acquisition/provider/model failures retain legitimate retries. |
| queue/result state | Failed jobs hide parked candidates; review candidates require an authoritative review state; candidate geography is not promoted to source geography. |
| notification routing | Notification creation and tap routing use current authoritative state and job-ID refresh. |
| share-job screens | Weak candidates remain Possible match; failed jobs cannot reopen as Quick Check. |
| migration history | Exact Dev-applied blobs `20260910000001`-`000007` precede the new additive `20260914000002`; only the new migration is pending. |
| package scripts/tests | Added an environment-specific migration-history contract and write-capable deploy preflight; updated one stale cache-v2 source assertion to the current dedicated-RPC contract. |
| media worker | `sourceGeography` is passed separately from evidence arrays; no provider or recognition-quality path is removed. |
| flags/monetization | Historical schema is present, but no monetization runtime source was merged and all six Dev suspension flags remain false. |

There were no merge conflicts because the completed recognition commit's parent exactly equals the live Dev source. The only semantic reconciliation judgment was to restore SQL provenance alone, rather than merge stale experimental runtime code.

The Recognition Cache V2 suite contained one September 6 assertion requiring `p_force_rerun: true`. Restoring the missing SQL correctly did not revive that obsolete client argument: the September 9 canonical Dev migration made normal completed jobs non-reusable and introduced an exact-request-only qualification RPC, while September 10 added the isolated onboarding QA RPC. The test now asserts those two current server contracts and explicitly rejects resurrection of the retired force-rerun argument; runtime code was not changed to satisfy the stale assertion.

The Premium suspension suite also predated the current global suspension and expected a now-removed token-store route plus Development CTA/reservation behavior. It now verifies the actual fail-closed contract: no client CTA/store, all six Development flags false, rejection before wallet/RPC work, zero new reservations, preserved ledger/schema, and retained server processing for any historical in-flight request. No runtime behavior was changed for this test update.

## Preserved contracts

The integrated tree contains Priority-1 structured geography propagation, `SUPPORTED` / `UNKNOWN` / `CONTRADICTORY` policy, geographic autosave gating, sticky review, named-lead safety, server completion validation, atomic canonical/result updates, decision diagnostics, and Possible-match presentation. It also contains the Greece/Prada entity-role policy (`LOCATION`, `VENUE`, `BRAND`, `PERSON_CREATOR`, `PRODUCT`, `EVENT_TOUR`, `AMBIGUOUS`), valid media enqueue shape, deterministic fail-fast behavior, authoritative result/notification state, and stage timing diagnostics.

## Migration `20260914000002`

The migration adds nullable `share_media_tasks.source_geography jsonb`, a bounded object-or-null check (`<= 4000` serialized bytes), and a column comment. It changes no RPC, policy, index, token table, balance, ledger, purchase, RevenueCat, or user data. Adding a nullable no-default column is metadata-only; replacing/validating the check takes a brief table lock and scan, with existing rows satisfying it because the new value is null. Existing clients ignore the additive column. A forward migration is the operational rollback method; a direct column drop is mechanically possible but is not appropriate after clients write it.

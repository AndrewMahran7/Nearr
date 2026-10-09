# Production relationship integrity after the one-row repair — 2026-10-09

Read-only aggregate checks were run against Production project `rlqvxdwtetxsqxhqztkw` immediately after the guarded repair. Counts are a point-in-time audit, not a permanent database constraint.

| Check | Count |
|---|---:|
| `saved_place_sources.user_id <> saved_places.user_id` | **0** |
| Source link without saved place / source link without auth user / save without auth user | 0 / 0 / 0 |
| Duplicate `(user_id,place_id)` saves / `(saved_place_id,identity_key)` links | 0 / 0 |
| Job / result / media-task saved-place owner mismatch | 0 / 0 / 0 |
| Notification / public-share-save / recognition-rejection saved-place owner mismatch | 0 / 0 / 0 |

The repaired link retained its ID, saved-place ID, and source-identity/non-owner hash. The parent hash, four other same-identity links' complete-row hash, and save/source row totals were unchanged. Under authenticated RLS, the former anonymous owner sees neither the link nor parent, and the destination owner sees both. The existing source `updated_at` trigger intentionally changed only that timestamp in addition to the requested `user_id` correction.

The legacy v1 account-transfer RPC remains capable of reintroducing this owner mismatch if it moves another saved place with source children. Until the new V2 path is proven and Production parity is deployed, keep the zero-mismatch query as a repeated release and monitoring gate. Do not add a hard deferred trigger in this release without the separate writer inventory and qualification requested by the release plan.

Final read-only Production recheck after the local V2 race and cleanup (2026-10-09): global source/save owner mismatch count remained **0**. The failed V2 concurrency case was confined to a dropped local clone; no V2 RPC was applied to Production.

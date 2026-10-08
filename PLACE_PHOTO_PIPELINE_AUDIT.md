# Place photo pipeline audit

Date: 2026-10-08
Scope: Nearr Development only

## Root causes found

The backend and provider could return multiple photos, but three client boundaries reduced them to one:

1. share-job candidate conversion discarded `photoUrl` and `photoUrls`;
2. the saved-place snapshot and image store persisted only `hero.jpg`;
3. Recent Finds did not retain `candidate_snapshot`, so its immediate image continuity depended on a later fetch.

Tutorial fixture detail also initially depended on server-shaped hydration instead of its bundled image inventory.

## Canonical contract

`lib/placePhotos.ts` defines `PlacePhotoSet`, `MAX_PLACE_PHOTOS = 5`, stable ordering, and deduplication. Provider URLs that differ only by Google sizing parameters are treated as the same underlying photo. The honest contract is "up to five": if the provider supplies one distinct image, Nearr shows one rather than cloning it.

Snapshot schema v3 stores both `localImageUri` and ordered `localPhotoUris`. `lib/savedPlaceImageStore.ts` writes `hero.jpg` plus `photo-2.jpg` through `photo-5.jpg`.

## Data flow

```text
candidate photoUrl/photoUrls
  -> lossless share-job conversion
  -> canonical ordered/deduplicated PlacePhotoSet (max 5)
  -> save result and candidate_snapshot
  -> primary image persisted on the critical save path
  -> photos 2-5 persisted progressively off the critical path
  -> snapshot v3 references all successful local files
  -> restart hydration prefers local files, then known remote URLs
```

There is no screen-driven Google photo request. Screens consume the canonical inventory already captured by the save pipeline. A process-local task gate prevents duplicate progressive writes for the same user/place.

## Surface continuity

| Surface | Image source and behavior |
|---|---|
| Normal incoming queue | Candidate photo inventory; no Development preview cards |
| Quick Check | `photoUrls`, first image immediately, adjacent images loaded only when visited |
| Save result | Returned canonical photo inventory |
| Recent Finds | Immediate `candidate_snapshot`, then local persisted snapshot |
| Saved list/map card | Persisted primary local image with known remote fallback |
| Detail/gallery | Ordered local + known remote inventory, up to five |
| Tutorial fixture | Bundled fixture images immediately; no server hydration required |

Development preview entries remain available only in `/dev-qa`.

## Restart and cost behavior

The first image remains synchronous so the saved card never intentionally becomes blank. Additional distinct photos persist in the background and update the durable snapshot on completion. After a simulated process restart, hydration reads all stored local photo files. Lazy gallery behavior remains intact: the primary is rendered first and neighboring items are not eagerly prefetched.

## Regression proof

- `npm run test:place-photo-contract`: one through ten provider images, stable ordering, dedupe, max-five cap, converter preservation.
- `npm run test:saved-place-snapshots`: schema-v3 read/write and process-restart hydration.
- `npm run test:saved-place-images`: hero and secondary local-file persistence.
- `npm run test:google-cost-controls-integration` and `npm run test:google-cost-controls-ux`: no extra screen-driven provider requests and lazy image behavior.
- `npm run test:quick-check-rolodex-ux`: Quick Check image inventory behavior.

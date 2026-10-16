# Fieldnotes October 15 performance comparison

The requested interactions were exercised in the actual Android debug app. These samples do not demonstrate a persistent performance regression, and they do not establish a causal performance improvement or predict release/iPhone performance. Absolute Android debug jank remains substantial in several samples.

## Conditions and measurement

- Same Pixel 8a AVD, `emulator-5554`, 1080×2400, density 420, fontScale 1, animator duration scale 1; existing debug Development app, Hermes and Metro bundle.
- Before source: `f51dfdb75dcdee3e02ceb848875e2cea46632d42`. The main after pass records `33aa1498d185d3e83b8d36b6bbb1d357ea84135d`. The supplemental zoom sample records `19cb9a04f1e3b6d4310c2650ebe35285f387b6de`, which adds only the Settings large-text layout and its regression test. The OTA report identifies the final published source.
- `scripts/profileFieldnotesOct15.cjs` resolves actual native accessibility nodes and their bounds, verifies the fixture surface, resets app `gfxinfo`, performs the interaction, then reads `dumpsys gfxinfo com.nearr.app framestats` after a 1.2-second settling interval. Wall times include automation waits and are not input-response latency.
- Map fixtures contain 1, 5, 20 and 100 synthetic Development saves. Saved scrolling uses 25 read-only public place names. Activity uses read-only processing/review/recovery/completed fixtures. Gallery is actually opened before swiping between two distinct bundled Dorset Quarry images. Search types the local saved-note query `pizza` and verifies Bantam; it submits no discovery/provider request.
- The tables take the **first aggregate** total, nonlegacy jank, 50th percentile and 95th percentile from each sample. `gfxinfo` repeats per-window sections; these are not summed or counted twice. In particular, the inactive gallery window's zero-frame/4950ms percentile block is not a measured gallery delay.

Raw records: `artifacts/fieldnotes-oct15/performance-before.json` and `performance-after.json`. Native screenshot/XML/metadata companions are in the adjacent `performance-before/` and `performance-after/` directories. Each is a single short interaction sample, not a repeated statistical benchmark.

## Comparable interaction samples

Times are milliseconds. Jank is the aggregate Android frame-deadline classification, not the separate legacy classification.

| Interaction | Frames before → after | Median before → after | p95 before → after | Jank before | Jank after |
| --- | ---: | ---: | ---: | ---: | ---: |
| Map pan, 1 save | 75 → 114 | 32 → 23 | 69 → 48 | 47/75 (62.67%) | 31/114 (27.19%) |
| Map pan, 5 saves | 62 → 122 | 36 → 18 | 101 → 46 | 50/62 (80.65%) | 30/122 (24.59%) |
| Map pan, 20 saves | 76 → 141 | 34 → 16 | 85 → 38 | 50/76 (65.79%) | 24/141 (17.02%) |
| Map pan, 100 saves | 108 → 155 | 32 → 15 | 57 → 27 | 53/108 (49.07%) | 17/155 (10.97%) |
| Saved scroll, 25 saves | 120 → 141 | 34 → 23 | 53 → 48 | 47/120 (39.17%) | 24/141 (17.02%) |
| Activity scroll | 142 → 164 | 34 → 24 | 53 → 36 | 28/142 (19.72%) | 6/164 (3.66%) |
| Gallery swipe, 2 images | 157 → 158 | 20 → 23 | 34 → 40 | 13/157 (8.28%) | 16/158 (10.13%) |
| Local search typing | 18 → 17 | 17 → 17 | 121 → 65 | 12/18 (66.67%) | 13/17 (76.47%) |

Map and gallery actions each use four alternating horizontal swipes within the measured native surface; map swipe duration is 500ms. Saved and Activity each use four alternating vertical swipes within their native scroll-container bounds, 550ms each. The fixture counts and scripted actions match; uncontrolled host load, cache state and Metro/debug overhead do not.

## New-action and supplemental after-only samples

No matched before measurement exists for these actions; they are functional/performance observations, not before/after speed claims.

| Interaction | Native action | Frames | Median | p95 | Jank |
| --- | --- | ---: | ---: | ---: | ---: |
| Show All, 20 saves | Three labeled-button taps, 700ms apart | 60 | 25 | 117 | 25/60 (41.67%) |
| Pin selection, 1 save | Tap the singleton marker found in the native tree | 19 | 27 | 53 | 7/19 (36.84%) |
| Card expansion | Tap the selected card's labeled details action | 23 | 16 | 34 | 4/23 (17.39%) |
| Map zoom, 20 saves | Three double taps in measured map bounds, 700ms between gestures | 69 | 20 | 53 | 33/69 (47.83%) |

The Show All capture shows ten visible clusters of two, accounting for the 20 fixture saves in clear map space. Native pin-selection and card-expansion captures retain the selected marker above its card. The repeated native Show All taps settle between invocations; immediate in-flight coalescing and camera ownership are tested separately in the runtime regression suite.

## Interpretation and limits

The map, Saved and Activity samples have lower median/p95 and aggregate jank after the changes, but this single debug pass cannot attribute those differences to code. Marker density/photo budgets and list virtualization remain bounded; no speculative rendering rewrite was made to chase noisy emulator numbers.

Gallery median increased by **3ms** and p95 by **6ms**, with jank increasing from 13 to 16 frames across similarly sized 157/158-frame samples. Search retained a 17ms median and had a lower p95, while its jank fraction increased by one classified frame in a very small 18/17-frame sample. These observations do not demonstrate a persistent regression; one pass also cannot rule one out. No unsupported speedup or smoothness guarantee is inferred from them.

App `gfxinfo` incompletely represents the map's native SurfaceView/compositor work. Host contention, debug instrumentation, Metro, native caches and rendering state affect timing. Percentiles describe the sampled app frames, not complete map animation quality, provider-network latency or physical touch responsiveness. There is no matched release build, iOS/MapKit measurement or physical-iPhone result here. Founder QA should check actual pan/zoom, repeated Show All, pin/card transitions and gallery continuity on the Development OTA; persistent device-observed stutter would warrant a focused release-profile investigation.

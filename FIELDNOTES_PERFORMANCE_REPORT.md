# Fieldnotes performance report

This report separates deterministic behavior checks from actual Android rendering observations. No result here establishes iPhone release performance.

## Deterministic behavior and cost checks

- `testFieldnotesMapSearch` passes 0, 1, 5, 20, 100 and 1,000-save fixtures. At most three photo markers are eligible; nonselected markers only read an existing local snapshot. The selected marker remains eligible and discovery is explicitly gated offline.
- The final desktop policy run measured approximately 0.23 ms at 0 saves, 0.10 ms at 1, 13.82 ms at the first 5-save call, 0.04 ms at 20, 0.08 ms at 100 and 0.80 ms at 1,000. These are isolated desktop JavaScript observations, including cold locale/sort setup, not native frame times or a speedup claim.
- Map visibility, camera ownership, clustering, expansion, conservation, camera transactions and atomic representation tests passed. The existing 500-operation reliability scenario reported no marker loss, duplicate representations, invalid membership or camera loops. The 1,000-operation transaction scenario reported no dead cluster taps, stacking, unintended selection or missing markers.
- The Google cost-control regression passes its 15 scenarios. Saved search stays local; discovery hydrates only the active visible result, selected image lookup is coalesced, and unselected marker imagery does not issue provider hydration requests.
- Saved remains virtualized. Its 0/1/20+ component fixtures and real 25-name native sample retain existing callbacks and sorting/filtering behavior. No backend recognition or persistence algorithm was changed.

## Android observation method

`scripts/profileFieldnotesAndroid.cjs` uses an installed debug APK on an Android 16 Pixel 8a AVD (4 cores, 3072 MB, GPU mode `auto`, 1080×2400 at density 420). Font scale and animator duration scale were restored to 1 and the app cold-restarted before measurement. It resets `dumpsys gfxinfo com.nearr.app`, performs four alternating native map pans for explicit 1/5/20/100-save Development-only synthetic fixtures, then records sanitized summary statistics. It separately scrolls the actual Saved component with 25 real public business names, scrolls Activity, sends gallery swipes across the two bundled photos, and types a local saved-note query with the native keyboard open. Raw app/auth/network logs are not committed.

The source of truth for completed samples is `artifacts/fieldnotes-implementation/native-performance.json`. Each density sample first verifies its visible count in the native accessibility tree and captures a matching framebuffer. App `gfxinfo` measures the Android view renderer and does not fully account for the Google Maps SurfaceView. Debug logging, Metro and an emulator also change timing substantially. The Windows host experienced memory pressure and a developer-server chunked-response failure during recovery; startup/tool-recovery delays must not be interpreted as app release launch performance. No native before/after baseline was measured, so there is no claimed native speedup or regression percentage.

## Observed results

The run completed all eight samples. The table uses the first app-global summary from each `gfxinfo` result; repeated individual-window lines in the filtered JSON are not counted again. The frame populations are small, their interaction durations differ, and Google Maps has its own rendering surface. These values must not be compared as a density-scaling benchmark.

| Surface and data | Frames | Janky frames | Median | 95th percentile |
| --- | ---: | ---: | ---: | ---: |
| Map, 1 synthetic save | 33 | 31 (93.94%) | 65 ms | 129 ms |
| Map, 5 synthetic saves | 21 | 21 (100.00%) | 150 ms | 550 ms |
| Map, 20 synthetic saves | 28 | 26 (92.86%) | 150 ms | 800 ms |
| Map, 100 synthetic saves | 47 | 43 (91.49%) | 46 ms | 133 ms |
| Saved, 25 real public names | 126 | 28 (22.22%) | 32 ms | 53 ms |
| Activity, read-only queue fixtures | 101 | 60 (59.41%) | 53 ms | 77 ms |
| Gallery, 2 bundled photos | 64 | 40 (62.50%) | 44 ms | 129 ms |
| Local search, `pizza` → Bantam | 17 | 16 (94.12%) | 32 ms | 129 ms |

The emulator showed severe rendering jank. This is **not a native performance pass** and it is not evidence of an improvement over 1.5. Debug execution, the emulator and observed host memory pressure are confounding conditions; this run does not isolate their contribution or identify a product-code cause. The 1/5/20/100 count headers and captured UI were independently verified, while deterministic camera/marker behavior is supported separately by the tests above.

The required next acceptance step is a release-like Development build on a physical iPhone, with before/after profiles for the same map densities and scrolling/search/gallery gestures. Physical iPhone startup, sustained memory, battery use, VoiceOver responsiveness and haptic timing remain unmeasured in this Windows environment. A successful iOS cloud build and OTA publication do not close that performance gap.

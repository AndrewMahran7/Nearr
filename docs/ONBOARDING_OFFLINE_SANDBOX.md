# Deterministic Offline Onboarding Sandbox

## Boundary

`onboarding/fixtures` owns serializable practice content and results. `onboarding/assets` is the only media adapter used by the practice UI. `OnboardingV2PreAuth` may import that sandbox and the local state adapter; it must not import live share, social, Places, map-provider, worker, or save clients.

The boundary ends at `account_required`. Authentication and subsequent real-app activity use the existing live services.

## Deterministic matrix

Every supported platform has all three content categories:

| Choice | Platforms | Scripted place | Bundled poster |
| --- | --- | --- | --- |
| Outdoors / Beaches | Instagram, TikTok, Facebook, YouTube | Dorset Quarry | `dorset-quarry-source-frame.jpg` |
| Food / Cafes | Instagram, TikTok, Facebook, YouTube | Mad Yolks | `food-cafe-poster.png` |
| Travel / Things to do / Shopping / Anything | Instagram, TikTok, Facebook, YouTube | Hydra Old Town | `travel-town-poster.png` |

The platform controls branding, creator metadata, content ID, and share-sheet label. The category controls caption, media, place, address, coordinates, place type, AI note, directions copy, and nearby examples.

## Scripted timing

| Offset | State shown |
| ---: | --- |
| 0 ms | Post received |
| 420 ms | Scanning video |
| 900 ms | Looking for clues |
| 1380 ms | Matching the place |
| 1850 ms | Found result |

The durable state enters `tutorial_processing` immediately after the Nearr tap. On resume, remaining time is derived from the persisted `tutorialLaunchedAt`; if the deadline has passed, the same result resolves immediately.

## Persistence and isolation

The selected fixture, synthetic job ID, scripted result, and synthetic save are encoded in the existing V2 AsyncStorage state. IDs use `onboarding-scripted-*` prefixes. They never enter `share_jobs`, `media_tasks`, `saved_places`, recognition cache, notification jobs, token ledgers, Google telemetry, or the real map dataset.

The local detail screen reads the fixture registry by the persisted fixture ID. Closing detail moves to the existing value and permission education. “Making Nearr Yours” records local readiness only, then routes to the account screen. Once authentication succeeds, onboarding can finish and the real app behaves normally.

## Regression guards

- `npm run test:onboarding-fully-offline`: matrix, assets, local state progression, scripted recognition/save/detail, resume, outage equivalence, timing, and mutation isolation.
- `npm run test:onboarding-no-live-services`: forbidden-import/media/UX guard and post-auth networking boundary.
- `npm run test:onboarding-v2`: existing state, visual, resume, auth, and accessibility contracts.

## Physical airplane-mode QA

Start Metro before enabling airplane mode so the development client can load the JavaScript bundle, or install an OTA/binary that already contains it. Once the bundle is loaded, force-close, enable airplane mode, reset onboarding using the Development QA control, relaunch, and proceed through saved-place detail and permission/value education. No source, image, recognition, share-job, Places, or map-tile request is required.

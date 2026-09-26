# Onboarding fixture media audit

Date: 2026-09-25
Lane: Development only
Method: read-only Nearr-Dev database inspection, source playback review, local package verification

No user IDs, emails, profile names, private captions, or other user PII are recorded here.

## Atomic fixture rule

Each logical fixture owns one `assetKey`, one place identity, one local silent loop, one local poster, and one or more local place images. `offlineOnboardingMedia(assetKey)` returns that package as a unit. Platform/category selection may choose a fixture but cannot swap individual media members. Phase 1 accepts no runtime media URL.

## Complete platform/category matrix

| Platform shell | Category | Place/result identity | Atomic media key | Previous source presentation | Audit result |
| --- | --- | --- | --- | --- | --- |
| Instagram | Outdoors | Dorset Quarry | `dorset_quarry` | Static Dorset frame | Replaced by exact-place loop and photos |
| Instagram | Food | Mad Yolks | `mad_yolks` | Generic cafe poster | Replaced; former venue mismatch removed |
| Instagram | Travel | Hydra Old Town | `hydra_old_town` | Generic town poster | Replaced by exact-place fallback package |
| TikTok | Outdoors | Dorset Quarry | `dorset_quarry` | Static Dorset frame | Replaced by exact-place loop and photos |
| TikTok | Food | Mad Yolks | `mad_yolks` | Generic cafe poster | Replaced; former venue mismatch removed |
| TikTok | Travel | Hydra Old Town | `hydra_old_town` | Generic town poster | Replaced by exact-place fallback package |
| Facebook | Outdoors | Dorset Quarry | `dorset_quarry` | Static Dorset frame | Replaced by exact-place loop and photos |
| Facebook | Food | Mad Yolks | `mad_yolks` | Generic cafe poster | Replaced; former venue mismatch removed |
| Facebook | Travel | Hydra Old Town | `hydra_old_town` | Generic town poster | Replaced by exact-place fallback package |
| YouTube | Outdoors | Dorset Quarry | `dorset_quarry` | Static Dorset frame | Replaced by exact-place loop and photos |
| YouTube | Food | Mad Yolks | `mad_yolks` | Generic cafe poster | Replaced; former venue mismatch removed |
| YouTube | Travel | Hydra Old Town | `hydra_old_town` | Generic town poster | Replaced by exact-place fallback package |

Interest aliases stay deterministic: Beaches maps to Outdoors; Cafes maps to Food; Things to do, Shopping, and Anything map to Travel. Each platform retains its existing platform-specific mock shell while consuming the same place-correct package for the selected category.

For all 12 mappings, the recognition result, saved-place card, map pin, detail hero, AI note, and nearby-example copy come from the same fixture object. The map card uses the second place photo; source/reveal surfaces use the local poster or loop. Nearby examples are text-only and do not claim unrelated imagery.

## Dorset Quarry

- Fixture/place: `dorset_quarry` / `onboarding-place-dorset-quarry` / Dorset Quarry (Development record name: Dorset Marble Quarry).
- Old media: a single bundled source frame (`assets/onboarding/dorset-quarry-source-frame.jpg`). It did not provide authentic motion.
- Selected source: existing active Nearr-Dev curated Instagram reel, `https://www.instagram.com/reel/C9Z963muLHI/`.
- Database provenance: exact source is attached to the Dorset place in Nearr-Dev and has successful Development processing history. The audit was read-only.
- Visual verification: the source and extracted stills show the quarry and cliff/water activity; place name, address, coordinates, note, video, and photos are consistent.
- Local package:
  - `dorset-quarry-loop.mp4` — H.264, 540×960, 8.5 s, silent, 1,432,328 bytes, SHA-256 `e363f632d7aed8274352ef422d950757550be924fe30e88ca8c180acea2e3768`
  - `dorset-quarry-poster.jpg` — SHA-256 `e9cbbea0a36657cc6e3e049c4cfbea5e364f0f333205321b4b4623bae8dca2b1`
  - `dorset-quarry-place-2.jpg` — SHA-256 `c10b432a741f6e1a1c3c0a782ff8a1d3d1c91ff76b8aeeab1c1b731ecd17cd5d`

## Mad Yolks

- Fixture/place: `mad_yolks` / `onboarding-place-mad-yolks` / Mad Yolks.
- Old media: generated generic food/café poster (`assets/onboarding/offline/food-cafe-poster.png`), which was not venue-specific.
- Selected source: existing Nearr-Dev Instagram source, `https://www.instagram.com/p/C-BEtdnyGdR/`.
- Database provenance: the exact source is present on a Development saved-place row for Mad Yolks. The older row predates child-source normalization, so provenance is the legacy `source_url`; the audit was read-only.
- Visual verification: motion frames show Mad Yolks food and explicit “MAD YOLKS SANTA CRUZ, CA” source text. Video, images, restaurant identity, address, coordinates, and note agree.
- Local package:
  - `mad-yolks-loop.mp4` — H.264, 540×960, 10 s, silent, 1,050,809 bytes, SHA-256 `32f3733115b45e8e3e4a4af55110aa5737c5a8dabbbc5ea48b2a5e6c58929eb1`
  - `mad-yolks-poster.jpg` — SHA-256 `e818e976b11769c69edceae96920ca3fddd45e52e34de7297118818b201640de`
  - `mad-yolks-place-2.jpg` — SHA-256 `d1e6f3eda746d0061bcdeaeeb4017825c623d9626c3cd1a0fbccb2007811844a`

## Hydra Old Town

- Fixture/place: `hydra_old_town` / `onboarding-place-hydra-old-town` / Hydra Old Town.
- Old media: generated generic travel-town poster (`assets/onboarding/offline/travel-town-poster.png`), which was not Hydra-specific.
- Nearr-Dev audit: no Hydra place, saved source, fixture, or relevant job payload existed. The code and this audit therefore do not claim Nearr database provenance.
- Selected fallback: exact-place public footage, `https://www.youtube.com/watch?v=6e38Z0ErVoU`, used only as a locally packaged Development onboarding fallback.
- Visual verification: selected frames show Hydra Town rooftops and stone pedestrian lanes. The wide source is centered on a 540×960 solid background without stretching or substituting another place.
- Local package:
  - `hydra-old-town-loop.mp4` — H.264, 540×960, 10 s, silent, 823,683 bytes, SHA-256 `c6bb2b4d62c501e8d970e83a075ffc74c998da3e266ec326b13c269a9452349d`
  - `hydra-old-town-poster.jpg` — SHA-256 `2b02863d1a39fb00b6f83ce2fe80be4a3f69f312dfb0a55379a36828bce87a10`
  - `hydra-old-town-place-2.jpg` — SHA-256 `cc6cc0908cbb9721208fcfc7a930ab8e5f1e903fb8f9d9258d813e177dae50b5`

## Runtime and privacy conclusions

- Every Phase 1 source is bundled, muted, looping, deterministic, and usable with Supabase, Google, Railway, and the social sites unavailable.
- Public provenance URLs are audit metadata only. Playback takes a numeric local module asset; the component API cannot accept a remote URL.
- Phase 2 is a separate explicit boundary. Only “Try with a real video” establishes anonymous Development auth and uses the installed share extension/normal backend.
- The audit did not mutate Development data and did not query Production.

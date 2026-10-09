# Fieldnotes real-content QA

The read-only audit on October 9, 2026 targeted **Nearr-Dev** (`qnfxnmvxpjzfydgudtvs`) explicitly. It issued three REST GET requests using credentials held only in memory. It made no data, schema, worker, recognition or provider-photo changes. Reproduce with `node scripts/fieldnotesRealDataQa.mjs` using an authorized Supabase CLI session.

## Observed content

| Content | Observed |
|---|---|
| Places | 64; all had coordinates; longest name 47 characters; longest address 90 |
| Saved places | 20; 11 generated notes, up to 108 characters; no populated user-written notes |
| Saved source types | 11 Instagram, 5 YouTube, 4 manual |
| Share jobs | 67: 30 completed, 27 needs-help, 8 failed, 2 awaiting-purchase |
| Job platforms | 39 Instagram, 24 YouTube, 3 TikTok, 1 Facebook |
| Candidate payloads | 54; every sampled candidate lacked photo URLs |

Counts describe the audited records. Candidate payloads are not device-local photo snapshots: zero payload URLs do not prove that a founder's installed app has no cached photos. Existing pending purchase records were read and left unchanged.

`artifacts/fieldnotes-implementation/real-data/development-content-audit.json` records counts and limitations. `public-place-content.json` contains 25 public business/destination names, addresses, coordinates and provider IDs for the read-only native content preview. It contains no user identities, user notes, source links, authentication material or signed image URLs.

## Coverage and evidence classes

| Case | Evidence |
|---|---|
| Real long names, international text and addresses | 25-place native Saved preview uses the audited public place data; `fieldnotes=real-place` opens the longest name with the real detail component |
| Missing photography | All 54 audited candidate payloads exercise the importance of truthful fallback; real-content native preview adds no photo request |
| Available photography | `fieldnotes=photo-place` uses the existing bundled Dorset Quarry onboarding place with its two genuine bundled images; it does not claim five images |
| Zero / one / 20+ places | Saved host tests cover 0/1/5/20/50/51/100; native read-only preview supports 0/1/25 |
| Five-photo limit | Real component host tests cover 0/1/5 image contracts and preserve existing bounded hydration; a real five-photo device snapshot remains founder QA |
| Large type and small widths | Actual component host trees tested at multiple widths/text scales; native Android captures are separately labelled |
| Multi-place partial results | Existing 0/1/2/5/8-place, missing-coordinate, overlapping/distant-coordinate and partial-save fixtures retain durable outcome/selection contracts |
| User notes | No real populated user note was present in the Development sample; long-note behavior is synthetic contract coverage |
| Private, deleted or expired original | Recovery/receipt contracts are tested; external social-app access on an iPhone is pending |

The Development QA adapter mounts the existing React Native screens/components inside the existing `/dev-qa` recovery owner. It requires the verified Development environment, `__DEV__`, and the process-local map-preview flag. It neither fabricates a session nor changes the production auth gate. Activity preview mutations and refresh are disabled. Real-content previews are inspection surfaces, not saved records. Native screenshots must be read together with their route/content manifests.

No live social ingestion, Google/Apple OAuth, remote notification delivery, physical haptics or founder-account changes were performed by this audit. Those are explicitly listed in the founder checklist.

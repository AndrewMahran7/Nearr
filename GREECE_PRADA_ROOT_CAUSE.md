# Greece/Prada founder QA root cause

## Scope and identity

- Environment: Development Supabase `qnfxnmvxpjzfydgudtvs`.
- Pseudonymous job ID: `d6382d4cd48f`.
- Submission: share extension, Instagram, normal free lane.
- Created: `2026-09-15T00:04:29.680604Z` (`2026-09-14 17:04:29.680604 PDT`).
- Terminal `completed_at`: `2026-09-15T00:08:05.087Z`.
- Last row update: `2026-09-15T00:08:05.524416Z`.
- Persisted terminal duration: **215.406 seconds**.

The private source URL, user ID, and push token are intentionally omitted.

## Confirmed reconstruction

1. Open Graph metadata retained the caption/title text “The Pump Foil tour made it to Greece” and the tagged accounts `@prada`, `@redbull`, and `@redbullgre`.
2. `extractHandles` removed no creator because provider-authored creator identity was absent. It treated all three remaining tagged accounts as venue-like handles.
3. `extractEvidence` had no caption venue hint and promoted the first “venue” handle into `venueNameHints`: `@prada` became the name hint `Prada`.
4. The query ladder issued the clean search `Prada`. Google Places returned at least the two persisted US stores.
5. `placeScoring.scoreCandidates` added `business_type` and `compact_name_match`. The sigmoid normalized that score to `0.9168273035060777`, which the client mapped to **High match** at the `>= 0.78` evidence-strength band.
6. The previous metadata autosave gate correctly blocked automatic saving with `handle_identity_only`, but it did not change the candidates' presentation confidence.
7. The explicit word `Greece` was not represented in `sourceGeography`: the old caption geography extractor only recognized US city/state structure, while `sourceGeographyFromTaggedLocation` only accepted a platform location tag. The row persisted `sourceGeography: null`.
8. Before media fallback, `enqueueMediaTask` intentionally parked the speculative metadata candidate payload on the parent job. The queue read the first candidate's address and displayed **San Francisco, CA** while the parent remained active. That was **current candidate geography**, not source geography.
9. The media-task insert then wrote `evidence_snapshot: null`. Migration `20260821000001_video_ai_note_guarantee.sql` requires a non-null JSON array, so every insert failed with the retained error: `enqueue_media_task_failed: null value in column "evidence_snapshot" ... violates not-null constraint`.
10. The generic error harness classified that deterministic contract error as retryable. The job was reclaimed five times (four retries) by the per-minute durability sweep, repeating metadata work and failing at the same insert boundary.
11. No `share_media_tasks`, `share_media_runs`, `share_agent_runs`, extraction-failure, or place-result row exists. Media download, audio, Whisper, frames, Gemini, Sol, worker Places resolution, and worker callback never ran.
12. At max attempts, the job became `failed / technical_failure`. The failure notification was internally consistent, but the parked high-scored metadata payload remained. The old detail-state adapter prioritized persisted candidates over `status=failed`, producing the contradictory Prada Quick Check after a failure push.

## Why San Francisco appeared early

Exact field chain:

`share_jobs.candidate_payload.candidates[0].formattedAddress`
→ `app/share-jobs/index.tsx`
→ `splitPlaceAddress(firstCandidate.formattedAddress).locality`
→ queue row locality.

It did not come from the creator profile, device location, a default bias, stale previous job, or source geography. It came from the first speculative Google Places candidate parked before the failed media-task insert.

## Confirmed cause versus hypothesis

Confirmed:

- `@prada` produced the `Prada` place-name query.
- The query produced the two persisted Prada store candidates.
- `business_type + compact_name_match` produced the `0.916827...` score and High label.
- Greece was retained only as raw source metadata, not as structured source geography.
- the five deterministic insert failures caused the 215-second terminal delay.
- terminal failure plus parked candidates caused the contradictory notification/Quick Check state.

Not recoverable from historical telemetry:

- exact timestamps for each Edge claim, metadata request, and metadata Places request;
- exact metadata provider/Places call counts per retry;
- exact client receipt/render timestamps (the recording supplies approximate bounds only).

## Implemented correction

- A conservative entity-role policy makes a bare tagged account `AMBIGUOUS`, not a venue. Explicit sponsor/person/product/event/locative relationships classify separately.
- Only `VENUE` or `LOCATION` role permits full text-name confidence without independent address/platform-location evidence. Role-limited matches are demoted and marked discovery-only.
- An explicit locative country mention is retained as source geography. The founder caption yields `country=Greece`, `scope=country`, `kind=explicit_caption_place`.
- Country context scopes every metadata query and context ranking; US Prada candidates are geographically contradictory.
- Recognition source geography now uses a dedicated bounded `share_media_tasks.source_geography` object. `evidence_snapshot` remains the non-null AI-note evidence array it was designed to be.
- Schema-contract enqueue failures are terminal on the first attempt instead of consuming four minute-spaced retries.
- Processing queue rows show only retained source geography, never candidate geography.
- `failed` is authoritative in the detail mapper and notification composer; parked candidates cannot resurrect Quick Check.
- Notification taps with a job ID always open the job detail, which fetches current durable state rather than trusting stale notification outcome fields.

## Offline founder replay

Before:

- roles: all tagged accounts implicitly venue-like;
- place name: `Prada`;
- source geography: null;
- queries: `Prada`;
- US candidates: score `0.916827`, High match;
- task insert: failed five times;
- final UI: technical-failure notification, then high-confidence candidate picker.

After, using the same retained caption and candidates with no paid calls:

- `Greece`: `LOCATION`, explicit caption country geography;
- `@prada`, `@redbull`, `@redbullgre`: `AMBIGUOUS` bare tagged accounts;
- queries remain bounded to Greece context;
- bare-account text equality cannot contribute strong name evidence;
- the retained US Prada candidate is `CONTRADICTORY` and cannot autosave or display High;
- media task inserts with `evidence_snapshot=[]` and separate `source_geography`;
- if recognition truly fails, failure stays failure; if it yields reviewable candidates, the backend must persist `needs_help` and send review copy.

The deterministic replay is in `scripts/testRecognitionEntityRoleLatencyState.ts`.

# Nearr — Cross-Platform Media Regression Corpus

A durable testing asset for the metadata + media evidence pipeline
(`supabase/functions/process-share-link`, `supabase/functions/process-share-jobs`,
`services/media-worker`). Grew out of the 2026-08-15 stabilization pass that
traced and fixed three real production bugs (Snapchat "Snap Headquarters",
YouTube `<Null>` candidates, TikTok App Store redirect contamination — see
git history for the full trace).

## Two layers, on purpose

| Layer | File | Runs when | Needs network? |
| --- | --- | --- | --- |
| A — deterministic | `scripts/testEvidenceProvenanceRegressions.ts` | Every `npm run test:prebuild` / CI | No |
| B — live corpus | `scripts/mediaLiveRegression.ts` | Opt-in only (`RUN_LIVE_MEDIA_REGRESSION=1`) | Yes |

**Layer A is the actual regression guard.** It pins the exact bytes that
caused each bug as tiny hand-written fixtures (a Twitter Card meta tag, a
minified-JS config-blob substring, a resolved app-store URL) and asserts the
fixed pure functions reject them. It is cheap, deterministic, and never
touches the network — safe to run on every commit.

**Layer B exercises the real corpus** (`scripts/mediaRegressionCorpus.json`)
against live platform URLs. It is inherently flaky (creators delete videos,
platforms change, rate limits happen) — see "Why live corpus failures don't
fail the build" below.

## Corpus manifest — `scripts/mediaRegressionCorpus.json`

Each entry:

```jsonc
{
  "id": "youtube_south_oc_pizza_roundup_01",
  "platform": "youtube",
  "url": "https://youtube.com/shorts/...",
  "addedDate": "2026-08-15",
  "groundTruth": {
    "verifiedBy": "<< HOW the expected value was independently established — required, non-circular >>",
    "hasIdentifiablePlace": false,
    "notes": "..."
  },
  "expected": {
    "contentCategory": "food",
    "geographyHints": ["Orange County", "CA"],
    "forbiddenCandidates": ["<Null>", "..."],
    "forbiddenRegions": ["OR", "NM"],
    "minDecision": "manual_fallback_no_candidates_or_correct_ca_picker"
  }
}
```

### Ground truth MUST NOT be circular

`groundTruth.verifiedBy` is required and must describe independent
verification — reading the real og:title/description, real captions/
transcript (for TikTok, a caption read from a web search result before ever
running the URL through Nearr counts; TikTok's own extraction environment
remains fragile enough that some entries may still need an honest
`"unverified"` state with the reason instead). **Never** fill in
`groundTruth` by running Nearr and copying its own answer. An entry whose
`verifiedBy` just says "Nearr resolved it to X" should be rejected in
review.

### Current status: honest Phase 1, not the 25-video target

The design target is ~5 per platform (25 total), diverse across evidence
types (explicit speech, on-screen text only, caption-only, transcript city
mention, list/roundup, hidden-location style, non-food, weak/no evidence).
**What's actually in the corpus today is smaller** — 13 entries (1 Snapchat, 5
YouTube, 2 Facebook, 2 TikTok resolution-stage, 1 TikTok acquisition-only, and
2 verified but unqualified Instagram candidates) — because building the rest requires the same rigor already
applied here: fetching a real public URL, reading its real content BEFORE
running Nearr on it, and writing down how. That's genuinely slow to do by
hand and wasn't rushed to hit a count. See "Expanding the corpus" below.

**Instagram has two independently grounded candidates, but neither is
qualified.** Historical qualification evidence is deliberately not treated as
part of the canonical runtime contract.

**YouTube has two independently grounded hidden-location controls, but neither
is qualified.** Their historical wrong saves predate the exact-identity policy;
they remain regression controls rather than tutorial fixtures.

**TikTok now has two resolution-stage entries**
(`tiktok_coffee_shop_explicit_address_01`, `tiktok_nyc_restaurant_roundup_01`)
verified live in production on 2026-08-15, once the media-worker was fixed
to let `yt-dlp` download the picked CDN URL itself (`TikTokMediaResolver`'s
`skipDirectUrl`) rather than re-fetching it directly — TikTok's CDN 403'd a
direct fetch even with the correct `Referer` forwarded. The original
acquisition-only entry (`tiktok_pizza_discovery_content_unverified_01`)
stays as-is; it guards a different, still-relevant bug (the app-store
redirect) and its content was never independently read.

## Expanding the corpus

1. Find a real, currently-public URL on the target platform.
2. Fetch/read its REAL content first — og:title/description, captions, or
   watch the video — and write down `groundTruth.verifiedBy` describing
   exactly how (quote the real text where practical).
3. Only then add `expected` — what a correct resolver run should and must
   not produce. `forbiddenCandidates`/`forbiddenRegions` are usually easier
   to state honestly than a single "correct" gold place; use them freely.
4. Run `npm run test:media-live-regression -- --stage=acquisition` for the
   new entry before committing it, so a dead/broken URL is caught
   immediately rather than silently sitting in the corpus.

## Why live corpus failures don't fail the build

Public videos get deleted, URLs expire, and platforms change their pages
constantly. `scripts/mediaLiveRegression.ts` therefore distinguishes:

- **`fixture_unavailable`** (URL 404s, video removed, platform blocks
  automated access) — reported, but does NOT count as a Nearr regression.
- **A resolver correctness failure on a still-reachable, still-live gold
  case** (e.g. a `forbiddenCandidates` entry actually appears in the
  candidate list) — this fails loudly; it means the code, not the corpus
  entry, is wrong.

Layer A (deterministic) remains the CI source of truth precisely because it
can't suffer from link rot.

## Running

```bash
# Layer A — every prebuild run, no network:
npm run test:evidence-provenance

# Layer B — opt-in, needs network + yt-dlp on PATH:
RUN_LIVE_MEDIA_REGRESSION=1 npm run test:media-live-regression
# Stages (default: acquisition; resolution is more expensive — hits Google
# Places / the AI evidence model for the gold subset only):
RUN_LIVE_MEDIA_REGRESSION=1 npm run test:media-live-regression -- --stage=resolution
```

## Never commit downloaded media

The corpus stores URLs and independently-established expectations only.
Never commit a downloaded video/audio/frame file. The live harness cleans up
any temp artifacts it produces.

## Tutorial recognition qualification (ONB2-01)

Tutorial qualification is a stricter, Dev-only layer over the same manifest.
Entries opt in with a `tutorial` object containing independently established
place ground truth, source health, single-place/trivial-disclosure flags,
eligibility, allowed terminal outcomes, and repeat-run statistics. Ground truth
is read only after a job finishes. `buildShareJobRequest` deliberately emits
only `{ url, clientRequestId, qualificationMode: 'fresh_media' }`; the expected Google Place ID never enters
extraction, media analysis, candidate generation, or ranking.

Eligibility is fail closed:

- `primary` and `backup` require verified ground truth, a healthy timestamped
  source identity, a public single-place source, no dominant exact-place
  disclosure, complete place identity, and at least three fresh all-correct
  Dev runs. Media-driven fixtures must observe media fallback every time.
- Any confidently wrong singleton or wrong automatic save is a hard failure.
- Qualification statistics record wrong results and wrong saves separately;
  either must be zero for `primary` or `backup` eligibility.
- A picker, manual fallback, or no candidate is a controlled non-success. It is
  safe behavior but cannot qualify a tutorial source.
- Deleted/private/login-wall/provider-page sources and timeouts are tracked as
  infrastructure/source failures, not recognition passes.
- `candidate` is unqualified inventory; `quarantined` and `ineligible` are
  never selected by the qualification runner.

The deterministic contract is in
`scripts/testTutorialRecognitionCorpus.ts` and
`scripts/tutorialRecognitionSafetyFixtures.ts`. It includes creator identity,
tagged collaborator, same-name wrong-city, multiple-branch, roundup, weak
handle-only, unavailable source, provider redirect, and structurally valid but
semantically wrong singleton cases. Existing extraction-level coverage remains
in `scripts/share-extraction-fixtures.json`; redirect/roundup/platform-noise
bytes remain covered by `scripts/testEvidenceProvenanceRegressions.ts`.

### Real Dev qualification

`scripts/qualifyTutorialRecognition.ts` uses the real asynchronous path:
`create-share-job` followed by RLS-scoped polling of `share_jobs` and
`share_job_place_results`. It requires an explicit dedicated Dev test identity;
the account must have server-controlled `app_metadata` identifying
`account_class=dedicated_dev_test` and
`purpose=onb2_tutorial_qualification`. There are no fallback credentials. It
refuses to run unless both environment
declarations are `development` and both Supabase/function hosts exactly match
the checked-in Dev project ref.

```powershell
$env:RUN_LIVE_TUTORIAL_QUALIFICATION = '1'
$env:NEARR_TEST_EMAIL = '<dedicated Dev test account>'
$env:NEARR_TEST_PASSWORD = '<password>'
npm run qualify:tutorial-recognition -- --id=instagram_dorset_quarry_visual_candidate_01 --attempts=3
```

An explicit `NEARR_TEST_ACCESS_TOKEN` may be used instead. Useful filters are
`--platform=instagram`, `--attempts=3`, `--timeout-ms=300000`,
`--inter-attempt-ms=0`, and `--output=<new-file-path>`. The default delay is
zero because each distinct request ID now uses the guarded fresh mode. Reports default to
the OS temporary directory and
contain job IDs and recognition evidence, never credentials. Runs create real
Dev jobs and may create saved places in the dedicated test account; do not use a
personal account. The authenticated client cannot read service-role-only
`share_media_tasks`, so media fallback is reported from parent-job stage
transitions and extraction diagnostics rather than private worker rows.

Before a release, run the deterministic test, the acquisition health probe,
then the real Dev qualification for every `primary`/`backup` entry. Quarantine
any source that becomes unavailable, ambiguous, or wrong. This is intentionally
a checked-in manifest plus an on-demand command, not a production monitor.

### Platform audit (2026-09-08)

| Platform | Metadata / normalization | Media fallback | Current tutorial evidence |
| --- | --- | --- | --- |
| Instagram | `detectPlatform` accepts Instagram URLs; `fetchPostMetadata` reads public HTML; tagged-location/profile evidence is handled under `evidence/`. Public Reels can also return login/interstitial variants. | `InstagramMediaResolver` uses bounded `yt-dlp`; optional `HttpMediaFetchResolver` exists. | Two public, independently grounded candidates acquired successfully, but 2026-09-08 Dev qualification was only 2/3 and 0/3. Neither is eligible. |
| TikTok | `normalizeShareUrl` handles canonicalization/short links; `fetchPostMetadata` follows redirects and uses the official keyless oEmbed fallback when metadata is thin. App-store redirects are rejected. | `TikTokMediaResolver` uses the shared bounded `yt-dlp` path; CDN/direct-fetch restrictions remain fragile. | Two real sources exist, but one exposes the exact address and one is a five-place roundup. Neither is tutorial-eligible. |
| Facebook | `detectPlatform` handles `facebook.com` and `fb.watch`; the generic metadata path captures the post-redirect URL. | `FacebookMediaResolver` uses the shared bounded `yt-dlp` path for video/reel hosts. Login walls and URL-shape changes remain external risks. | The public controls are a no-place how-to and an exact-name Villa Invernizzi post. Neither demonstrates hidden-place recognition. |
| YouTube | `detectPlatform` handles Shorts, watch URLs, and `youtu.be`; all use the same metadata path. | `YouTubeMediaResolver` uses `yt-dlp`, prefers manual/automatic captions, then falls through to bounded audio transcription and frames. | Acquisition was healthy for two independently grounded hidden-location finalists, but Spectra produced 3/3 wrong saves and Attabad Lake produced 2/3 wrong saves. No tutorial-eligible source is qualified. |

The relevant implementations are
`supabase/functions/process-share-link/platform/detectPlatform.ts`,
`supabase/functions/process-share-link/metadata/fetchMetadata.ts`, and the four
platform resolvers under `services/media-worker/src/resolvers/`.

`scripts/phase2-gold-set.json` also contains 22 Instagram business/restaurant
rows with exact Google Place IDs. They remain useful resolver regression data,
but were not silently promoted: that format does not record independent source
verification, trivial-disclosure suitability, source health, or repeat runs,
and many entries are deliberately venue/address-forward.

### Cost and scheduling

The deterministic corpus test is network-free and appropriate for CI. The
acquisition health probe consumes public-platform bandwidth and `yt-dlp` work
but does not submit Nearr jobs. A real qualification run can consume Supabase
Edge invocations, Railway worker compute, external media bandwidth, Google
Places requests, configured Gemini/model calls, configured transcription/OCR
calls, and any configured HTTP media-provider credits (for example a
ScrapeCreators-compatible fetch provider). The repository does not expose
reliable per-run dollar telemetry, so this document intentionally gives no
invented price. Run repeated qualification manually before releases or after a
recognition/provider change; do not put it in ordinary CI.

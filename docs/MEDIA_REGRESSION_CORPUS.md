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
transcript, or (for TikTok, where automated access is currently blocked from
this environment) an honest `"unverified"` state with the reason. **Never**
fill in `groundTruth` by running Nearr and copying its own answer. An entry
whose `verifiedBy` just says "Nearr resolved it to X" should be rejected in
review.

### Current status: honest Phase 1, not the 25-video target

The design target is ~5 per platform (25 total), diverse across evidence
types (explicit speech, on-screen text only, caption-only, transcript city
mention, list/roundup, hidden-location style, non-food, weak/no evidence).
**What's actually in the corpus today is smaller** — 6 entries (2 Snapchat, 3
YouTube, 1 Facebook, 1 TikTok acquisition-only, 0 Instagram) — because
building the rest requires the same rigor already applied here: fetching a
real public URL, reading its real content BEFORE running Nearr on it, and
writing down how. That's genuinely slow to do by hand and wasn't rushed to
hit a count. See "Expanding the corpus" below.

**Instagram has zero entries.** No public Instagram URL was independently
verified during this pass. Add one the same way as the others: find a real
public reel/post, read its real caption, THEN add the entry.

**TikTok has one acquisition-only entry.** TikTok's anti-bot layer blocked
both `yt-dlp` and the official oEmbed endpoint from the environment this
corpus was built in (same limitation documented in `docs/MEDIA_FALLBACK.md`).
Its `groundTruth.hasIdentifiablePlace` is honestly `"unverified"`; it exists
to guard the app-store-redirect bug (`forbiddenCandidates`), not to assert a
correct place. Do not upgrade it to a resolution-stage gold case without
first genuinely verifying the video's content (from a residential/mobile
network, per the project's no-anti-bot-evasion constraint).

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

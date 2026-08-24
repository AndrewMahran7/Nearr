# Vayrin Quick Check evidence model

## Confidence

CONFIDENCE SOURCE: `candidate.matchScore`, the deterministic resolver's normalized evidence-strength/ranking score, or an explicit `high | medium | low` producer decision.

CONFIDENCE INTERPRETATION: qualitative evidence strength only. The resolver's numeric value is not calibrated as a probability (the legacy scoring code describes its sigmoid as cosmetic), so Quick Check never displays it as a percentage. Existing resolver thresholds map scores to `High match` (>= 0.78), `Medium match` (>= 0.55), or `Low match`. Missing/invalid scores render no confidence claim. Ranking position alone never creates a label.

## Evidence correspondence

The media worker retains only frames that were supplied to analysis. When Vayrin reports `selectedTimestampsSeconds`, only those selected frames are eligible. Candidate `frame` evidence timestamps are ordered first; remaining selected frames provide bounded coverage. The UI says `Matched frames: N of M` only for persisted evidence items whose source is explicitly `frame`. Speech, caption, and visible-text timestamps never become matched-frame claims.

## Persistence and lifecycle

- Private Supabase Storage bucket: `share-evidence`.
- Maximum retained frames per recognition task: 5.
- Maximum bytes per retained JPEG: 768 KiB.
- Object path: `<user>/<share-job>/<media-task>/<index>-<timestamp>.jpg`.
- The worker's service role uploads; the app signs URLs only when the authenticated user owns the parent share job.
- The app removes referenced objects before deleting the share job. Frames otherwise live for the share-job/result lifetime.
- All videos, audio, unselected frames, hashes, and temp files keep the existing immediate cleanup behavior.
- If upload/signing fails or an older result has no references, recognition/save remains available and the UI says frames were not retained.

Worst-case retained storage is 3.75 MiB per analyzed share job; typical 768px JPEGs are materially smaller. No frame is retained for insufficient-evidence outcomes or AI-note enrichment tasks.

## Request behavior

- Visible candidates: maximum 3.
- Place details/photo request: maximum one cached details request per visible canonical Place ID.
- Place photo references: maximum 5 per candidate.
- First two carousel images hydrate initially; later images hydrate only as the user swipes.
- Private source frames resolve in one batched signed-URL request and remain cached until shortly before expiry.
- Worker persistence: one bounded Storage listing, at most one batched stale-object removal, and at most 5 uploads. Retries upsert stable task-scoped paths.

## Default card hierarchy

1. Place name and locality.
2. Large photo carousel.
3. Qualitative Vayrin match strength when supported.
4. One concise matched-frame or category line.
5. `Why this match?` expansion with at most four structured, plain-language observations.

Raw OCR strings, transcripts, caption fragments, provider names, prompt text, model traces, and internal reasoning are never rendered.

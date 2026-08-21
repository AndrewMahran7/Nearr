# Facebook ingestion parity boundary

Facebook-specific processing ends at two adapters:

1. `lib/shareAgent/facebookUrl.ts` validates Facebook content URL families,
   removes tracking, expands already-visible numeric identities to an exact
   `facebook.com/reel/<video-id>/` source, and marks opaque redirect URLs for
   server-side expansion.
2. `FacebookMediaResolver` maps the public yt-dlp response onto the existing
   `ResolvedMedia` contract (local media, caption, canonical URL, source id,
   and creator/page attribution).

After those adapters, Facebook uses the platform-neutral durable path:

`share_media_tasks -> ffprobe/normalization -> audio/transcription ->
timestamped frames/OCR -> AnalyzeInput -> existing Nearr/Vayrin resolver`.

No Facebook-specific recognition or place-ranking rule is introduced.

## Provenance

Saved-place video provenance remains the existing atomic pair:

- `saved_places.source_type = 'facebook'`
- `saved_places.source_url = <exact canonical Facebook content URL>`

The parent job additionally records bounded public provenance in
`extraction_payload.sourceIdentity` (HTML path) or
`extraction_payload.sourceProvenance` (media path): canonical URL, platform
content id, creator/page id/name/handle when exposed, caption source, and
whether media was acquired. Creator/page identity is attribution and
diagnostic context only; it is never treated as the filmed destination.
The bounded public title/description is retained in
`extraction_payload.sourceMetadata` so async recognition does not discard the
caption after using it.

Facebook's current public HTML and yt-dlp extractor fixtures expose no typed
post place/check-in field. Caption locations remain caption evidence. No page
address or inferred location is promoted into tagged-location evidence.

## Expected integration overlap

`feat/tiktok-parity` may also edit `lib/shareAgent/tiktokUrl.ts`,
`detectPlatform.ts`, `fetchMetadata.ts`, `process-share-link/index.ts`,
`create-share-job/index.ts`, `process-share-jobs/index.ts`, shared worker media
types, and `ytDlpShared.ts`. Reconciliation must retain TikTok redirect/oEmbed
behavior and Facebook's host-safe adapter call, 4,000-character evidence
caption bound, metadata provenance fields, and optional media source identity.
Platform-specific URL parsing should remain in the separate Facebook and
TikTok helpers. Both branches use the long-form ingestion-caption helper;
preserve its 10,000-character abuse bound while leaving the legacy
240-character preview cleaner unchanged. The media resolver keeps its existing
4,000-character bounded callback contract.

The Vayrin, AI-note, and onboarding branches should consume the canonical
source/provenance contract; they should not copy Facebook acquisition logic or
replace shared recognition behavior.

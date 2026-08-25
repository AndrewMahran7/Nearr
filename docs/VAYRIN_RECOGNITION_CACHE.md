# Vayrin recognition cache and multi-source places

Status: production release implementation, semantically integrated onto current `main`. Deployment state is recorded in the release report rather than this architecture document.

## Identity audit

Before this change, Nearr's strongest identities were:

- Instagram: a validated `/p|reel|reels|tv/<shortcode>` content URL. Tracking was removed, but creator-prefixed and canonical paths were not reduced to one explicit key.
- TikTok: the numeric post ID from exact `@creator/video/<id>` URLs, normalized to `https://www.tiktok.com/@<lowercase-creator>/video/<id>`. `vm`, `vt`, and `/t/` links were expanded by the server metadata boundary before this ID became available.
- YouTube: a tracking-cleaned URL/platform classification; there was no shared explicit video-ID key.
- Facebook: the numeric video/reel ID where exposed, a post/story ID where exposed, or an opaque `fb.watch`/share token until a provider redirect disclosed the numeric ID. Numeric videos normalize to `/reel/<id>/`.
- Generic: the normalized URL, with known tracking parameters removed.

`lib/shareAgent/contentIdentity.ts` now makes the stable contract explicit:

```text
identity_key = v<identity_version>:<platform>:<provider content id>
fallback     = v<identity_version>:<platform>:<normalized URL>
```

YouTube watch, short, embed, live, and `youtu.be` forms converge on the video ID. Instagram creator-prefixed and `reels` forms converge on the shortcode. TikTok and Facebook redirect forms are recomputed after their resolved URL is known. No raw URL is the only cache key, and tracking parameters never create a second identity.

## Lookup and trust flow

```text
incoming URL
  -> tracking-safe URL normalization
  -> canonical content identity (provider ID when already visible)
  -> RECOGNITION CACHE LOOKUP
       trusted place -> existing save/autosave contract -> attach source
       candidate set -> current shared contextual ranker -> candidate review (never silent save)
       miss -> bounded recognition lease
  -> provider metadata / redirect expansion when needed
  -> stronger identity, second cache lookup
  -> established Vayrin metadata/media/Gemini/Sol/Places pipeline
  -> established autosave safety gate or candidate review
  -> auxiliary cache persistence
  -> canonical saved-place source association
```

Trust semantics:

- `USER_CONFIRMED`: reusable across recognition-version changes unless disputed or explicitly invalidated. A machine replay cannot downgrade it.
- `VERIFIED_AUTO_SAVE`: reusable only at the current `recognition_version`; it represents a result that passed the existing provider/evidence autosave gates.
- `CANDIDATE_SET`: reusable only at the current version and only as review input. It never calls the save path until the user selects.
- Failures (`FAILED`, `INSUFFICIENT`, `AUTH_REQUIRED`, technical/provider failures): never written as canonical recognition truth. A negative TTL cache is deferred.

`recognition_version` is `vayrin-recognition-2026-08-21.v1`. User-confirmed rows survive a version change; machine-only verified rows and candidate sets miss and recompute. Material recognition/policy changes must bump this constant.

## Candidate-set ranking contract

A `CANDIDATE_SET` cache row owns the bounded canonical Google Place IDs and
recognition evidence. Its array order is retrieval evidence, not durable
presentation truth. Every candidate-set hit reconstructs the strongest
privacy-safe source context that survived in the payload (exact structured
source context, strong video/locality context, timestamp-weighted verified
sibling places, then the honest no-context fallback) and calls
`rankContextAwareCandidates`. The share-job presentation is deduplicated and
bounded to the current top three candidates per ambiguous mention.

The cache-only payload retains `retrievalRank`; the job result gets a separate
`presentationRank`. The top-three presentation projection is never written
back over the full cached recognition set. Old entries with partial textual
context rerank from that context without hydration. Entries with no usable
context still execute the shared deterministic ranker, remain confirmation-only,
and report `contextAvailable=false`; they do not trigger media, ScrapeCreators,
Gemini, Sol, transcription, frame extraction, or Places calls.

No schema or persisted `ranking_version` is needed. Candidate ranking is cheap
and is deliberately recomputed on every candidate-set hit under policy
`rerank_on_every_candidate_set_hit`; `recognition_version` continues to govern
recognition/model truth only. Telemetry records the trust tier, before/after
counts, whether reranking ran, the closed context-source kind, the ranking
policy, and zero Places calls without recording captions, precise user-location
history, private source content, or model reasoning.

## Durable schema

Migration `20260822000002_vayrin_recognition_cache_and_place_sources.sql` adds and backfills:

- `recognition_cache`: global content identity, trust/result class, canonical `places.id`, bounded candidate/evidence summaries, versioning, confirmation/dispute counts, and invalidation state.
- `recognition_inflight`: one owner UUID and a 30-900 second expiring lease per identity.
- `recognition_cache_events`: low-cardinality cost/latency avoidance diagnostics with no user ID.
- `saved_place_sources`: user-owned child provenance with one primary source and an arbitrary number of secondary videos.
- nullable identity columns on `share_jobs`, linking a user-specific job to global recognition without putting a user ID in the cache.

The backfill is one bounded `INSERT ... SELECT` over legacy saved places with a non-empty public source. It never changes a parent row, skips parents that already have child provenance, preserves the original openable URL, and derives TikTok, Instagram, YouTube, and Facebook provider IDs where recoverable.

Important constraints and indexes:

- unique global recognition identity and `(identity_version, platform, content_id)`;
- unique `(saved_place_id, identity_key)` source association;
- one partial-unique primary source per saved place;
- payload byte bounds (64 KiB candidates, 16 KiB evidence, 4 KiB telemetry detail);
- canonical place FKs use `ON DELETE SET NULL`; saved-place source children use `ON DELETE CASCADE`;
- claim, active-cache, place, source, and telemetry-time indexes.

RLS is enabled on all new tables. Recognition, leases, and cache telemetry have no client policies and explicit anon/authenticated revokes: service role only. Users can select only their own source associations. The `attach_saved_place_source` RPC checks `auth.uid()` and saved-place ownership; the service role uses the same ownership invariant.

## Single-flight and failure recovery

The first job atomically owns an identity lease. Concurrent jobs join instead of starting media/model work, decrement the claim attempt they did not consume, and park behind a 30-second retry. Normal completion or failure releases the owner's lease. A crashed owner cannot poison the identity: the database permits takeover after the bounded lease, capped at 15 minutes.

Opaque provider links may require a cheap redirect/metadata request before their provider ID is knowable. Nearr performs a second lookup immediately after expansion and still skips media, frames, Gemini, Sol, and Places on a hit.

## Multi-source behavior

`saved_places` remains one row per `(user_id, place_id)`. Its existing `source_url`, `source_type`, and `ai_note` remain the compatible primary-source projection. Every incoming public post is also attached to `saved_place_sources`:

- same video, including URL variants: one child row;
- different videos resolving to the same place: multiple child rows, one saved place;
- creator, bounded caption excerpt, source AI note, thumbnail, canonical/original link, and attach time stay source-specific;
- a later source never overwrites an earlier source's caption or AI note;
- user-authored `saved_places.notes` and the existing global place `ai_note` are never overwritten by a secondary source.

Provider correction keeps the saved-place ID and therefore moves its sources from Place A to Place B. If correction converges with another same-user saved row, migration `20260822000003_correct_saved_place_multi_source.sql` snapshots and restores the duplicate row's source children before it is deleted. One correction invalidates/disputes the affected global identity but does not globally replace it with that user's answer. A subsequent machine result is candidate-only until confirmed.

Place Detail continues to use the original single-source presentation for one video. At two or more deduplicated sources it shows the lightweight horizontal **More videos from this place** section. Cards contain the thumbnail when present, platform mark, creator/caption when present, an Original badge for the primary source, and open the canonical public post.

## AI notes

V1 does not regenerate or aggregate the saved place's AI note when a new source arrives. Source-specific AI context is retained on the child row. The existing `saved_places.ai_note` is fill-if-blank for the primary source, and `saved_places.notes` remains user-authored.

## Cost model

This is a planning range, not a billing quote. Repository measurements give Sol/Vayrin about **$0.02-$0.06 per invoked fallback**. Existing rollout guidance budgets Gemini Flash at **$0.001-$0.01** and transcription/media preparation at up to **$0.018** for a three-minute clip. Actual media download, Railway compute/egress, Google Places SKU cost, model invocation rates, and cache eligibility are telemetry-dependent and are deliberately not fabricated here.

The table assumes every cache hit avoids one Gemini pass and one Sol fallback, so its known avoided provider range is **$0.021-$0.088 per hit**, plus unknown media/compute/Places savings. Because Sol is conditional in production, treat the upper range as a scenario, not a forecast.

| Requests/day | Hit rate | Hits/day | Known avoided cost/day |
|---:|---:|---:|---:|
| 100 | 10% | 10 | $0.21-$0.88 |
| 100 | 25% | 25 | $0.53-$2.20 |
| 100 | 50% | 50 | $1.05-$4.40 |
| 100 | 75% | 75 | $1.58-$6.60 |
| 1,000 | 10% | 100 | $2.10-$8.80 |
| 1,000 | 25% | 250 | $5.25-$22.00 |
| 1,000 | 50% | 500 | $10.50-$44.00 |
| 1,000 | 75% | 750 | $15.75-$66.00 |
| 10,000 | 10% | 1,000 | $21-$88 |
| 10,000 | 25% | 2,500 | $52.50-$220 |
| 10,000 | 50% | 5,000 | $105-$440 |
| 10,000 | 75% | 7,500 | $157.50-$660 |

The new event ledger records cache hits/misses/candidate hits, invalidation, single-flight joins, source attach/dedupe, and estimated avoided calls. Runtime telemetry should replace these planning assumptions before a business forecast.

## Privacy and follow-up

The global cache stores no user identity, raw frames, transcripts, comments, prompts, secrets, or large model output. User ownership exists only on `share_jobs`, `saved_places`, and `saved_place_sources`. Caption retention is bounded and follows the existing public-source allowance.

Explicitly deferred:

- aggregate multi-source AI note generation;
- cache invalidation/admin tooling beyond the internal RPC;
- short-TTL negative/failure caching;
- cross-user correction consensus and authoritative promotion thresholds.

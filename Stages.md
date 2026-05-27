Created 5 todos

Read memory [](file:///c%3A/Users/andre/AppData/Roaming/Code/User/workspaceStorage/a4fef5cd563a6ad6252cc32c426ef1b4/GitHub.copilot-chat/memory-tool/memories/repo/nearr-runtime-risks.md)

Read [](file:///c%3A/Users/andre/Desktop/Nearr/lib/shareExtractionBackend.ts)

Read [](file:///c%3A/Users/andre/Desktop/Nearr/supabase/functions/process-share-link/index.ts#1-1), lines 1 to 300

Ran terminal command: (Get-Item .\supabase\functions\process-share-link\index.ts, .\lib\shareExtractionBackend.ts, .\lib\shareParser.ts, .\lib\placeExtractor.ts, .\lib\extractionPipeline.ts, .\lib\aiExtractPlace.ts, .\lib\queryValidation.ts, .\lib\instagramProfileMetadata.ts, .\app\share.tsx, .\ShareExtension.tsx, .\scripts\share-extraction-fixtures.json, .\scripts\evalShareExtraction.ts | Select-Object FullName, Length)

Audit Nearr share extraction

Read [](file:///c%3A/Users/andre/Desktop/Nearr/app/share.tsx#1-1), lines 1 to 500

Read [](file:///c%3A/Users/andre/Desktop/Nearr/lib/shareExtractionBackend.ts)

Read [](file:///c%3A/Users/andre/Desktop/Nearr/ShareExtension.tsx)

Read [](file:///c%3A/Users/andre/Desktop/Nearr/lib/shareParser.ts)

Read [](file:///c%3A/Users/andre/Desktop/Nearr/lib/placeExtractor.ts#1-1), lines 1 to 500

Read [](file:///c%3A/Users/andre/Desktop/Nearr/lib/queryValidation.ts)

Read [](file:///c%3A/Users/andre/Desktop/Nearr/lib/extractionPipeline.ts#1-1), lines 1 to 500

Read [](file:///c%3A/Users/andre/Desktop/Nearr/lib/aiExtractPlace.ts)

Read [](file:///c%3A/Users/andre/Desktop/Nearr/lib/instagramProfileMetadata.ts)

Read [](file:///c%3A/Users/andre/Desktop/Nearr/supabase/functions)

Read [](file:///c%3A/Users/andre/Desktop/Nearr/services)

Read [](file:///c%3A/Users/andre/Desktop/Nearr/supabase/functions/process-share-link/index.ts#1-1), lines 1 to 2000

Read [](file:///c%3A/Users/andre/Desktop/Nearr/supabase/functions/process-share-link/index.ts#1500-1500), lines 1500 to 2700

Read [](file:///c%3A/Users/andre/Desktop/Nearr/supabase/functions/process-share-link/index.ts#2600-2600), lines 2600 to 3000

Read [](file:///c%3A/Users/andre/Desktop/Nearr/services/placesService.ts#1-1), lines 1 to 300

Read [](file:///c%3A/Users/andre/Desktop/Nearr/docs/ENVIRONMENT.md)

Read [](file:///c%3A/Users/andre/Desktop/Nearr/docs/PROJECT_CONTEXT.md#1-1), lines 1 to 150

Read [](file:///c%3A/Users/andre/Desktop/Nearr/logs/share-extraction-eval-2026-05-03.json#1-1), lines 1 to 100

Read [](file:///c%3A/Users/andre/Desktop/Nearr/scripts/share-extraction-fixtures.json#1-1), lines 1 to 150

Read [](file:///c%3A/Users/andre/Desktop/Nearr/supabase)

Read [](file:///c%3A/Users/andre/Desktop/Nearr/docs/TESTING_CHECKLIST.md)

Read [](file:///c%3A/Users/andre/Desktop/Nearr/docs/ARCHITECTURE.md#1-1), lines 1 to 200

Searched for files matching `**/supabase/migrations/**/*.sql`, 5 matches

Read [](file:///c%3A/Users/andre/AppData/Roaming/Code/User/workspaceStorage/a4fef5cd563a6ad6252cc32c426ef1b4/GitHub.copilot-chat/chat-session-resources/8b7625cb-689b-487d-a1e2-9f0ac37b34d3/toolu_vrtx_01PVnpPfDs3pTagC3ax5T2M3__vscode-1777649476738/content.txt)

Starting: *Write rebuild plan* (5/5)

# Nearr Share Extraction — Rebuild Plan

Planning/audit only. No code changes were made.

---

## 1. Executive Summary

The current extraction pipeline has accreted ~30+ heuristic functions split across the client, the `process-share-link` Edge Function, and a shared instagramProfileMetadata.ts module. Each new failure has been patched with an additional rule (handle-splitter token list, repost-prefix regex, generic-content gate, address-first verification gate, query-strength classifier, …). The system is now hard to reason about, the eval fixtures assert intermediate query strings rather than user-visible behavior, and Instagram 429s silently weaken the only verifying evidence path.

The proposed rebuild flips the architecture: a single Edge Function (`resolve-share-place`) becomes a thin **agent loop** around Gemini with a small, fixed set of **tools** (fetch metadata, fetch profile, fetch transcript, search places, compare candidate). The AI does the reasoning. Code only:
- Provides tools.
- Caches expensive/blockable calls (esp. Instagram).
- Enforces a deterministic **safety gate** on the AI's final structured decision before any save.
- Streams a **debug timeline** the dev panel can render.

The client becomes a dumb consumer: send URL, render `saved | candidates | manual_fallback`, preserve user input.

We migrate in five staged rollouts so the existing pipeline stays live until the agent has been validated in shadow mode.

---

## 2. Current Architecture Audit

### Two flows today

**Android / host-app paste** — share.tsx → shareExtractionBackend.ts calls the Edge Function with `mode:'extract'` → on success, the client re-runs Places search + ranking via placesService.ts and decides save vs. picker. If the backend returns null, the client falls back to its **own** parser + heuristic + AI in shareParser.ts, placeExtractor.ts, aiExtractPlace.ts, extractionPipeline.ts.

**iOS share extension** — ShareExtension.tsx posts `{url, accessToken, mode:'save'}` to the same Edge Function, which runs the **full** pipeline server-side and returns `saved | ambiguous | failed_requires_app | open_app`. Extension hands off to host on anything but `saved`.

### Duplication (must collapse)

The following exist on **both** the client and the Edge Function and drift independently:

| Logic | Client | Server |
|---|---|---|
| `detectSource`, `buildQuery`, boilerplate strip | shareParser.ts | `process-share-link/index.ts` |
| Generic/venue/`shouldSearchPlaces` gates | queryValidation.ts | `process-share-link/index.ts` |
| Heuristic extractor (pin / handle / titlecase) | placeExtractor.ts | inline in Edge Function |
| Profile classification, `buildVerifiedProfileQuery`, `pickBestVerifiedVenueProfile` | instagramProfileMetadata.ts | imported by Edge Function |
| Candidate name match + ranking + reject | placesService.ts | `rankCandidates`, `getCandidateRejectionReason` |
| Address verification (150m radius) | placesService.ts | `verifyPlaceAtAddressServer` |

### Returned contract today

`BackendExtractionPayload` carries 25+ fields (`querySource`, `querySelection`, `queryGate`, `queryKind`, `requiredNameHint`, `verifiedProfileQuery`, …). Most are intermediate decisions of the heuristic pipeline. None of them carry **why** the AI chose what it chose — only **what** state the rules ended in.

---

## 3. What Is Broken and Why

1. **Brain is split between AI and ~12 heuristic gates.** Gemini already has the same metadata, but the gates can override or down-weight its result, and vice-versa. There is no single source of truth for "what is the venue."
2. **Display name / poster name leakage.** `extractPlaceQueryFromShareMetadata` and `buildAccountIdentityQuery` both treat the poster's display name as a venue candidate (Example 1: `Brandon Koehne - SF Bay Area` → `Brandon Koehne Real Estate`). The AI prompt tells it not to do this; the heuristics don't.
3. **No persistent profile cache.** Every Instagram share re-fetches public profiles. Rate limit hits are common (Example 2 `http_429`) and the system has no fallback policy other than "best-effort, ignore." This silently demotes the strongest verifying signal.
4. **Generic-content gate is a regex arms race.** `isGenericContentQuery` decides whether Places is searched. Every false positive (Example 3 grilled-cheese caption) requires a new pattern. Every false negative wastes a Places call and risks bad save.
5. **Eval fixtures assert intermediate query strings**, not behavior. Refactoring extraction is impossible without breaking 15 fixtures even when the user-visible outcome is identical or better.
6. **Debug logs are exhaustive but unstructured.** 25+ distinct `[share-debug]` markers, no run id, no timeline, no machine-readable reasoning. Dev cannot answer "why did this save?" without reading log lines top-to-bottom.
7. **Save vs. ambiguous decision is implicit.** `pipelineAllowsAutoSave` mixes 6+ booleans. There is no single "safety gate" function with a verifiable contract.
8. **Client fallback path duplicates everything** and can produce a different answer than the backend for the same URL. Hard to support.

---

## 4. New Architecture Recommendation

```
client (app/share.tsx, ShareExtension.tsx)
     │
     │  POST { url } + auth
     ▼
┌────────────────────────────────────────────────────┐
│ resolve-share-place  (Edge Function)               │
│                                                    │
│  ┌────────────────┐     ┌─────────────────────┐    │
│  │ Pre-fetch      │────▶│ Agent Loop          │    │
│  │ - source       │     │  • prompt + tools   │    │
│  │ - raw HTML/og  │     │  • max N tool turns │    │
│  │ - poster handle│     │  • timeout budget   │    │
│  └────────────────┘     └──────────┬──────────┘    │
│                                    │               │
│                                    ▼               │
│                       AI structured decision       │
│                                    │               │
│                                    ▼               │
│                       ┌────────────────────────┐   │
│                       │ Safety Gate (code)     │   │
│                       │  • allow/deny auto-save│   │
│                       └──────────┬─────────────┘   │
│                                  ▼                 │
│                    Persist run → extraction_runs   │
└────────────────────────────────────────────────────┘
     │
     ▼
{ status, place|candidates|null, debug }
```

Key principles:
- **Backend-only brain.** No client extraction, no client AI fallback, no client buildQuery.
- **AI owns reasoning.** Tools gather; AI decides.
- **Code owns safety.** A pure `applySafetyGate(aiDecision, runContext)` makes the final save/no-save call.
- **Cache-first profile fetches.** `social_profile_cache` table, 429-aware backoff, AI sees fetch status explicitly.
- **Structured debug.** Every run produces a timeline + reasoning persisted in `extraction_runs`.

---

## 5. New Edge Function Contract — `resolve-share-place`

### Request
```ts
POST /resolve-share-place
{
  url: string;
  // optional context for ranking / bias only — never as evidence
  deviceLocation?: { lat: number; lng: number };
  promptVersion?: string;   // optional override for shadow tests
  forceRefreshProfileCache?: boolean;  // dev only
}
```

### Response
```ts
{
  runId: string;
  status: 'auto_saved' | 'candidates' | 'manual_fallback' | 'failed';

  // present iff status === 'auto_saved'
  saved?: { savedPlaceId: string; place: ResultCandidate };

  // present iff status === 'candidates'
  candidates?: ResultCandidate[];   // 1..5, ranked

  // present iff status === 'manual_fallback' | 'failed'
  failureReason?:
    | 'no_evidence'
    | 'profile_blocked_no_other_evidence'
    | 'no_places_match'
    | 'tool_timeout'
    | 'ai_error'
    | 'server_error';

  // always present — what the AI produced + safety verdict
  decision: AiExtractionDecision;       // section 7
  safety:   SafetyGateVerdict;          // section 8
  debug:    DebugRun;                   // section 10
}
```

`status:'failed'` is a hard backend error (use `manual_fallback` UI). `status:'manual_fallback'` is a deliberate "ask the user" outcome.

### Modes
Drop the `save | extract` mode flag. Always run the full agent loop. The client decides whether to actually persist based on `status`. The Edge Function persists iff `safety.safeToAutoSave === true` to keep silent-save fast on iOS.

---

## 6. AI Tool Design

All tools are server-side. The AI emits tool-call requests; the orchestrator runs them and feeds results back.

| Tool | Input | Output (summary) | Notes |
|---|---|---|---|
| `fetchPostMetadata(url)` | `{url}` | `{platform, canonicalUrl, title, description, ogImage, posterHandle, taggedHandles[], rawHtmlHash}` | Always called once by the orchestrator before the loop; result is in the initial prompt. AI may re-call only if a redirect changed canonical URL. |
| `detectHandles(text, platform)` | `{text, platform}` | `{posterHandle, mentioned[], coauthors[]}` | Pure deterministic. AI may use to re-scan a transcript. |
| `fetchProfileBio(platform, handle)` | `{platform, handle}` | `{handle, fetchStatus: 'success'\|'stale_cache'\|'blocked'\|'failed', displayName, category, bio, website, extractedName, extractedAddress, extractedCity, classification, fetchedAt, cachedUntil, lastError}` | Always cache-first. Records 429s with backoff. Never throws. |
| `fetchTranscript(url)` | `{url}` | `{status: 'ok'\|'unsupported'\|'failed'\|'timeout', transcript?, durationSec?}` | AI must explicitly request — not auto-run. Budget: 1 call per run. |
| `searchPlaces(query, locationBias?, regionBias?)` | `{query, bias?}` | `{candidates: PlaceCandidate[]}` (≤8) | Single AI tool. No internal "search-allowed" gate — AI decides whether to call. Rate-limited: max 3 calls/run. |
| `compareCandidateToEvidence(candidateId, evidence)` | `{candidate, expectedName, expectedAddress?, expectedCity?}` | `{matchScore: 0..1, reasons: string[], nameMatch, addressMatch, distanceMeters?}` | Deterministic. Replaces today's `hasMeaningfulNameMatch` / `hasStrongNameMatch` / ranking spaghetti. |
| `checkProfileCache(platform, handle)` | `{platform, handle}` | same shape as `fetchProfileBio` but `fetchStatus: 'hit'\|'miss'` | Optional optimization tool — `fetchProfileBio` already does cache-first internally. Exposed so AI can preview cache state without spending fetch budget. |

**Tool budgets per run** (hard-enforced by orchestrator):
- max 6 total tool calls
- max 1 transcript
- max 3 places searches
- max 2 profile fetches (in addition to cache lookups)
- max 12 s wall clock for the full agent loop

The orchestrator records every tool invocation (input summary, output summary, latency, error/blocked status) to feed back into the prompt **and** into the debug timeline.

---

## 7. AI Prompt Design

### System prompt (conceptual)
- Role: "You extract real-world venues from social posts."
- Evidence priority (in order):
  1. Explicit street address in caption/transcript
  2. Verified profile bio with name + address (only when `fetchStatus='success'`)
  3. Explicit venue name in caption (`"the café in Monterey is X"`)
  4. Tagged business handle whose profile bio confirms it (only when verified)
  5. Tagged business handle when profile fetch is **blocked** → may be candidate, never auto-save
  6. Generic descriptive content → manual fallback
- Hard rules:
  - Poster display name is **never** a venue.
  - Bare handle is **never** a venue; treat as evidence pointer only.
  - If `fetchProfileBio` returns `blocked` and no caption/address evidence exists → return `decision:'candidate_confirmation'` with `safeToAutoSave:false`.
  - If only generic content text remains → `manual_fallback`.
- Reasoning must be returned as plain English in `reasoning`. Mention which tools and which evidence keys you used and why you rejected alternatives.

### Output schema (JSON, enforced)
```ts
type AiExtractionDecision = {
  placeName: string | null;
  normalizedPlaceName: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  searchQuery: string | null;
  platform: 'instagram' | 'tiktok' | 'youtube' | 'twitter' | 'link';
  sourceUrl: string;

  confidence: 'high' | 'medium' | 'low';
  decision: 'auto_save' | 'candidate_confirmation' | 'manual_fallback' | 'failed';
  needsUserConfirmation: boolean;     // AI's view; safety gate may force true
  evidenceUsed: EvidenceKey[];        // see safety gate

  reasoning: string;                  // 1–4 sentences
  rejectionReasons: string[];         // why other candidates/handles were dropped

  candidates: Array<{
    googlePlaceId: string;
    name: string;
    formattedAddress?: string;
    matchScore: number;               // from compareCandidateToEvidence
    matchReasons: string[];
  }>;

  promptVersion: string;
  modelUsed: string;
};

type EvidenceKey =
  | 'caption_explicit_name'
  | 'caption_explicit_address'
  | 'profile_verified_name_address'
  | 'handle_context_unverified'
  | 'transcript_explicit_name'
  | 'places_candidate_match'
  | 'weak_generic_text'
  | 'profile_fetch_blocked';
```

`promptVersion` is bumped on every prompt edit so we can compare runs.

### Few-shot examples
Include **exactly the three failure cases** from your spec, plus one address-first example and one transcript example. Keep examples short — they should anchor the priority order, not enumerate venues.

---

## 8. Safety Gate Design

A pure function over the AI's decision and the run context. **The AI cannot override it.** This is where `pipelineAllowsAutoSave` ought to have lived all along.

```ts
type SafetyGateVerdict = {
  safeToAutoSave: boolean;
  finalStatus: 'auto_saved' | 'candidates' | 'manual_fallback' | 'failed';
  blockedReasons: string[];   // empty when safeToAutoSave
  notes: string[];            // human-readable, for debug
};

function applySafetyGate(decision: AiExtractionDecision, ctx: RunContext): SafetyGateVerdict;
```

### Hard rules (ordered)
1. **AI says `failed` or no candidates** → `manual_fallback`.
2. **Decision says `manual_fallback`** → `manual_fallback`.
3. **Auto-save requires ALL of:**
   - `decision === 'auto_save'`
   - `confidence === 'high'`
   - At least one of `caption_explicit_address`, `caption_explicit_name`, `profile_verified_name_address`, `transcript_explicit_name` in `evidenceUsed`
   - At least one Places candidate with `matchScore ≥ 0.75`
   - The top candidate dominates: `top.matchScore - second.matchScore ≥ 0.15` (or only one candidate)
   - `evidenceUsed` does **not** contain `profile_fetch_blocked` as the only verifying evidence
   - `evidenceUsed` does **not** contain `weak_generic_text`
4. **If AI says `auto_save` but rule 3 fails** → downgrade to `candidates` and add `blockedReasons` explaining why.
5. **If `evidenceUsed` is only `handle_context_unverified` and at least one candidate exists** → `candidates`, never `auto_saved`.
6. **If profile fetch was blocked AND no caption address/name evidence AND no candidate match** → `manual_fallback` with reason `profile_blocked_no_other_evidence`.

Rule 3 is the only place save happens. Easy to test, easy to audit.

---

## 9. Profile Cache & Backoff Design

New table:

```sql
create table social_profile_cache (
  id uuid primary key default gen_random_uuid(),
  platform text not null,                 -- 'instagram'|'tiktok'|'youtube'|'twitter'
  handle text not null,
  display_name text,
  category text,
  bio text,
  website text,
  extracted_name text,
  extracted_address text,
  extracted_city text,
  classification text,                    -- restaurant_or_business|food_creator|repost_page|personal_account|unrelated_or_unknown|unknown
  confidence text,                        -- high|medium|low
  fetch_status text not null,             -- success|blocked|failed|stale|unknown
  last_fetch_error text,
  fetched_at timestamptz,
  expires_at timestamptz,
  next_retry_at timestamptz,
  fetch_attempt_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, handle)
);
create index on social_profile_cache (platform, handle);
create index on social_profile_cache (next_retry_at) where fetch_status in ('blocked','failed');
```

### TTLs
- `success`: `expires_at = now() + 14d` (profiles change rarely; bump on hit).
- `blocked` (HTTP 429): `next_retry_at = now() + 6h`, exponential backoff up to 72h, capped at `fetch_attempt_count`.
- `failed` (HTTP 4xx other than 429, network): `next_retry_at = now() + 1h`, backoff to 24h.
- `stale`: marks a previously-successful row whose `expires_at < now()`. Still usable evidence, flagged.

### Algorithm in `fetchProfileBio` tool
1. SELECT cache row.
2. If `fetch_status='success'` and `now() < expires_at` → return `success` from cache.
3. If `fetch_status='blocked'|'failed'` and `now() < next_retry_at` → return cached `blocked|failed` (no live fetch). AI sees `fetchStatus='blocked'`.
4. Else attempt live fetch with 4 s timeout.
5. On 429 → upsert blocked + backoff. If a previous successful row exists and is not too old (≤30 d), return it with `fetchStatus='stale_cache'` — AI sees stale flag.
6. On success → parse, classify, upsert, return.
7. Never throw; never block the loop.

### Constraints
- Cache key is `(platform, lower(handle))`.
- Profile rows are **shared across users** — they're public data. RLS: service-role write, authenticated read (or none, since only the Edge Function reads).
- No proxies, no anti-bot tricks.

---

## 10. Debug & Reasoning Design

New table:

```sql
create table extraction_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  url text not null,
  platform text,
  prompt_version text,
  model text,
  status text not null,             -- auto_saved|candidates|manual_fallback|failed
  safe_to_auto_save boolean not null,
  ai_decision jsonb not null,       -- AiExtractionDecision
  safety jsonb not null,            -- SafetyGateVerdict
  tools jsonb not null,             -- ToolInvocation[]
  timeline jsonb not null,          -- DebugTimelineStep[]
  latency_ms int,
  error text,
  created_at timestamptz not null default now()
);
create index on extraction_runs (user_id, created_at desc);
create index on extraction_runs (status, created_at desc);
```

`debug` returned to client:

```ts
type DebugRun = {
  runId: string;
  promptVersion: string;
  modelUsed: string;
  runtimePath: 'host_app' | 'ios_share_extension';
  latencyMs: number;
  tools: ToolInvocation[];     // {name, status, inputSummary, outputSummary, latencyMs, error?}
  timeline: TimelineStep[];    // {ts, kind, label, data}
  aiReasoning: string;
  rejectionReasons: string[];
  evidenceUsed: EvidenceKey[];
  candidates: CandidateComparison[];
  safety: SafetyGateVerdict;
  finalStatus: string;
};
```

### Dev panel vs. user UI
- **Regular users:** `saved` toast, `candidates` picker, or `manual_fallback` search bar. No reasoning, no tool list.
- **Dev panel** (gated by `__DEV__` or feature flag): full `DebugRun`. Render timeline as a vertical list with collapsible tool rows. Show prompt version + model on top.

Replace today's 25 markers with **a single structured stream**. `console.log` lines remain as compact JSON for Edge Function tail-logs (`[run] {runId} step={kind} ms={latencyMs}`), nothing else.

---

## 11. Migration Stages

### Stage 0 — Audit & cleanup plan (this document)
Approval gate. No code changes.

### Stage 1 — Agent in shadow mode
- Add `resolve-share-place` Edge Function and the agent loop. **No client wiring.**
- `evalShareExtraction.ts` runs both pipelines per fixture, writes side-by-side comparison to `logs/agent-shadow-<date>.json`.
- Run on a small set of realAutopilot recovered from a request error# Nearr Share Extraction — Rebuild Plan

> Planning/audit only. No code changes in this response. Scope: replace today's brittle, rule-stacked extraction with a backend-first AI tool-calling agent (`resolve-share-place`), behind a deterministic safety gate, with a profile cache to survive Instagram 429s.

---

## 1. Executive summary

The current pipeline is a 5-layer stack of regex → heuristics → Gemini one-shot → query gates → candidate filters, partially duplicated between the React Native client (placeExtractor.ts, queryValidation.ts, placesService.ts) and the Supabase Edge Function (index.ts). Every recent failure produced one more regex or one more gate. Failures shown in the user's examples (Brandon Koehne picked over Manasiri, silent acceptance of unverified handles, blind Places searches on food talk) are direct symptoms of this design.

Recommendation: collapse the brain into one server-side **agent loop** where Gemini drives a small set of tools (metadata, handle detection, profile bio, transcript, Places search, candidate compare, profile cache R/W). The agent emits structured reasoning + an extraction proposal. Deterministic code then runs a **safety gate** that decides `auto_save | candidate_confirmation | manual_fallback`. The client stops doing extraction.

We roll this out in 5 stages, starting in shadow mode so we never regress before the agent is proven.

---

## 2. Current architecture audit

### 2.1 Android / host-app paste flow (share.tsx)
1. `runSaveFlow(url)` triggered by paste / `?url=` deep link.
2. Try `extractShareOnServer(url)` → POST `/process-share-link` with `mode: 'extract'` (shareExtractionBackend.ts).
3. If backend returns null: client runs `parseShare` → `extractPlaceQueryFromShareMetadata` → `extractPlaceAI` → `runExtractionPipeline` (extractionPipeline.ts).
4. Address-first verify via `verifyPlaceAtAddress` (placesService.ts).
5. `searchPlaces` → rank → filter address-like/locality-like → auto-save single dominant or show picker.

### 2.2 iOS share extension flow (ShareExtension.tsx)
1. Pick first https URL, fetch token from App Group via `sharedAuth.getToken()`.
2. POST `/process-share-link` with `mode: 'save'`.
3. Edge Function runs the full pipeline server-side and returns `saved | ambiguous | failed_requires_app | open_app`.
4. `saved` → `openHostMap(savedPlaceId)`. Anything else → `handOffToHostApp(url, reason)`.

### 2.3 Edge Function (index.ts)
- `processShareLink` orchestrates: `fetchHtml` → `pickMeta`/`cleanTitle`/`cleanDescription` → `detectPosterHandle`/`extractRawHandles` → `enrichInstagramProfile` (in-memory only) → optional `fetchTranscriptSafe` → `extractPlaceAI` (Gemini one-shot, not tool-calling) → `classifyExtractedQuery`/`shouldSearchPlaces`/`hasVenueEvidence` → `searchPlaces` → `rankCandidates` + `getCandidateRejectionReason` → `verifyPlaceAtAddressServer` → `pipelineAllowsAutoSave` → save/ambiguous.
- Two modes: `save` (full + persist) vs `extract` (returns `BackendExtractionPayload` debug shape).
- Gemini call is single-shot JSON (`gemini-1.5-flash`, temp 0.1); no tools, no follow-ups.

### 2.4 Confidence/decision contract (today)
`BackendExtractionPayload` exposes `query`, `querySource`, `confidence`, `queryKind`, `searchAllowed`, `blockedReason`, `placeName`, `address`, `city`, `state`, `posterHandle`, `posterType`, plus `ai`, `querySelection`, `queryGate`, and `profileMetadata[]`. The `Result` union is `saved | ambiguous | failed_requires_app | open_app | extracted`.

### 2.5 Existing tables relevant to rebuild
migrations has `places`, `saved_places`, `profiles`, `notification_events`, `analytics_events`. **No profile cache, no extraction log, no agent run table.**

---

## 3. What is broken and why

| Symptom | Root cause |
|---|---|
| Brandon Koehne picked over Manasiri | `extractPlaceQueryFromShareMetadata` + `parseDisplayNameFromOgTitle` treat the og:title author segment as a venue candidate; Gemini one-shot doesn't get to dispute it because query is locked first. |
| Silent save on unverified handle | `pipelineAllowsAutoSave` accepts `verified_profile` source even when the verification was a stale or 429'd profile, because there is no fetch-status awareness. |
| Places search on "stuffin grilled cheeses with smashburgers" | `looksLikeVenueNameCandidate` token rule matches anything with a 4+ letter token; `isGenericContentQuery` only rejects a short blocklist. |
| Patches multiplying | Each new failure adds a regex (`_CREATOR_EATS_RE`, `_REPOST_PREFIX_RE`, handle-split token list, etc.). Heuristics stack; none are removed. |
| Client/server drift | `buildQuery`, `isGenericContentQuery`, `classifyExtractedQuery`, `shouldSearchPlaces`, `hasMeaningfulNameMatch`, `isAddressLikePlace`, address regex all live in **both** queryValidation.ts / placesService.ts and the Edge Function. |
| Instagram 429 invisible to logic | `enrichInstagramProfile` returns `{ blocked: true, reasons: ['http_429'] }` but downstream code treats absence-of-evidence the same as "not a venue". |
| Eval overfitting | share-extraction-fixtures.json asserts exact intermediate `query` strings (e.g. `"Le Coupe Fried Chicken Los Angeles"`), so refactoring breaks tests even when behavior improves. |

---

## 4. New architecture recommendation

```
[Client]                     [Edge: resolve-share-place]                [External]
share.tsx / ShareExtension ─► 1. fetchPostMetadata (deterministic)  ──► social URL
   POST {url, mode}            2. detectHandles (deterministic)
                               3. seed evidence bundle
                               4. ┌──────── Agent loop (Gemini) ─────┐
                               │  tool calls: profileBio /          │
                               │  profileCache R/W / transcript /   │
                               │  searchPlaces / compareCandidate   │ ──► Places, IG, transcription, DB
                               │  (max N steps, hard timeout)       │
                               │  AI emits: ExtractionProposal      │
                               └────────────────────────────────────┘
                               5. Safety gate (deterministic)
                               6. Persist (only if auto_save)
                               7. Return AgentResponse + timeline
[Client]                     ◄── { decision, place?, candidates?, debug }
   render saved / picker / manual fallback
```

Key inversions vs today:
- **Agent owns reasoning**, code owns evidence-gathering and the final yes/no.
- **Client is dumb again**: send URL, render result, show debug for dev.
- **Profile cache is first-class**: cache hits never trigger an Instagram fetch; 429s degrade to "candidate confirmation only" deterministically.
- **One contract**: client and server share one TypeScript type for `AgentResponse`. No client-side extraction at all once Stage 5 ships.

---

## 5. New Edge Function contract — `resolve-share-place`

Keep `process-share-link` alive in parallel during Stages 1–3. New function lives at supabase/functions/resolve-share-place/index.ts.

Request:
```ts
POST /resolve-share-place
{
  url: string,
  accessToken?: string,        // also accepted via Authorization
  mode: 'resolve' | 'save',    // resolve = no DB write
  client: { app: 'host'|'share-ext', version: string, locale?: string },
  context?: { lat?: number, lng?: number }   // device hint, never authoritative
}
```

Response:
```ts
type AgentResponse = {
  decision: 'auto_save' | 'candidate_confirmation' | 'manual_fallback' | 'failed';
  status: 'saved' | 'needs_user' | 'no_match' | 'error';
  savedPlaceId?: string;        // only when decision === 'auto_save' && mode === 'save'
  place?: ResolvedPlace;        // selected candidate (auto_save or top suggestion)
  candidates?: ResolvedPlace[]; // for candidate_confirmation
  extraction: ExtractionProposal;   // AI output (see §6/§7)
  safety: SafetyDecision;           // why gate allowed/denied auto-save
  debug: AgentDebug;                // timeline + tool calls + reasoning
  promptVersion: string;
  modelUsed: string;
  latencyMs: number;
  agentRunId: string;               // FK into agent_run table
};

type ResolvedPlace = {
  googlePlaceId: string;
  name: string;
  formattedAddress?: string;
  latitude?: number; longitude?: number;
  types?: string[];
  matchScore?: number;          // from compareCandidateToEvidence
  matchReasons?: string[];
};
```

Backward compatibility: keep `process-share-link` for the iOS extension binary already in the field. Stage 3 starts shipping a new extension that calls `resolve-share-place`.

---

## 6. AI tool design

All tools execute server-side. The agent only proposes calls; the function dispatches. Each tool has a strict JSON schema, a per-call timeout, and is recorded into `debug.toolCalls[]` with status (`ok | error | blocked | cache_hit`), latency, and a sanitized input/output summary.

| Tool | Purpose | Key behavior |
|---|---|---|
| `fetchPostMetadata(url)` | OG/twitter/title/description, canonical URL, platform, poster hint | Deterministic; pre-called once before agent loop and seeded into context to save a round-trip. |
| `detectHandles(text, html, platform)` | Returns `{ poster, tagged[], coauthors[], mentioned[] }` | Pre-called once. Handle is evidence, not a venue. |
| `checkProfileCache(platform, handle)` | Read `social_profile_cache` | Returns `{ status, freshness, payload? }`. Never throws. |
| `fetchProfileBio(platform, handle)` | Live IG/TikTok profile fetch | Cache-first via `checkProfileCache` (force flag allowed). Returns `{ fetchStatus: 'success'\|'blocked'\|'failed', displayName, category, bio, website, extractedName, extractedAddress, extractedCity, classification, confidence, error? }`. **Never retries 429 within `next_retry_at` window.** |
| `writeProfileCache(platform, handle, payload, fetchStatus)` | Persist result with TTL/backoff | Called by the dispatcher after `fetchProfileBio`, not by the model. |
| `fetchTranscript(url)` | Optional video transcript | Returns `{ status: 'ok'\|'unsupported'\|'failed'\|'timeout', transcript? }`. |
| `searchPlaces(query, locationBias?)` | Google Places text search | Returns up to 8 candidates with id/name/address/types/lat/lng. |
| `compareCandidateToEvidence(candidate, evidence)` | Score one candidate vs evidence bundle | Deterministic scorer (replaces `hasMeaningfulNameMatch`/`hasStrongNameMatch`/distance penalties). Returns `{ score, reasons[] }`. Agent uses scores to pick; safety gate uses same scorer. |

Hard guards on the dispatcher:
- Max 6 tool calls per run; max 2 of each kind (except `compareCandidateToEvidence`).
- Total agent budget: ~5 s on host, ~6 s on share extension (we already use 6.5 s in shareExtractionBackend.ts).
- All tools return JSON; never throw. Timeouts surface as `status: 'failed'` so the model can react.
- The model cannot fabricate handles or place IDs; safety gate verifies every `googlePlaceId` came from an actual `searchPlaces` result in this run.

---

## 7. AI prompt design

Single `system` prompt + per-turn structured tool messages. Versioned (e.g. `agent-v1.0.0`) and stored on every run.

**System prompt skeleton (sketch, not final wording):**
- Role: "You decide which real-world place a social post is about, or admit you can't."
- Inputs: platform, canonical URL, post title/description, detected handles, optional device city hint.
- Tools: list with one-line semantics, hard rule "you may only suggest a place after at least one `searchPlaces` call returned it."
- Evidence priority: `caption_explicit_address` > `caption_explicit_name` > `profile_verified_name_address` > `transcript_explicit_name` > `handle_context_unverified` > `weak_generic_text`.
- Negative rules:
  1. Never treat the post author / Instagram account display name as a venue unless their profile bio says so.
  2. Treat a handle as a *pointer*, not a name. Use `fetchProfileBio` to verify; if `fetchStatus !== 'success'`, mark `handle_context_unverified` and disallow auto-save.
  3. Generic food/content text ("stuffin grilled cheeses…") is not a search query.
  4. If you do humanize a handle for confirmation (`oldfishermansgrotto` → `Old Fishermans Grotto`), you must mark evidence as `handle_context_unverified` and `safeToAutoSave: false`.
- Output: emit one final `ExtractionProposal` JSON object (schema below). Reasoning must be plain text, ~3–6 sentences, citing the evidence keys it used.

**`ExtractionProposal` schema:**
```ts
{
  placeName: string | null,
  normalizedPlaceName: string | null,
  address: string | null,
  city: string | null,
  state: string | null,
  country: string | null,
  searchQuery: string | null,
  platform: 'instagram'|'tiktok'|'youtube'|'twitter'|'link',
  sourceUrl: string,
  confidence: 'high'|'medium'|'low',
  decision: 'auto_save'|'candidate_confirmation'|'manual_fallback'|'failed',
  safeToAutoSave: boolean,
  needsUserConfirmation: boolean,
  evidenceUsed: Array<
    'caption_explicit_name'|'caption_explicit_address'|
    'profile_verified_name_address'|'handle_context_unverified'|
    'transcript_explicit_name'|'places_candidate_match'|
    'weak_generic_text'|'profile_fetch_blocked'>,
  selectedGooglePlaceId: string | null,
  candidateGooglePlaceIds: string[],
  reasoning: string,
  rejectionReasons: Array<{candidate: string, reason: string}>
}
```

The agent's `decision` is a *suggestion*. The safety gate has the last word.

---

## 8. Safety gate design

Pure, deterministic function. Inputs: `ExtractionProposal`, `toolCalls[]`, `searchPlaces` results, `compareCandidateToEvidence` scores. Outputs:

```ts
type SafetyDecision = {
  finalDecision: 'auto_save'|'candidate_confirmation'|'manual_fallback'|'failed';
  autoSaveAllowed: boolean;
  reasons: string[];          // why allowed or denied
  overrodeAgent: boolean;
  matchedCandidateId?: string;
};
```

Rules (all must pass for `auto_save`):
1. `confidence === 'high'`.
2. At least one of: `caption_explicit_name`, `caption_explicit_address`, `profile_verified_name_address`, `transcript_explicit_name` in `evidenceUsed`.
3. **None** of: `handle_context_unverified`, `profile_fetch_blocked`, `weak_generic_text`.
4. `selectedGooglePlaceId` exists and was actually returned by a `searchPlaces` tool call in this run.
5. `compareCandidateToEvidence` score ≥ threshold AND no second candidate within `delta` of the top (dominance check).
6. If an address is present, it geocodes within 150m of the chosen Place (reuses today's `verifyPlaceAtAddressServer` logic, lifted into the gate).

Demotions:
- Fail #2 → `manual_fallback`.
- Pass #2 but fail #3/#4/#5/#6 → `candidate_confirmation`.
- Empty Places result OR `weak_generic_text` only → `manual_fallback` with no candidates.
- Tool budget exceeded / agent timeout → `failed`, surfaced in debug.

This is the **only** place auto-save is decided. `pipelineAllowsAutoSave`, `getCandidateRejectionReason`, `hasVenueEvidence`, `shouldSearchPlaces` all collapse into this gate.

---

## 9. Profile cache / backoff design

New table:

```sql
create table social_profile_cache (
  id uuid primary key default gen_random_uuid(),
  platform text not null,                 -- 'instagram'|'tiktok'|...
  handle text not null,
  display_name text,
  category text,
  bio text,
  website text,
  extracted_name text,
  extracted_address text,
  extracted_city text,
  classification text,                    -- restaurant_or_business|food_creator|...
  confidence text,                        -- high|medium|low
  fetch_status text not null,             -- success|blocked|failed|stale|unknown
  last_fetch_error text,
  fetched_at timestamptz,
  expires_at timestamptz,
  next_retry_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (platform, handle)
);
create index on social_profile_cache (platform, handle);
create index on social_profile_cache (next_retry_at) where fetch_status = 'blocked';
```

TTL policy:
- `success` → `expires_at = now() + 7d`.
- `blocked` (e.g. `http_429`) → `next_retry_at = now() + min(24h, 2^n * 15min)` with exponential backoff per handle; cap at 24h.
- `failed` (network/parse) → `next_retry_at = now() + 1h`.

Dispatcher rules for `fetchProfileBio`:
1. Read cache.
2. Fresh `success` → return cached, no live fetch.
3. Stale `success` AND `next_retry_at ≤ now` → live fetch; on 429 keep stale payload but mark `fetchStatus: 'success'`/`stale: true`; agent treats as `profile_verified_name_address` only if cache is < 30 days old.
4. `blocked` AND `next_retry_at > now` → return `{ fetchStatus: 'blocked' }` immediately, no live fetch.
5. Unknown → live fetch, write result.

Migration impact: removes the in-memory-only enrichment in index.ts and converts it to a cache-aware service.

---

## 10. Debug / reasoning design

Two surfaces:

**A. Stored — `agent_run` table** (queryable for prompt iteration):
```sql
create table agent_run (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  url text not null,
  platform text,
  prompt_version text not null,
  model_used text not null,
  latency_ms int,
  decision text,
  final_decision text,                -- after safety gate
  selected_google_place_id text,
  evidence_used text[],
  tool_calls jsonb,                   -- [{tool, status, ms, inputSummary, outputSummary, error?}]
  reasoning text,
  rejection_reasons jsonb,
  candidates jsonb,
  safety jsonb,
  debug_timeline jsonb,
  created_at timestamptz default now()
);
```

**B. Wire payload — `AgentDebug`** returned to client every call:
```ts
type AgentDebug = {
  runtimePath: 'host'|'share-ext';
  promptVersion: string;
  modelUsed: string;
  toolCalls: Array<{
    tool: string; status: 'ok'|'error'|'blocked'|'cache_hit';
    inputSummary: string; outputSummary: string;
    latencyMs: number; error?: string;
  }>;
  blockedTools: string[];
  reasoning: string;
  evidence: { extracted: ExtractionProposal };
  candidates: Array<ResolvedPlace & { matchScore: number; matchReasons: string[] }>;
  safety: SafetyDecision;
  finalStatus: AgentResponse['status'];
  timeline: Array<{ at: number; label: string; data?: Record<string, unknown> }>;
};
```

**Client UI:**
- Production users see only: saved toast / candidate picker / manual fallback. No internals.
- Dev/debug build (gated behind existing `DevModeBanner`): a "Share extraction" panel showing prompt version, model, tool timeline, evidence keys, reasoning paragraph, candidate scores, safety decision, and "why auto-save was/was not allowed". Replace today's noisy `[share-debug] *` console flood with one structured panel populated from `AgentDebug`.

Logs to keep raw: `EDGE_REQUEST_RECEIVED`, `FINAL_RESULT`. Everything else moves into `agent_run.debug_timeline`.

---

## 11. Migration stages

**Stage 0 — Audit & cleanup plan (this doc).** Approve, then start Stage 1.

**Stage 1 — Agent in shadow mode.**
- Build `resolve-share-place` with the agent loop, tools, safety gate, and `agent_run` table — but **do not return its decision to the client**.
- Edge Function `process-share-link` calls `resolve-share-place` internally for every request and writes `agent_run` rows alongside its existing decision.
- Update evalShareExtraction.ts to run both pipelines and emit a side-by-side report.
- Exit criteria: agent matches or beats current pipeline on the new behavior fixtures (§13) for ≥ 1 week of real shares.

**Stage 2 — Agent drives candidate picker only.**
- Replace today's "ambiguous" candidate set with the agent's `candidates`. No auto-save change.
- Old pipeline still controls `auto_save`.
- Exit criteria: candidate quality (manual labeling on 50 real shares) ≥ old pipeline.

**Stage 3 — Agent drives auto-save through safety gate.**
- Switch `process-share-link` to call `resolve-share-place` and return its `AgentResponse`. Old pipeline becomes a fallback only when the agent returns `failed`.
- Ship a new iOS share extension binary that calls `resolve-share-place` directly.
- Exit criteria: zero "wrong silent saves" reported across two release cycles.

**Stage 4 — Caching, backoff, prompt versioning.**
- Wire `social_profile_cache` and exponential backoff (§9).
- Persist `promptVersion` on every run; add an admin script to diff decisions between two prompt versions.

**Stage 5 — Delete old pipeline pieces.**
- Remove client-side extraction (`extractPlaceQueryFromShareMetadata`, `extractPlaceAI`, `runExtractionPipeline`, the duplicate validation in queryValidation.ts and placesService.ts — see §12).
- Remove `pipelineAllowsAutoSave`, `classifyExtractedQuery`, `shouldSearchPlaces`, `hasVenueEvidence`, `getCandidateRejectionReason` from the Edge Function.
- Retire `process-share-link` once iOS adoption of the new extension is acceptable.

---

## 12. Cleanup / deprecation list

For each, the recommended action **after Stage 3**:

| Function / area | File | Action |
|---|---|---|
| `buildQuery` | shareParser.ts, Edge index.ts | **delete** (server tool returns raw metadata; agent builds its own query) |
| `extractPlaceQueryFromShareMetadata` | placeExtractor.ts | **delete** |
| `extractAccountIdentityFromShareMetadata`, `pickPlaceyHandle`, `pickAfterLocationPin`, `humanizeHandle`, `looksLikeCreatorOrRepostHandle`, handle-split token list | placeExtractor.ts | **delete** — replaced by `detectHandles` tool + agent reasoning |
| `classifyQueryStrength` / `classifyPlaceQueryStrength` | placeExtractor.ts, Edge | **replace with AI reasoning** — confidence is now the agent's output |
| `classifyExtractedQuery` | queryValidation.ts, Edge | **delete** — `evidenceUsed[]` replaces `queryKind` |
| `isGenericContentQuery` | queryValidation.ts, Edge | **delete** — agent decides; safety gate enforces "no `weak_generic_text`-only" |
| `looksLikeVenueNameCandidate` | queryValidation.ts, Edge | **delete** |
| `hasVenueEvidence` | queryValidation.ts, Edge | **move to safety gate** as `evidenceUsed` membership check |
| `shouldSearchPlaces` | queryValidation.ts, Edge | **delete** — agent decides whether to call `searchPlaces` |
| `pipelineAllowsAutoSave` | Edge | **replace with safety gate** (§8) |
| `getCandidateRejectionReason` / `rankPlaceCandidates` / `hasMeaningfulNameMatch` / `hasStrongNameMatch` / `nameOverlapScore` | placesService.ts, Edge | **simplify into one** `compareCandidateToEvidence` tool used by both agent and safety gate |
| `isAddressLikePlace` / `isLocalityLikePlace` | both | **keep**, but only inside `searchPlaces` tool |
| `verifyPlaceAtAddressServer` / `verifyPlaceAtAddress` | both | **keep**, called from safety gate when `caption_explicit_address` present |
| `extractLocationContext` / `geocodeContextText` / `normalizeLocationContext` | Edge | **simplify** — return a city hint into the agent context only; do not gate behavior |
| `enrichInstagramProfile` (in-memory) | Edge | **replace** with cache-aware `fetchProfileBio` tool (§9) |
| Client-side `extractPlaceAI` | aiExtractPlace.ts | **delete** in Stage 5; no LLM on device |
| Client-side `runExtractionPipeline` | extractionPipeline.ts | **delete** in Stage 5 |
| Address regex `PROFILE_ADDRESS_RE` / `PROFILE_CITY_STATE_RE` | both | **keep** inside profile parser only |
| `buildVerifiedProfileQuery` / `pickBestVerifiedVenueProfile` / `isVerifiedVenueProfile` | instagramProfileMetadata.ts | **keep** as helpers used inside `fetchProfileBio` tool; remove their client imports |
| `[share-debug] PROFILE_ENRICHMENT_AVAILABLE`, `AI_INPUT_PROFILE_METADATA`, `QUERY_SELECTION`, `QUERY_GATE` console logs | both | **simplify** → drop; replaced by `agent_run.debug_timeline` |
| `BackendExtractionPayload.querySource`, `queryKind`, `searchAllowed`, `blockedReason`, `querySelection`, `queryGate`, `requiredNameHint`, `verifiedProfileQuery` | Edge / client | **deprecate** in Stage 3, **delete** in Stage 5 — `AgentResponse` replaces them |

Net effect: we delete or collapse ≈ 25 heuristic functions and the client's entire extraction layer.

---

## 13. Testing / eval plan

Restructure share-extraction-fixtures.json and evalShareExtraction.ts around **behavior assertions**, not query strings.

Each fixture asserts a subset of:
```ts
{
  expectedDecision: 'auto_save'|'candidate_confirmation'|'manual_fallback'|'failed',
  expectedEvidenceIncludes?: Array<EvidenceKey>,
  expectedEvidenceExcludes?: Array<EvidenceKey>,
  expectedPlaceNameContains?: string,    // case-insensitive substring
  forbiddenPlaceNameContains?: string[], // e.g. "Brandon Koehne"
  mustCallTool?: string[],
  mustNotCallTool?: string[],
}
```

New regression fixtures (cover the user's examples + generalizations):

1. **Caption explicit venue (Manasiri)** — IG post with caption "The best café in Monterey California is Manasiri crepe's downtown Monterey." Expect `candidate_confirmation` with `placeNameContains: 'Manasiri'`, `forbidden: ['Brandon Koehne']`, evidence includes `caption_explicit_name`.
2. **Verified profile (Old Fisherman's Grotto, cache success)** — Profile cache pre-seeded with address. Expect `auto_save` (or `candidate_confirmation` if Places dominance fails), evidence includes `profile_verified_name_address`.
3. **Profile blocked (same caption, 429, no cache)** — Expect `candidate_confirmation`, `safeToAutoSave: false`, evidence includes `handle_context_unverified` and `profile_fetch_blocked`.
4. **Generic food content** — "stuffin grilled cheeses with smashburgers". Expect `manual_fallback`, `mustNotCallTool: ['searchPlaces']`.
5. **Influencer title wrapper** — "Brandon Koehne - SF Bay Area on Instagram: …". Without caption venue, expect `manual_fallback`. With caption venue, see #1.
6. **Bad Places match dominance** — Force `searchPlaces` to return "Brandon Koehne Real Estate" for a Manasiri query → safety gate must reject (`compareCandidateToEvidence` low) and degrade to `manual_fallback`.
7. **Address-first** — "1234 Cannery Row, Monterey CA". Expect `auto_save`, evidence includes `caption_explicit_address`, gate runs 150m verify.
8. **YouTube generic title** — "I tried the best smashburger in New York". Expect `manual_fallback` unless transcript present.
9. **Transcript reveals venue** — Generic title + transcript "we're at Joe's Pizza on Carmine". Expect `candidate_confirmation` with evidence `transcript_explicit_name`.
10. **Twitter short post** — "this coffee shop is insane". Expect `manual_fallback`.

Eval harness changes:
- Mock `searchPlaces`, `fetchProfileBio`, `fetchTranscript` per fixture (no live network in CI).
- Output a JSON report with: pass/fail per assertion, prompt version, agent reasoning, tool timeline. Compare runs across prompt versions.
- Drop fixtures that asserted exact intermediate query strings (`instagram-tagged-handle-with-city`, `tiktok-emoji-noise`, `instagram-handle-with-numbers`, etc.) and rewrite them as decision/evidence assertions.

Old fixtures to **rewrite** (all overfit to query strings): every entry in today's `share-extraction-fixtures.json`. None should be kept verbatim; rewrite each as a behavior assertion using a venue from the same domain.

Old fixtures to **keep as-is**: none, but the *URLs and metadata samples* are reusable as raw inputs.

---

## 14. Implementation sequence (within Stage 1)

This is the order I'd implement once you approve. Each item is roughly one prompt's worth of work.

1. Migration: `social_profile_cache` + `agent_run` tables, indexes, RLS.
2. Shared types: `lib/shareAgent/types.ts` (or a deno-compatible location) with `AgentResponse`, `ExtractionProposal`, `ResolvedPlace`, `AgentDebug`, `SafetyDecision`, `EvidenceKey`.
3. Tool implementations as standalone Deno modules in `supabase/functions/_shared/agent-tools/`: `fetchPostMetadata`, `detectHandles`, `fetchProfileBio` (cache-aware), `fetchTranscript`, `searchPlaces`, `compareCandidateToEvidence`, plus `profileCacheRepo` (DB layer).
4. Agent loop: Gemini tool-calling adapter (single function with retry/timeout, JSON-schema-validated tool args).
5. Safety gate (`safetyGate.ts`) — pure function, unit-tested in isolation.
6. New Edge Function `resolve-share-place` wiring 3+4+5.
7. Shadow integration: invoke `resolve-share-place` inside `process-share-link`; persist `agent_run`; do not change client behavior.
8. Eval harness rewrite + new behavior fixtures.
9. Dev debug panel (gated by `DevModeBanner`) that fetches the latest `agent_run` for a URL and renders `AgentDebug`.

Stages 2–5 unlock once Stage 1 ships.

---

## 15. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Agent loops, blowing the 6 s budget | Hard cap 6 tool calls + 5 s wall clock; on timeout return `failed`, fall back to old pipeline (Stages 1–3). |
| Gemini tool-calling instability / schema drift | Validate every tool-arg with zod; on validation failure, return error to model and let it self-correct once; otherwise abort. |
| Cost spike from extra tool calls | Profile cache eliminates most IG fetches; transcript only on demand; Places cap at 2 calls per run. |
| Instagram TOS / scraping risk | Same surface as today (public profile HTML); cache + backoff *reduces* request volume. No new scraping. |
| Wrong silent save during shadow rollout | Stage 1 doesn't change user behavior. Stages 2–3 add only progressive control. |
| Eval coverage gap on YouTube / Twitter / generic links | New fixtures #8–#10 explicitly cover; add 5 more real-world links per platform during Stage 1. |
| Prompt regressions | `promptVersion` stamped on every run + diff script in Stage 4. |
| Client/server contract drift returning during cleanup | Stage 5 deletes the duplicate code; until then keep one shared types module imported by both. |

---

## 16. What not to build yet

- Cross-platform "venue knowledge graph" — out of scope.
- Multi-step conversational confirmation in the UI — keep current single picker.
- Background re-extraction of older saved places — out of scope.
- Anti-rate-limit proxy / cookie-based IG auth — explicitly excluded by your constraints.
- A second LLM provider behind Gemini — defer until prompt is stable.
- Embeddings-based duplicate detection — keep current Place-ID + 40 m dedupe.
- A user-facing reasoning explanation — dev-only debug panel for now.

---

## 17. Open questions for you

1. **Model**: stay on `gemini-1.5-flash` for the agent loop, or move to `gemini-1.5-pro` (higher quality, ~3× latency)? My default: flash for the loop, pro behind a feature flag for evals.
2. **Latency budget on share extension**: today 6.5 s. Comfortable holding it at 6 s with the agent loop, or do we need a "fast path" that returns `candidate_confirmation` without Places when budget runs out?
3. **Profile cache TTL on success**: 7 days OK, or longer (30 days) given how rarely venue bios change?
4. **Auto-save dominance threshold**: how aggressive? E.g. require top candidate score ≥ 0.8 AND second candidate ≤ 0.5? I'll tune in Stage 2 but want your gut number.
5. **Storing reasoning text**: `agent_run.reasoning` will contain user-shared URLs and possibly bio snippets. OK to retain indefinitely, or set a 90-day TTL?
6. **iOS share-extension upgrade path**: do you want me to ship a new extension binary in Stage 3, or keep proxying through `process-share-link` for one more release cycle?
7. **Manual fallback UX**: current behavior opens the host app for manual search. Any change desired (e.g. a "we couldn't find the place — paste address?" sheet) before Stage 3?
8. **Transcription in scope for v1 of the agent**: include `fetchTranscript` from day one, or stub it to `unsupported` until the transcription-service is production-ready?

---

Approve any subset and I'll implement Stage 1 in a follow-up. 

Completed: *Write rebuild plan* (5/5)



You've used 51% of your session rate limit. Your session rate limit will reset on May 4 at 1:30 AM. [Learn More](https://aka.ms/github-copilot-rate-limit-error)
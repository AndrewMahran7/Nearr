# Manual-fallback UX — implementation report

Date: 2026-06-04
Scope: graceful manual fallback + root-crash prevention for failed social-link extraction.
Constraint compliance: host-side only; no auto-save loosening; no extraction/scoring/threshold
changes; no new dependencies; legacy pipeline untouched; original social URL preserved.

## A. Traced failure paths (proven from code)

### 1. Blocking "Couldn't save link" alert
- Source: `app/share.tsx`, the `catch (err)` of the `execute()` closure inside `runSaveFlow`
  (previously `Alert.alert("Couldn't save link", FAIL_GENERIC)`).
- Cause: any **thrown** error anywhere in the flow (parse throw, unexpected access, etc.)
  was caught and surfaced as a blocking alert — layered on top of the manual-search UI that
  the same catch had already set. This is the alert users complained about.
- Note: most *normal* extraction failures do NOT throw — they already `setPhase('failed')`
  and return. The alert only appeared on the throw path.

### 2. Root AppErrorBoundary ("Something went wrong")
- Source: `app/_layout.tsx` `AppErrorBoundary`.
- Cause: React error boundaries only catch **render/lifecycle** throws — not async or
  event-handler throws (those were all already caught in `runSaveFlow`/`runManualSearch`).
  The only realistic path was a **render-time** throw while mapping `candidates` in the
  `choose` / `multi-choose` blocks: a malformed/partial candidate (`undefined`, missing
  `googlePlaceId`/`name`) makes `c.name` / `key={c.googlePlaceId}` throw during render →
  boundary. The agent path filtered for coords, but render had no last-line defense.

### 3. `failed` vs `manual_fallback`
- `manual_fallback` already opened manual search correctly.
- `failed` (and candidate decisions with zero usable candidates) fell through to the legacy
  pipeline, which could then throw and reach the alert/boundary, or show a confusing
  "No place found". These are **expected product states**, not runtime errors.

### Expected product states vs genuine runtime errors
- Expected (→ manual search): `userFacingDecision === 'manual_fallback'`, agent `failed`,
  zero/malformed candidates, Places no-match, no synthesizable query, generic-query gate
  block, Gemini-timeout with no recovery candidates, profile blocked + no other evidence.
- Genuine runtime errors: unexpected throws inside the flow handler — now **caught locally**
  and converted into a manual-fallback transition (never the boundary, never a blocking alert).

## B–G. Changes made

### New file: `lib/shareAgent/manualFallback.ts` (pure, RN-free, testable)
- `MANUAL_FALLBACK_MESSAGE` — friendly inline copy.
- `isRenderableCandidate` / `filterRenderableCandidates` — skip invalid rows, count invalids.
- `deriveManualFallbackQuery` — safe, name-led prefill (never a raw address when a name
  exists); empty when no explicit signal.

### `app/share.tsx`
- Added centralized `enterManualFallback({ reason, originalUrl?, suggestedQuery?, backendStatus?,
  invalidCandidateCount? })`:
  - preserves original URL + source platform (`parsed`/`url` state retained; consumed by
    `runManualSearch`),
  - clears invalid candidate state (`setCandidates([])`, `setMultiSelectedIds(new Set())`),
  - sets the inline `MANUAL_FALLBACK_MESSAGE`,
  - prefills the manual query but **never auto-submits** and **never saves**,
  - `setPhase('failed')` (existing manual-search phase, dark/orange `Card` UI),
  - logs `[share-fallback] entered / original_url_present / suggested_query_present /
    invalid_candidate_count / backend_status` (booleans only — no raw URL/token/payload).
- **Replaced the blocking alert**: `execute()` catch now calls `enterManualFallback(...)` and
  logs `[share-fallback] root_error_prevented reason=invalid_regex|share_flow_threw`.
- Routed `manual_fallback`, no-query, and generic-query-gate paths through `enterManualFallback`.
- Agent candidate handling now counts invalid candidates; a candidate-bearing decision that
  yields **zero** valid candidates → `enterManualFallback('malformed_candidates')`.
- **Render-time defense**: `renderableCandidates = filterRenderableCandidates(candidates).valid`
  now drives the `choose` / `multi-choose` conditions, lists, select-all and save handlers —
  a malformed candidate can no longer throw at render.
- Updated failed-state copy to "Search for this place" + `MANUAL_FALLBACK_MESSAGE`.
- Removed now-unused `FAIL_NO_QUERY` const.

### `ShareExtension.tsx`
- The extension already hands off **every** failure status (`ambiguous`,
  `failed_requires_app`, `open_app`, malformed response, network/timeout, thrown exception)
  to the host app at `nearr://share?url=...` with the original URL, and never renders a
  terminal "couldn't save" state. Added `[share-fallback] handoff_to_host=true reason=` log in
  `handOffToHostApp`.

### Source metadata preservation (Task E) — verified, no change needed
`runManualSearch` → `sourceUrl = parsed?.url ?? url` and `sourceType = parsed?.source ?? 'link'`
→ `runSearchAndMaybeSave(q, sourceUrl, sourceType)` → `saveCandidate(candidate, sourceUrl,
sourceType)` → `saveSavedPlace({ candidate, sourceType, sourceUrl })`, which persists
`source_url` / `source_type` (`services/savedPlacesService.ts` L153–154). Identical to the
candidate-confirmation path.

## H. Tests
- New `scripts/testManualFallback.ts` (22 assertions) + `npm run test:manual-fallback`,
  covering: malformed candidate array skip (#7), none-remain → manual fallback (#8),
  one invalid + one valid → valid shown (#10), name-led prefill derivation, empty prefill
  (no auto-submit), and the inline copy is not the old blocking-alert language. All pass.
- Render-side/integration behaviors (no alert, no throw, no boundary, URL preserved through
  manual save, extension handoff) are enforced structurally by the changes above; the pure
  deterministic logic is unit-tested.

## Validation
- `npm run typecheck` — pass.
- `npm run test:manual-fallback` — 22/22 pass.
- `npm run test:multi-address` — pass.
- `npm run test:recovery-hints` — pass.
- `npm run test:address-match` — pass.
- `npm run test:safety-description-only` — pass.
- Remote tester / `npx supabase functions deploy` — **not run** and **not required**: this is a
  host-side fix. The backend already maps `manual_fallback` → `failed_requires_app` for the
  extension and emits the agent block consumed by the host.

## Deploy / build impact
- Supabase redeploy: **not required** (no Edge Function change).
- New mobile build: **required** — `app/share.tsx`, `ShareExtension.tsx`, and a new lib module
  changed (JS + share-extension target).

## Remaining risks
- Legacy fall-through paths that still call `setFailMessage(FAIL_NO_RESULTS)` directly
  (Places no-match) keep their specific copy; they still land on the same non-blocking manual
  search phase with the original URL attached (no alert, no crash), but do not emit the
  `[share-fallback]` logs. Can be unified later if desired.
- Render defense skips invalid candidates silently; if a backend regression ever returned all
  malformed candidates with a candidate decision, the host now routes to manual fallback at the
  decision layer, so the empty render case should not occur in practice.

## Expected UX
Nearr can't identify the location → manual search screen opens automatically → original link
stays attached → user searches, selects a place, saves normally. No "Couldn't save link" alert.
No "Something went wrong" boundary for a normal extraction failure.

# Multi-place share flow — implementation output

Timestamp: 20260604-193131

## Before

### Actual failure path (best-evidence trace; NOT confirmed from device logs)
Without the failing post URL or device logs the precise root cause of
the "Something went wrong" error boundary cannot be confirmed. The
following are the verified architectural gaps in the current code
that explain how multi-place posts can reach that state:

1. `lib/shareAgent/queryCleaner.ts::extractLikelyAddress(text)` returned
   only the FIRST regex match (no `/g`). For captions that list ≥2
   addresses, addresses 2..N were silently dropped. The Edge Function
   only ever verified ONE address.
2. The Edge Function had no `multi_candidate_confirmation` decision.
   `ResolverDecision = 'auto_save' | 'candidate_confirmation' | 'candidate_picker' | 'manual_fallback' | 'failed'` —
   nothing represented "this post references multiple distinct real
   places".
3. The host app `app/share.tsx` had no `'multi-choose'` UI phase.
   On the legacy fallthrough (when the agent decision wasn't
   recognized and there were 0 usable agentCandidates) the screen
   silently dropped into the legacy heuristic pipeline, which on a
   multi-address caption produces a combined query that returns
   either zero results ("Couldn't save link") or — in some races —
   triggers a render-time exception in the candidate list. The
   `AppErrorBoundary` in `app/_layout.tsx` then shows
   "Something went wrong".

### Current Edge response shape (pre-change)
- `extraction.agent.candidates[]` already supports multiple entries
  with `googlePlaceId / name / formattedAddress / latitude / longitude / types / matchScore / rationale`.
- `extraction.agent.userFacingDecision` is a string enum.
- Backend already returned `status: 'ambiguous'` over the wire for
  `candidate_picker | candidate_confirmation`, so the wire change for
  multi-place is just adding the new decision to the same case.

### Minimal plan (what we executed)
1. Add `extractLikelyAddresses(text, max)` to the SHARED queryCleaner.
2. Add `addresses: LikelyAddress[]` to the Edge Function `Evidence`.
3. Add `'multi_candidate_confirmation'` to `ResolverDecision` AND to
   `UserFacingDecision`.
4. New resolver branch at the top of `resolveSharedPlace.ts`: when
   `evidence.addresses.length ≥ 2`, verify each address against
   Google Places, dedupe by `googlePlaceId` then by normalized
   `formattedAddress`, cap at 10. If ≥2 distinct verified places →
   return `multi_candidate_confirmation` (bypassing `decide()` to
   guarantee no auto-save).
5. Edge HTTP layer: add `multi_candidate_confirmation` to the same
   `case` as `candidate_confirmation` so it returns `status: 'ambiguous'`
   over the wire. The full candidate list ships in the response.
6. Host-app `app/share.tsx`: new `'multi-choose'` phase with
   checkbox UI, Select all / Clear, "Save selected (N)" disabled at
   0, batch save via `Promise.allSettled` reusing `saveSavedPlace`,
   summary alert distinguishing fully-saved / partial / total
   failure, idempotent against duplicates. Default selection is
   intentionally empty — never preselect every result.
7. iOS extension: unchanged. The Edge Function returns
   `status: 'ambiguous'`, which the extension already hands off to
   the host app via `handOffToHostApp(url, 'ambiguous')`. The host
   app then sees `agentBlock.userFacingDecision === 'multi_candidate_confirmation'`
   from its own backend call and renders multi-select.

## After

### Files changed (only what was directly necessary)

| File | Change | Why |
|------|--------|-----|
| [lib/shareAgent/queryCleaner.ts](lib/shareAgent/queryCleaner.ts) | Added `extractLikelyAddresses(input, max)`. `extractLikelyAddress` now delegates to it (back-compat). | Detect multiple distinct street addresses in one caption. |
| [supabase/functions/process-share-link/types.ts](supabase/functions/process-share-link/types.ts) | Added `'multi_candidate_confirmation'` to `ResolverDecision`. | Semantic decision distinct from `candidate_picker` (which is for single-address ambiguity). |
| [supabase/functions/process-share-link/evidence/addressExtraction.ts](supabase/functions/process-share-link/evidence/addressExtraction.ts) | Re-export `extractLikelyAddresses`. | Match local-module import convention. |
| [supabase/functions/process-share-link/evidence/extractEvidence.ts](supabase/functions/process-share-link/evidence/extractEvidence.ts) | Added `addresses: LikelyAddress[]` to `Evidence`; populated from `extractLikelyAddresses`. Added `caption_multiple_addresses` evidence key. `address` stays = `addresses[0] ?? null` for back-compat. | Surface multi-address evidence to the resolver without breaking single-address callers. |
| [supabase/functions/process-share-link/resolver/resolveSharedPlace.ts](supabase/functions/process-share-link/resolver/resolveSharedPlace.ts) | New "step 0" branch: when `evidence.addresses.length ≥ 2`, iterate each address through `verifyPlaceAtAddressServer`, dedupe by `googlePlaceId` then by normalized `formattedAddress`, cap at 10. If ≥2 distinct verified places → return `multi_candidate_confirmation` with `safeToAutoSave: false`. Bypasses `decide()` so it can never be promoted to auto_save. Extended `finalize()` signature to accept the inlined decision object. Added `normalizeAddrKey` helper. | The core architectural change. |
| [supabase/functions/process-share-link/index.ts](supabase/functions/process-share-link/index.ts) | Added `'multi_candidate_confirmation'` to the `statusAmbiguous` case in the save-mode dispatch. | Wire-level status reuse — host app still sees `status: 'ambiguous'` with full candidate list. |
| [lib/shareAgent/userFacing.ts](lib/shareAgent/userFacing.ts) | Added `'multi_candidate_confirmation'` to the `UserFacingDecision` union. | Type passthrough for the host app. |
| [app/share.tsx](app/share.tsx) | (1) Added `'multi-choose'` to the `Phase` union. (2) Added `multiSelectedIds: Set<string>` state. (3) Added a new branch in the agent-decision handler: when `decision === 'multi_candidate_confirmation'` and ≥2 candidates, dedupe by `googlePlaceId`, cap at 10, switch to `'multi-choose'`. (4) Added `saveSelectedCandidates(selected, sourceUrl, sourceType)` using `Promise.allSettled` — never throws, surfaces a summary alert (full success / partial / total failure), and on partial failure trims saved entries and stays on the picker for retry. (5) Added the checkbox-style multi-select render block with Select all / Clear / "Save selected (N)" / "None of these — search manually". (6) Added supporting styles. (7) Defensive key: `key={id \|\| \`multi-${idx}\`}` so duplicate / missing place IDs cannot crash the renderer (a likely "Something went wrong" trigger). | Build the user-facing multi-place flow safely. |
| [scripts/testMultiAddressExtraction.ts](scripts/testMultiAddressExtraction.ts) | New standalone test (13 assertions covering single, multi, dedupe, max-cap, numbered roundup, no-address, legacy compat). | Lock in the parser behavior so regressions are caught locally. |
| [package.json](package.json) | New `test:multi-address` npm script. | Wire the new test into CI/local. |

### New shape

`Evidence.addresses: LikelyAddress[]` (≤10), with `address = addresses[0] ?? null`.

`ResolverDecision` now includes `'multi_candidate_confirmation'`. `safeToAutoSave` is always `false` in that branch (hard-coded in the resolver, NOT routed through `decide()` so no future rule can promote it).

`extraction.agent.userFacingDecision` may now equal `'multi_candidate_confirmation'`. Wire status remains `'ambiguous'` so older extension builds without the multi-aware host still hand off correctly.

### Multi-select behavior
- Triggered when the resolver verifies ≥2 distinct real-world places from independent address strings in one post.
- UI defaults selection to NONE. User opts in per candidate. Select-all is one tap; Clear is one tap.
- "Save selected (N)" is disabled when N=0.
- Batch save uses `Promise.allSettled` so one failure cannot crash the screen or block other saves.
- Idempotent — `saveSavedPlace` already de-dupes by `google_place_id` + 40m proximity. Duplicates are counted but not surfaced as failures.
- "None of these — search manually" routes to the existing `'failed'` phase + manual input.

### Save-failure behavior
- Full success: alert summarizes `{newCount} added, {dupCount} already saved`, navigates to map focused on first new save.
- Total failure: alert lists failed candidates, stays on picker, leaves selection intact.
- Partial: alert says `Saved X of Y. Couldn't save: ...`. Saved entries are removed from the candidate list and from selection so a retry tap only re-issues the failed ones.

### Tests run

| Command | Result |
|---------|--------|
| `npm run test:multi-address` | PASS (13/13 new assertions) |
| `npm run typecheck` | PASS (clean) |
| `npm run test:recovery-hints` | PASS (no regressions) |
| `npm run test:address-match` | PASS (no regressions) |
| `npm run test:safety-description-only` | PASS (no regressions) |

### Remote test

NOT run from this session. To validate end-to-end against the failing
post URL, run:

```
npm run test:share-remote -- <failing-instagram-or-tiktok-url>
```

Then deploy the Edge Function:

```
npx supabase functions deploy process-share-link
```

### App build

A new mobile build IS required for the host-app changes
(`app/share.tsx` ships in the JS bundle, but the new `Phase` and
UI render only matter once a user receives a backend response with
`userFacingDecision: 'multi_candidate_confirmation'`). Until the
Edge Function is deployed, no user will see the new state.

The iOS share extension was NOT changed — no extension rebuild
required for the multi-place flow itself.

### Remaining risks

1. **Crash root cause not confirmed.** I traced the most likely paths
   that lead to the `AppErrorBoundary` ("Something went wrong") and
   to the `Alert.alert("Couldn't save link", ...)` but I do NOT
   have a device console log or the failing post URL to confirm
   that the changes made here remove the actual exception. To
   confirm, capture:
   - the specific Instagram/TikTok post URL that reproduces the
     error,
   - `adb logcat *:S ReactNative:V ReactNativeJS:V` on Android
     (or Xcode Console with the Nearr process filter) during a
     fresh reproduction, looking for `[share-debug]`,
     `[share-mobile-debug]`, and `[share-multi]` markers, and
   - the Supabase Edge Function logs for the same request_id
     (visible in the diagnostics panel inside the extension).
2. **Resolver cost.** The multi-address branch issues one Places
   `verifyPlaceAtAddressServer` call per address up to 10. For a 4-
   address caption that's up to 4 sequential text-search calls,
   well inside the 6s extension budget but not free in Places quota.
3. **Same brand at multiple locations.** A post like "We have a new
   location! 100 Main St and our original at 200 Oak Ave." now
   correctly surfaces both. Whether the user expects to see both
   is a UX assumption — captured by the empty-default selection so
   the user MUST opt in.
4. **Edge Function caching.** The shadow-run path
   (`shadowRun.ts`) writes a fire-and-forget row per request. The
   new decision string is included via `result.decision` but no
   migration is needed since the column is `text`.
5. **`candidate_picker` still uses the single-place UI.** That's
   intentional — `candidate_picker` is "same address, ambiguous
   match"; the right answer is exactly one of the candidates.
   Distinct from `multi_candidate_confirmation` where the right
   answer can be multiple.

### Logging added

- `[share-multi] CANDIDATES_PRESENTED { candidate_count, deduped_count }`
- `[share-multi] BATCH_SAVE_RESULT { selected_count, save_success_count, save_failure_count }`
- Edge: `resolver:multi_address_resolved { addressCount, candidateCount }`
- `diagnostics.multiAddressVerification = { addressCount, perAddress: [{ query, status, candidateCount }], resolvedCount }`

No JWTs, headers, or raw payloads logged.

### Auto-save invariants preserved

- The deterministic safety gate (`lib/shareAgent/safety.ts`) was NOT modified.
- `safeToAutoSave` is hard-coded `false` in the multi-address branch and the resolver returns the decision directly, never routing through `decide()` for that path.
- Host app `app/share.tsx` auto-save guard
  `decision === 'auto_save' && safeToAutoSave === true && agentCandidates.length > 0`
  is unchanged.
- The new `'multi_candidate_confirmation'` decision intentionally lives outside the auto-save union; even a server bug that set `safeToAutoSave: true` on it would be ignored by the host app's strict equality check.

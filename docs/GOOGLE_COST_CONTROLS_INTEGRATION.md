# Google Places cost-controls integration

## Scope

This branch combines saved-place local snapshots with active-candidate-only
presentation hydration. It does not alter recognition models, prompts,
candidate generation, candidate count, ranking, verification, or search
queries. Counts below are deterministic code-derived request models, not
observed billing.

## Semantic conflict resolutions

| File | Saved-place intent | Candidate intent | Integrated resolution |
|---|---|---|---|
| `components/PlaceImage.tsx` | `allowGoogleLookup=false` makes saved surfaces incapable of mount-driven Google hydration. | Candidate mode reuses known media and permits only the active candidate to use a photos-only fallback. | Both controls are enforced. `allowGoogleLookup` is an upper-level veto in candidate and rich modes; candidate activity can never override it. Existing URLs/source media may still render. |
| `components/PlaceBrowseCarousel.tsx` | Saved rows pass their lookup permission into the image owner. | Only the selected carousel item is presentation-active and existing photo URLs pass through. | The item carries both `allowGoogleLookup` and `initialPhotoUrls`; selection only grants eligibility when lookup is also allowed. |
| `components/SavedPlaceResult.tsx` | Already-saved alternatives and the saved primary must not initiate Google lookup. | Result alternatives use candidate visibility and known candidate/search photos. | Existing media is retained, active-index behavior remains, and saved rows explicitly veto fallback. The primary result is active for presentation telemetry but lookup-disabled. |
| `app/share-jobs/[jobId].tsx` | Rows already linked to a saved place disable Google lookup. | Search-returned photo URLs and active-candidate context must reach the carousel. | Both properties are carried. A saved row cannot hydrate even if selected; unsaved active rows can use the candidate policy. |
| `services/placesService.ts` | Legacy saved recovery has its own bounded `photos,opening_hours,utc_offset` display mask. | Active candidate fallback has the independent `photos`-only mask and search photo pass-through. | Both APIs and masks remain separate. Neither cache nor telemetry namespace is shared. |

`candidateHydrationDecision` also has an explicit `lookup_disabled` outcome so
the saved-result/candidate boundary is deterministic and observable without
misreporting a provider request.

## Combined request behavior

Assumptions: candidate rows have distinct Place IDs; “fallback” means no usable
candidate/source image; photo counts describe Google photo URLs actually
mounted, not references in JSON. Warm process caches and CDN caches can reduce
the old counts. Saved-place Nearby Search was conditional on the recommendation
flag, so its old value is shown as “up to 1.”

| Scenario | Old UI Details | New UI Details | Old photos | New photos | Nearby Search | Recognition requests changed? |
|---|---:|---:|---:|---:|---|---|
| New save only | 0 | 0 | 0 | 0 | 0 -> 0 | No |
| Repeat saved-place open, warm process | 0 after first rich lookup | 0 | cache-dependent remount | 0 Google; local/source media | up to 1 -> 0 | No |
| Restart + saved-place open | 1 rich | 0 | at least 1 when available | 0 Google; local/source media | up to 1 -> 0 | No |
| Legacy saved place, first open | 1 rich | 1 bounded saved-display fallback | at least 1 when available | first available only | up to 1 -> 0 | No |
| Legacy saved place, second open | 0 warm / 1 after restart | 0 | cache-dependent | 0 Google | up to 1 -> 0 | No |
| 5 candidates, view 1 | 5 rich | 1 photos-only / 0 with existing media | 5 | 1 / 0 | unchanged | No |
| 10 candidates, view 1 | 10 rich | 1 photos-only / 0 with existing media | 10 | 1 / 0 | unchanged | No |
| Wrong Place 5, view none | 5 rich | 0 | 5 | 0 | unchanged | No; required Text Search remains |
| Wrong Place 5, view 1 | 5 rich | 1 photos-only / 0 with search imagery | 5 | 1 | unchanged | No |
| Multi-place 4, view 1 | 4 rich | 1 photos-only / 0 with existing media | 4 | 1 / 0 | unchanged | No |

## Provider and cache boundaries

- Saved-place hydration is keyed by owner user ID plus saved-place ID and is
  persisted in AsyncStorage. Its fallback is `saved_place_display_v1`.
- Candidate presentation is keyed by Google Place ID in a process-lifetime,
  in-flight-coalesced photo cache. Its fallback field group is `photos`.
- A saved snapshot hit never enters candidate cache or rich-details cache.
- A saved-result row with `allowGoogleLookup=false` cannot enter either
  candidate or rich lookup even when selected.
- Google photo identifiers/URLs from saved fallback remain session-only and are
  not written to the saved-place snapshot.

## Measurement model

1. Saved-place fallback rate: distinct opens with
   `saved_place_google_fallback_started` divided by saved-place open sessions.
2. Candidate UI calls per review: candidate details/photo requested events
   grouped by job and trigger, divided by candidate review sessions.
3. Photo calls per visible candidate: `candidate_google_photo_requested`
   divided by `candidate_became_active`.
4. Inactive-call invariant: requested candidate events where `active=false`;
   target is zero.
5. Zero-Google saved opens: snapshot-hit opens with no fallback-started event,
   divided by all saved opens.
6. Zero-fallback candidate views: active candidate views with existing/source
   media events and no details-requested event, divided by all active views.

Saved-place and candidate event namespaces remain disjoint, and provider-call
events are emitted by the component that owns the request rather than both a
parent and child.

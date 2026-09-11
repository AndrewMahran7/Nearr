# Candidate presentation Google-cost audit

## Scope and counting assumptions

This covers Google activity caused after recognition/search has produced
candidate objects. Recognition-required Text Search, Nearby Search, geocoding,
ranking, and verification are separate and unchanged. Counts are code-derived
maxima for candidates with Place IDs and up to five Google photos, not observed
invoice counts.

## Before

`CandidatePhotoCarousel` called `getCachedPlaceRichDetails` whenever a
mounted candidate lacked `photoUrls`. Compact cards mounted for every
candidate, so N candidates could create N rich Details requests and N
first-photo requests without interaction. A standard carousel initialized
`hydratedThrough` to 1, making photos 1 and 2 eligible to mount. Scrolling
unlocked the next page, and `PhotoRolodexModal` prefetched both adjacent URLs.

`WrongPlaceSheet` discarded photo references already returned by its Text
Search, then mounted `PlaceImage` for every result. Each row requested rich
Details. Queue rows, result alternatives, and the multi-place browse carousel
had the same mount-based behavior.

The process cache coalesced equal rich-detail Place IDs and retained values
across navigation in one app process. It did not survive an app restart and
could not prevent fan-out across distinct IDs. React Query is not used here.

Old UI mask:

`place_id,name,formatted_address,geometry/location,types,url,website,formatted_phone_number,international_phone_number,photos,opening_hours,utc_offset`

Only `photos` fed candidate imagery. The other fields serve saved-place
details, not candidate review.

| Candidate count | Recognition-required calls | UI Details on mount | Initial UI Photos (compact) | Other UI Google |
|---:|---:|---:|---:|---:|
| 1 | unchanged / pipeline-dependent | 1 | 1 (standard could mount 2) | 0 |
| 3 | unchanged / pipeline-dependent | 3 | 3 | 0 |
| 5 | unchanged / pipeline-dependent | 5 | 5 | 0 |
| 10 | unchanged / pipeline-dependent | 10 | 10 | 0 |

Looking only at candidate 1 did not change those compact-card counts. Browsing
all candidates had already paid all N Details and at least N first photos;
opening every five-photo gallery could reach 5N photo requests. Wrong Place
adds one required Text Search, then previously added one rich Details and one
first-photo request per displayed alternative. Backing out did not cancel
requests already started.

## After

Candidate objects render existing bounded photo URLs or source/frame media
first. Search photo references pass through in memory without expanding Text
Search. An inactive candidate cannot mount a Google photo or start Details. A
no-media active candidate uses a process-lifetime, in-flight-coalesced fallback
whose exact mask is `photos`.

Only photo index 0 is visitable initially. Scrolling marks only the page
actually reached. Candidate galleries disable adjacent `Image.prefetch` and
mount images only for visited indices.

Wrong Place keeps its Text Search and preselected save CTA, but no alternative
becomes presentation-active until the user taps its row. Multi-place cards
hydrate only the expanded/selected place, and browse carousels only the
selected card.

## Deterministic before/after request model

“Fallback” is the worst case where the viewed candidate has no existing photo
or source frame. With existing data, new Details is zero. Photo counts describe
viewed Google photo URLs, not references returned in JSON.

| Scenario | Old Details | New Details (fallback / existing) | Old Photos | New Photos (fallback / source) | Recognition changed? | UX |
|---|---:|---:|---:|---:|---|---|
| 1 candidate, view 1 | 1 rich | 1 photo-only / 0 | 1–2 | 1 / 0 | No | Same useful preview |
| 5 candidates, view 1 | 5 rich | 1 photo-only / 0 | 5 | 1 / 0 | No | Inactive cards use frame/neutral |
| 5 candidates, view all | 5 rich | 5 photo-only / 0 | 5 minimum | 5 minimum / 0 | No | Each activates on selection |
| 10 candidates, view 1 | 10 rich | 1 photo-only / 0 | 10 | 1 / 0 | No | Inactive cards do not preload |
| Wrong Place, 5, view none | 5 rich | 0 | 5 | 0 | No; Text Search remains | Lightweight rows |
| Wrong Place, 5, view 1 | 5 rich | 1 photo-only / 0 from search refs | 5 | 1 | No; Text Search remains | Selected row gains photo |
| Multi-place, 4, view 1 | 4 rich | 1 photo-only / 0 | 4 | 1 / 0 | No | Siblings use frames/neutral |

The billing improvement is directional: candidate fallback no longer asks for
contact fields (website, phones, opening hours) or non-photo Basic fields.
Exact dollar savings are intentionally not claimed because SKU rates, cache
hits, response photo availability, and provider image caching were not
observed in this code-derived model.

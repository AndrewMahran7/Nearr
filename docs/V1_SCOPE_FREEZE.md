# Nearr — V1 Scope Freeze

> Last updated: 2026-05-03
> Source of truth: current codebase

This is the current beta reality snapshot. Use it to decide what can be described as shipping, what still needs real-device validation, what is disabled, and what is intentionally out of scope.

## Current product vision

Nearr is a memory-to-action app for real-world places.

Core loop:

- See a place online
- Want to try it
- Save it
- Nearr remembers it
- Nearr reminds you when you are nearby
- You open the saved place on the map and decide what to do next

V1 should not feel like a generic map app. The product promise is not “store pins.” The product promise is “remember this place at the right moment so I can actually go.”

## Product rules inside V1

- Wrong silent saves are worse than asking the user to choose.
- Nearr should not ask for confirmation constantly.
- Auto-save when evidence is strong.
- Ask only when evidence is weak or conflicting.
- Regular users should not pay and should not see traditional ads.

## Shipping inside V1 now

- Better restaurant extraction and ranking that behaves more like a human reviewer
- Evidence-based auto-save gate with candidate-picker fallback when confidence is weak
- Address-first extraction and exact-name verification through Places
- `@` handles used as evidence, not truth
- Influencer vs restaurant distinction in extraction
- Grouped nearby notifications when saved-place radii overlap

## Shipping in the current beta

- Supabase magic-link auth
- File-backed `/auth-callback` route
- `dev@nearr.test` password login in all builds
- Home, Places, Map, Settings, and place detail screens
- Manual save flow
- Host-app link save flow
- Save success -> focused map using `savedPlaceId`
- Duplicate save -> focused existing place when id is available
- Map selected-place card with swipe/X/map-tap dismissal
- Custom marker + in-app preview-card interaction model
- Places filters: Active (default), Recent, Nearby, Visited, Archived, Instagram, TikTok, Reminders on
- Place detail features: directions, original post/link, nearby reminder, note, collapsed reminder settings, remove
- Notification setup UI, test notification, background proximity checks
- OS geofencing support for up to 20 saved places
- Background location watch as geofence fallback
- Restaurant extraction v2 with conservative evidence gating
- Grouped nearby reminder notifications
- Nearby-opportunity flow (3-strike opportunity cap, auto-archive on the 3rd decline, visited completion state, archived state with restore)
- Dark/orange UI refresh
- How Nearr Works onboarding
- Legal terms/privacy scaffolding in the app and profile schema

## Partially built / environment-dependent

- iOS share extension target
  - enabled in config
  - fallback handoff path is real
  - silent-save path depends on deployed backend + App Group token bridge + real native verification
- `process-share-link` Edge Function
  - code exists
  - deployment is environment-specific
- Server-side AI extraction
  - real on the Edge Function when secrets are configured
  - not a reliable on-device feature
- Geofencing reliability
  - code exists and should work
  - still requires real-device beta testing before treating it as proven

## Disabled in the current beta

- legal acceptance enforcement (`LEGAL_ACCEPTANCE_REQUIRED = false`)
- Local UI Mode legacy fake session path

## Deferred

- real transcription provider
- social or collaborative features
- push-notification server delivery system
- photo/media layer for saved places
- broad public launch gating and legal enforcement

## Future ideas to log, not build yet

- Adaptive ellipse/blob zones for overlapping saved places
- More advanced cluster geometry beyond simple circle intersection
- Audio transcription fallback for restaurant names
- Tagged-account profile inspection
- Restaurant/creator attribution dashboard
- Archived/visited map visibility controls
- Social/shared maps
- Creator dashboards
- Restaurant campaign reports
- Monetization through restaurants, creators, and businesses rather than regular users

## Do not describe as current V1 reality

- iOS share extension being disabled entirely
- geofencing being purely a V2 concept
- save flows returning to Home after save
- native marker callouts as the main map interaction model
- hardcoded Google Maps API key in `app.json`

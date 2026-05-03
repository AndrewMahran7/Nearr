# Nearr — V1 Scope Freeze

> Last updated: 2026-05-02
> Source of truth: current codebase

This is the current beta reality snapshot. Use it to decide what can be described as shipping, what still needs real-device validation, what is disabled, and what is intentionally out of scope.

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
- Places filters: All, Recent, Nearby, Instagram, TikTok, Reminders on
- Place detail features: directions, original post/link, nearby reminder, note, collapsed reminder settings, remove
- Notification setup UI, test notification, background proximity checks
- OS geofencing support for up to 20 saved places
- Background location watch as geofence fallback
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
- visit/completion features
- social or collaborative features
- push-notification server delivery system
- photo/media layer for saved places
- broad public launch gating and legal enforcement

## Do not describe as current V1 reality

- iOS share extension being disabled entirely
- geofencing being purely a V2 concept
- save flows returning to Home after save
- native marker callouts as the main map interaction model
- hardcoded Google Maps API key in `app.json`

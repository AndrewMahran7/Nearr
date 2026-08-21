# NOTIFICATION-TAP-QA — Physical Notification Navigation Validation

Status: deferred until the next integrated iOS development build.

## Build prerequisite

Use a development build containing the integrated host JavaScript/runtime and
the latest Share Extension native changes. Record the build id, commit, device,
and iOS version before testing. Do not mark cold-start coverage complete from a
Metro-only session.

## Acceptance for every scenario

- The notification opens the correct destination.
- Exactly one navigation occurs for one response.
- No blank or black screen appears.
- No stale/wrong stack remains behind the destination.
- Saved-place selection is not lost.
- Back, close, and sheet-dismiss behavior remains sensible.

## Scenarios

- [ ] Cold start: terminate Nearr, tap a notification, wait through session restore.
- [ ] Background: leave Nearr on Map, background it, then tap.
- [ ] Background: leave Nearr on Settings, background it, then tap.
- [ ] Foreground: tap the iOS banner/Notification Center item while Nearr is active.
- [ ] Single nearby reminder opens that saved place in the canonical map detail.
- [ ] Nearby group opens the exact delivered grouped view.
- [ ] Strong/auto-saved share result opens the saved place.
- [ ] Candidate result opens the candidate review job.
- [ ] Multi-place completed result frames the saved places together.
- [ ] Partial multi-place result opens the unresolved multi-place review.
- [ ] Needs-help/manual result opens actionable job detail.
- [ ] Stale deleted-place notification falls back to the rendered map with a safe message.
- [ ] Stale deleted/archived job renders a safe queue/detail fallback.
- [ ] Duplicate delivery of one response causes one navigation.
- [ ] Rapid repeated tap does not create duplicate routes or sheets.
- [ ] Tap while the same target is already open causes no redundant destructive navigation.
- [ ] Tap while another place is open switches cleanly to the notified place once.
- [ ] Tap two distinct notifications and confirm both remain independently routable.

## Evidence to attach

- Screen recording covering cold, background, and foreground cases.
- Sanitized breadcrumb export showing request id, origin, type/version,
  destination, dedupe decision, and applied/skipped route.
- Any failure reproduction with notification request id only; do not attach raw
  captions, auth tokens, or complete private payloads.

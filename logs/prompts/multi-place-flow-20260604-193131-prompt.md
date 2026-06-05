You are working on my Nearr codebase.

Goal

Add a safe multi-place confirmation flow for social posts that contain multiple restaurant addresses or resolve to multiple valid Google Places.

Current behavior:
When a shared Instagram/TikTok post contains multiple addresses, Nearr can fail with:
- "Couldn't save link"
- or the root "Something went wrong" error boundary

Desired behavior:
- If the post resolves to multiple plausible places, show all valid options.
- Let the user select one, several, or all.
- Save every selected place.
- Never silently auto-save multiple places.

Context

Nearr's architecture rule remains:

model/agent proposes places
→ deterministic code decides:
- auto_save
- candidate_confirmation
- multi_candidate_confirmation
- manual_fallback
- failed

Wrong silent saves are worse than confirmation.

This case commonly represents:
1. different restaurants in one post
2. multiple locations of the same restaurant

The iOS share extension should not implement multi-select UI. If multiple places are found, it should open the host app share flow.

Before editing, inspect the real failure path and identify why this case reaches the error boundary.

Files to inspect

- app/share.tsx
- ShareExtension.tsx
- lib/shareExtractionBackend.ts
- lib/shareAgent/agent.ts
- lib/shareAgent/userFacing.ts
- lib/shareAgent/types.ts
- lib/shareAgent/safety.ts
- services/savedPlacesService.ts
- supabase/functions/process-share-link/index.ts
- supabase/functions/process-share-link/shadowRun.ts
- components used by the existing single-candidate picker
- scripts/testProcessShareLinkRemote.ts
- docs/ARCHITECTURE.md
- docs/IOS_SHARE_EXTENSION.md
- docs/TESTING_CHECKLIST.md

Also inspect any existing logs or error-boundary output related to the failing multi-address share.

Constraints

- Do not loosen single-place auto-save.
- Never auto-save multiple places.
- Do not extend the deprecated legacy extraction pipeline unless a tiny compatibility bridge is unavoidable.
- Do not redesign unrelated UI.
- Do not add new dependencies unless absolutely necessary.
- Keep the iOS share extension thin.
- Multi-place selection must happen in the host app.
- Deduplicate by Google Place ID first, then normalized address as fallback.
- Limit displayed candidates to a reasonable maximum, such as 10.
- Preserve the original social URL/source metadata for every saved place.
- Existing duplicate-save behavior must remain idempotent.
- A failure saving one selected place must not crash the app.
- Do not claim the crash is fixed without identifying its actual cause.
- Do not log secrets, JWTs, headers, or full raw payloads.

Tasks

1. Trace the current failure
2. Add an explicit multi-place result shape (multi_candidate_confirmation)
3. Detect multi-place evidence
4. Build host-app multi-select UI
5. Save selected places safely
6. Share extension behavior — handoff to host app on multiple candidates
7. Error handling — fix actual unhandled exception, malformed data must fall back safely
8. Tests A–G as enumerated

Validation commands

- npm run typecheck
- npm run test:recovery-hints
- npm run test:address-match
- npm run test:safety-description-only
- new multi-place test script
- remote tester against the failing post URL
- npx supabase functions deploy process-share-link (after local validation)

Logging

- Write prompt to logs\prompts\multi-place-flow-<timestamp>-prompt.md
- Write implementation summary to logs\prompts\multi-place-flow-<timestamp>-output.md

Expected output

Before: actual cause of crash, current response shape, minimal plan.
After: files changed, reasons, new shape, multi-select behavior, save-failure behavior, tests run, remote test result, whether a new app build is required, remaining risks.

Stop conditions

- Edge Function not returning structured candidates → stop and explain backend change.
- Crash logs unavailable → stop and request device/Edge logs.
- Requires weakening auto-save safety → stop.
- Requires broad extraction rewrite → stop, propose staged plan.

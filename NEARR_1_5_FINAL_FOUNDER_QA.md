# Founder physical-device QA required before public release

This checklist is pending. The backend is not yet deployed and build 58 has not been uploaded or submitted; do not treat these as current pass/fail observations.

1. **Fresh iPhone install of 1.5.58/build 58:** verify icon, Welcome/onboarding, Mad Yolks deterministic practice, Phase 2 real practice, Google and Apple auth, tutorial-local place, Share Extension from a real Instagram share, Quick Check, save, five-photo gallery and restart persistence, Nearby/Food/map, Watch post, notification timing and duplicates.
2. **Existing-account upgrade from public 1.4.55/build 56:** first record a QA account's saved places, source links, cached photos, reminders/settings and Queue. Install build 58; verify session survives without onboarding restart or duplicate profile; all saved/source/photo data remains or recovers; map, Queue, reminders, Share Extension, notifications and Watch post work.
3. **Old-client coexistence:** retain a separate 1.4.55 installation/device where practical; confirm session/profile, saved/source hydration, map, Queue/result/review/save, share, reminders/settings, notifications and Watch post still work against the updated backend. No forced-update path is allowed.

Physical Google/Apple provider login, Share Extension invocation, push receipt and device upgrade cannot be honestly certified by server tests alone. Founder approval after this QA remains required before any public release.

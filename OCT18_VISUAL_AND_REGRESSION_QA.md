# October 18 visual and regression QA

## Native capture status

The requested recording was unavailable. The installed Android SDK bridge was located, but no emulator process or device target was available and `adb devices` could not produce a usable target. No controllable iPhone was exposed. I did not create mockups or label rendered substitutes as native screenshots.

Physical iPhone acceptance is still required for sheet feel, Dynamic Type extremes, gallery/vertical gesture ownership, native switch pixels, modal status-bar transitions, Share Extension warning capture, and the broad-camera tile flash.

## Automated acceptance

Passed on the final working tree before publication:

- `npm.cmd run typecheck`
- `npm.cmd run test:fieldnotes-oct18`
- `npm.cmd run test:fieldnotes-oct15`
- `npm.cmd run test:source-media-integration`
- `npm.cmd run test:source-thumbnails`
- `npm.cmd run test:saved-place-images`
- `npm.cmd run test:place-photo-contract`
- `npm.cmd run test:quick-check`
- `npm.cmd run test:quick-check-rolodex-ux`
- `npm.cmd run test:vayrin-quick-check-evidence-ui`
- `npm.cmd run test:share-completion`
- `npm.cmd run test:save-completion-contracts`
- `npm.cmd run test:multi-place-batch`
- `npm.cmd run test:multi-place-review-interactions`
- `npm.cmd run test:multi-select-places`
- `npm.cmd run test:vayrin-multi-place-review-redesign`
- `npm.cmd run test:share-extension-compact`
- `npm.cmd run test:share-extension-completion`
- `npm.cmd run test:share-extension-env`
- `npm.cmd run test:share-submission`
- `npm.cmd run test:onboarding-account-transition`
- `npm.cmd run test:create-map-navigation`
- `npm.cmd run test:create-map-continue-runtime`
- `npm.cmd run test:splash-lifecycle`
- `npm.cmd run test:auth-account-state`
- `npm.cmd run test:auth-screen-contracts`
- `npm.cmd run test:prebuild` preflight phase
- `npm.cmd --ignore-scripts run test:prebuild` full main matrix, after the identical preflight passed
- `npm.cmd run test:safe-development`

The first complete prebuild attempt exposed two missing local tool dependencies: EAS CLI for the shell-free deployment guard and `tsx` in `services/media-worker`. EAS CLI was installed in an isolated temporary tools directory and the media worker received its lockfile-defined dependencies with `npm.cmd ci`. The unchanged preflight then passed, and the full main matrix exited 0. No manifest or lockfile changed.

## Failing-before / passing-after evidence

- The old expanded geometry deliberately reserved the Queue row plus a 156-point map strip. New geometry tests assert a 90–95% sheet on representative small and large phone sizes.
- The camera integration test previously expected a new correction when expansion began. It now asserts zero added camera commands in normal and Nearby Explorer expanded-detail paths.
- The Quick Check save sequence had no representation for “persistence confirmed, resolution response lost.” The new transition suite proves exact reconciliation and resolution-only retry while rejecting cancelled, superseded, wrong-provider, and missing-source states.
- Phase 2 practice formerly asserted a Mad Yolks fallback for food practice. The regression now asserts no cross-place asset and verifies the neutral fallback.
- A stale component contract disabled the multi-place action whenever no rows remained selected. It now permits only a pending `Finish review` retry while retaining the original disabled state for an actionable empty selection.

## Coverage limits

Some repository UI tests inspect source contracts in addition to reducer/component transitions. The critical Quick Check reconciliation is exercised as a pure state-transition matrix; native network interruption, realtime delivery, and physical route animation still require device QA. No performance improvement is claimed because comparable native runs were unavailable.

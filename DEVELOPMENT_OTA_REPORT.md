# Development OTA report — onboarding account transition

## Outcome

Published the Nearr 1.6 onboarding account-transition fix to the **Development** EAS channel on October 9, 2026 (America/Los_Angeles). The update is JavaScript-only and targets the existing `1.6.59` runtime on Android and iOS.

No Production OTA, Production backend change, App Store submission, or new native build was made.

## Published update

| Field | Value |
| --- | --- |
| Channel / branch | `development` |
| EAS environment | `development` |
| Runtime | `1.6.59` |
| Message | `Fix onboarding account transition ownership and single-flight routing` |
| Source commit | `b2f5fcd7c2d769c0631ccbb128c98726528503c6` |
| Update group | `646f9126-0b97-4bae-b40d-dba3693cc23c` |
| Android update | `01a123f2-8e04-72aa-8cad-495c56391d8c` |
| iOS update | `01a123f2-8e04-771b-a557-45214e43a1e3` |
| Dashboard | https://expo.dev/accounts/andrewmahran/projects/nearr/updates/646f9126-0b97-4bae-b40d-dba3693cc23c |

The repository release wrapper validated the Development EAS environment before export and explicitly targeted the `development` channel and environment. Both platform bundles exported and published successfully.

## Native compatibility

The update changes TypeScript/JavaScript, tests, documentation, and a Development backend RPC implementation. It does not add or change native modules, configuration, entitlements, permissions, or runtime version. It is compatible with the existing Development native build:

- version/runtime: `1.6.59`
- build number: `59`
- EAS build ID: `74a22771-5998-485b-ac16-f316caf7491d`

A replacement native build was therefore unnecessary.

## Development backend dependency

Migration `20261009000001_onboarding_transfer_owner_order.sql` was applied only to the Development Supabase project `qnfxnmvxpjzfydgudtvs`. It replaces the existing `complete_onboarding_account_transfer_v2` function without changing table shape or the client RPC contract. The function now transfers `share_jobs` before `share_media_tasks`, preserving the parent/child ownership invariant enforced by `share_media_tasks_owner_guard`.

The applied function was verified with disposable live Development transactions for the founder-shaped deferred-media case, a new identity with zero saves, and a new identity with one real saved-place UUID. All completed successfully, kept parent/task ownership aligned, and replayed idempotently.

## Pre-publish validation

- focused single-flight account-transition regression: 7/7 passed
- live Development transfer proof: 3/3 scenarios passed
- TypeScript typecheck: passed
- full prebuild regression gate: passed
- physical-runtime, Phase 2, offline, install-lifecycle, authentic-auth, routing, deep-link, root-loop, and visual contract suites: passed
- Android account and final map surfaces captured from a Pixel 8a emulator
- `git diff --check`: passed

`supabase db lint --linked` could not authenticate because the CLI database password was unavailable. The guarded migration push succeeded, the local/remote migration histories matched afterward, and the live transaction proof exercised the changed function directly.

## Founder retest

Use the existing `1.6.59 (59)` Development build. Force-quit and reopen it so the new OTA loads, then follow [FOUNDER_RETEST_PLAN.md](FOUNDER_RETEST_PLAN.md). The expected result is one account transition into the Fieldnotes map with no account-screen return, provider chooser, warning overlay, or duplicate transfer.

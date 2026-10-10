# Onboarding account-transition regression proof

## Before/after Development reproduction

The live proof creates disposable Development-only anonymous and permanent identities, an onboarding checkpoint, a V2 transfer grant, a terminal Phase 2 share job, and its owner-guarded media task. Every identity and fixture row is deleted in `finally`.

Before the function reorder, the founder-shaped fixture reproduced `share_media_task_parent_owner_order` and left the grant pending. After the reorder, all three deployed scenarios pass:

| Scenario | Established destination | Real saved places | Media task | Result |
| --- | ---: | ---: | ---: | --- |
| Founder shape | Yes | 0 | 1 | Transfer completes; parent/task owners match; replay is idempotent |
| New identity, tutorial only | No | 0 | 1 | Transfer completes; local tutorial ID remains absent from the RPC result |
| New identity + real save | No | 1 | 1 | One UUID-backed save transfers; parent/task owners match; replay is idempotent |

Command:

```powershell
$env:RUN_LIVE_ONBOARDING_ACCOUNT_TRANSITION='1'
npm run prove:onboarding-account-transition:dev
```

## Focused client regression

`npm run test:onboarding-account-transition` passes 7/7 checks:

1. A slow Google completion coalesces auth-listener and remount replays.
2. Foreground/callback replay after completion is a no-op.
3. An error remains stable until explicit retry.
4. One explicit retry advances error to complete.
5. Zero-save and one-real-save requests execute once each.
6. Only the claimant may navigate or publish the failure.
7. SQL moves the parent job before the guarded media task.

## Broader validation

The following passed:

- `npm run test:prebuild`
- `npm run typecheck`
- `npm run test:onboarding-v2-physical-runtime`
- `npm run test:onboarding-v2-phase2`
- `npm run test:onboarding-physical-qa-regressions` — 30/30
- `npm run test:onboarding-fully-offline`
- `npm run test:onboarding-install-lifecycle` — 18/18
- `npm run test:onboarding-authentic-phase2-auth` — 35 cases, including Google/Apple and existing/new account contracts
- `npm run test:onboarding-1259-regressions` — 31/31, including duplicate OAuth and final-navigation ownership
- `npm run test:onboarding-phase2-auth-map-hardening` — 26/26
- `npm run test:auth-screen-contracts`
- `npm run test:auth-account-state`
- `npm run test:auth-deeplink`
- `npm run test:onboarding-routing`
- `npm run test:root-layout-loop`
- `npm run test:onboarding-v2-visual`
- `git diff --check`

`supabase db lint --linked` could not authenticate through the CLI login role because this machine has no database password. The same SQL compiled during the guarded Development migration application, and the deployed RPC passed the three live transactional proofs above.

## Visual preservation

Post-fix native Android captures are stored in:

- `artifacts/fieldnotes-implementation/onboarding-account-transition/android-account.png`
- `artifacts/fieldnotes-implementation/onboarding-account-transition/android-map.png`

They show the unchanged light-mode Create your map screen and final Fieldnotes map. The in-progress state is intentionally transient; its disabled/loading Continue contract is covered by the focused component/source regression. No production visual token or layout changed.


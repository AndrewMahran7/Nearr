# Cross-version save/source backend contract

The same final ordered local database replay was tested with both client contracts; no Production compatibility migration was deployed in this task.

| Contract | Local evidence | Result |
|---|---|---|
| Public Nearr 1.4.55/build 56 | `testLegacyV1TransferSafety.sql`, `testSourceAttachmentClientContracts.sql`, `testDualClientDatabaseContracts.sql`, and static source selectors in `testProductionDualClientStaticContracts.ts` | V1 RPC shape, manual source attach, unique/duplicate transfer, replay, RLS, and source ownership pass. |
| Nearr 1.5.58/build 58 | `testSafeOnboardingV2Core.sql`, `testSafeOnboardingV2Security.sql`, `testSafeOnboardingV2Failure.sql`, `testDualClientDatabaseContracts.sql`, and `testAnonymousOnboardingV2.ts` | Zero-save/synthetic tutorial, unique and duplicate saves, multiple sources, same-source dedupe, retries, security, failure rollback, and established-account paths pass. |
| Shared database invariant | `testSavedPlaceSourceOwnerInvariant.sql`, real two-session V1/V2 late-source/save tests, and repeated stress | No committed source relationship can have an owner other than its current saved place. |

These are restored-schema database contracts and static client source checks, not physical-device, App Store, or live Production smoke tests. Production deployment, old/new physical-client qualification, notification, recognition replay, Edge rollback, and build upload remain separate Nearr 1.5 release gates.

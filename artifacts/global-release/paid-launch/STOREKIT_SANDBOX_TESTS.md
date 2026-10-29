# StoreKit sandbox test ledger

As of 2026-10-29 UTC: **no real transaction executed in this paid-launch pass; qualification blocked**. Offline parser/SQL/UI tests and the Android emulator do not satisfy this gate.

## Available route and present blockers

This host is Windows. The enabled native-app inventory contained Apple Devices but it was not running; no iOS simulator was available. A read-only present-device query found no Apple/iPhone/iPad PnP device, and `idevice_id`, `ideviceinfo`, `pymobiledevice3`, and `xcrun` were not available on PATH. This establishes no accessible connected-device automation route in this session; it does not establish that the founder owns no iPhone.

Prior evidence recorded a signed **internal development** build 1.7.0(72), EAS ID `3d96cf71-c507-449e-af77-3bfd7fd57f38`, source `4346840b69749b4ff54a7c9bd2e0abb0e67c8b12`, one registered development device and a profile expiring 2027-02-22. It was not run on-device and predates the new paid contract. It is not an App Review or purchase qualification build. Current `eas.json` defines internal development and store-production build routes; root owns fresh EAS capability checks and any new build. A build service can produce an IPA but does not itself exercise StoreKit.

The supported account browser could inventory existing Apple/RC tabs but could not attach, and native fallback also failed. Therefore current product readiness, tester access, RevenueCat app mapping, and an accessible tester/device remain unverified. No sandbox credentials were requested or exposed.

Use a freshly signed build from the unified paid-launch source on an accessible registered iOS device or a qualified TestFlight device/Mac route. Sandbox uses actual App Store product data; local StoreKit configuration tests are additional engineering evidence. [Apple sandbox overview](https://developer.apple.com/help/app-store-connect/test-in-app-purchases/overview-of-testing-in-sandbox).

## Required real scenarios

Every row below is **NOT RUN / BLOCKED** until a redacted receipt records source SHA, signed build/version, storefront, environment, product, pseudonymous account, StoreKit transaction reference, RC event, backend ledger before/after, and visible UI outcome.

| Scenario | Required result |
| --- | --- |
| Load catalog and localized prices | Correct monthly unlimited subscription and all three quantities; exact native localized price; no annual/trial |
| Monthly initial purchase and renewal | Verified unlimited access; purchased tokens untouched; duplicate delivery adds no benefit/charge |
| Cancel then expire | Access through verified paid/grace boundary; then free/purchased fallback; no token reset |
| Refund, revocation and reversal | Correct access removal or token-lot reversal; out-of-order events safe; only genuine reversal restores |
| Starter purchase | Exactly 20 non-expiring finds in server ledger |
| Explorer purchase | Exactly 50 non-expiring finds in server ledger |
| Adventurer purchase | Exactly 200 non-expiring finds in server ledger |
| Same-pack repeat purchase | Each distinct genuine transaction credits once; old receipt replay credits zero |
| Purchase cancelled or pending approval | No entitlement/token grant until authenticated confirmation |
| Apple succeeds, client loses network | Visible pending state; later reconciliation credits once; never instruct repurchase |
| Webhook missed/exhausted or integration previously absent | Verified v2 lookup or authenticated historical resend restores same transaction once |
| Refund before purchase webhook | Revocation tombstone survives delayed original grant; no temporary spendable credit |
| Restore after reinstall / multi-device | Existing server balance and access recovered; no re-credit and no owner duplication |
| Account switch / anonymous conversion | Ownership transfers only through verified server transition; prior account cannot spend same lot |
| Wrong store, app, environment or owner | Rejected without balance mutation; sandbox cannot reach Production ledger |
| Free → token → Plus → expired | 3 UTC-month free finds first; token balances persist throughout; no hidden Plus cap |
| Successful multi-place source / failure / retry / tutorial | One charge only for qualifying durable source success; failures and excluded operations cost zero finds |

Replay/refund proof must cover actual authenticated delivery and the real database, not a dashboard TEST event alone. Keep purchase activation off until this ledger is populated with passing evidence and missed-payment recovery is operational.

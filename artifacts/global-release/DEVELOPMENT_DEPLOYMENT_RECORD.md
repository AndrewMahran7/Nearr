# Development deployment record

Later 26 October update: the unified disabled Railway worker is now deployed. This document retains the earlier iOS/Edge record; use [UNIFIED_WORKER_DEPLOYMENT](./recognition-qualification/UNIFIED_WORKER_DEPLOYMENT.md) for the current Railway source, image, health and containment evidence.

Recorded 25 October 2026 PT / 26 October UTC. Production was not changed and no OTA was published.

## Source and database

- Branch: `integration/nearr-global-fieldnotes-monetization`
- Signed candidate: `d4138146459f880950dc794d4d983ee70107f769`
- Nearr-Dev: `qnfxnmvxpjzfydgudtvs`
- Applied additive migrations: `20261021000001` through `20261021000005`
- Preservation proof: 42 auth users, 20 saved places, 66 jobs, unchanged ownership hash
- All legal, provider, market, purchase, catalog, sales and allowance gates: false

## Edge deployments

| Function | Version | JWT mode | Source SHA-256 |
|---|---:|---|---|
| create-share-job | 75 | verified | `cd51fc94fc40088e99fe556a10ca4ba050b5c26fe9509babe0ec145c5c0a875a` |
| process-share-link | 88 | function auth | `db08d45faf513a4ec7397a411c9193d7f99d1d15b827930b2cf58b254bd392a5` |
| process-share-jobs | 144 | function auth | `85d2039de5782b288295734f4fab1d1a231d73cfe77d89c554f866098fcb4d59` |
| plus-api | 1 | verified | `c5c8d36430dc3cf5ebebc5d2349046f1b5a89a828a3794cc3b2c2b631bcdd50d` |
| revenuecat-plus-webhook | 1 | webhook bearer | `200ee56f926f9eee8667dacc98a5be0ef9770272130065dbbcd554e0fc10a5b7` |

Unauthenticated probes to Plus API and webhook both returned 401.

## Railway

The unified media worker was not deployed. Railway CLI authentication was unavailable and the interactive OAuth attempt timed out. Historical Development deployment `69831ef2-7da5-495d-95b4-f1618b2f0b6e` remains on service `3c8cd190-b118-4ee4-9338-407843ef4e1f`; it predates this candidate. Provider gates remain false, so this does not authorize recognition dispatch.

## Native Development build

- EAS build: `af64b897-32a0-40f7-a690-c802c1920e39`
- Version/runtime/build: 1.7.0 / 1.7.0 / 69
- Distribution/profile: internal / development
- IPA SHA-256: `eeb6d6ea8e716578961bb7f2154bd0d8b595f15853713e8bde44ef3f887b2fce`
- IPA size: 51,495,750 bytes
- Host: `com.nearr.ios`, 1.7.0 (69)
- Extension: `com.nearr.ios.ShareExtension`, 1.7.0 (69)
- Both bundles contain `_CodeSignature/CodeResources` and embedded provisioning profiles.
- All 10 locales ? 2 files ? 2 targets are present.
- Xcode archive succeeded with no host/extension build-number warning.
- Installation: https://expo.dev/accounts/andrewmahran/projects/nearr/builds/af64b897-32a0-40f7-a690-c802c1920e39

Builds 62?64 exposed and resolved Xcode-image, duplicate-resource and Share Extension module-resolution defects. Builds 65?68 archived but revealed host/extension build-number mismatch during direct IPA inspection. Build 69 switched to one explicit local EAS version and is the first artifact that passes parity.

The IPA has not been exercised on a physical iPhone. Structural inspection on Windows does not independently revalidate Apple cryptography; EAS performed signing and archive/export.

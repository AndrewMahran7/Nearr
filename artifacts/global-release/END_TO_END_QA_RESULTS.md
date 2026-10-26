# End-to-end QA results

Status: source and local integration qualification passed; no claim of a complete device, provider or payment journey.

| Journey | Automated evidence | Live/device result |
|---|---|---|
| New eligible adult | Age/region, terms/AI separation and server gates pass local PostgreSQL/component tests | Real recognition blocked by provider/legal gates; no signed-device completion. |
| Existing user upgrade | Ownership-preservation migrations and account-bound UI paths pass; Dev row counts/hash preserved | Public 1.4-to-1.7 physical upgrade pending. |
| Ineligible/under-13 | 60 age/region combinations and queue/worker denials pass; no guardian path | Correctly denied; native accessibility/copy review pending. |
| Free user | 3-find ledger, reservation/settlement and saved-data independence pass database tests | Enforcement disabled; no live recognition. |
| Paid/restore/refund | Snapshot, webhook, transfer, grace, expiry/refund and concurrency contracts pass synthetic + PostgreSQL tests | Apple product and sandbox transactions absent. |
| Localized user | Ten catalogs, parity/placeholders/plurals/fallback/persistence and native resource generation pass | Native-language and physical Share Extension review pending. |
| Legacy client | Server architecture closes old provider path and preserves saved data | Actual public binary test pending. |

Passing focused evidence includes: root TypeScript; localization and native localization; consent identity and actual host save-flow boundary; privacy policy 32 checks; eligibility database 12 suites including 60 combinations; monetization policy 21 checks and database 28 cases; worker 663 tests (656 pass, 7 intentional skips); and Plus Edge Deno checks. The final repository matrix passed 143/143 scripts, `git diff --check` passed, and an isolated WSL iOS Expo prebuild exited 0 with all 40 localized host/extension string resources present. The prebuild used `--no-install`, so it does not prove CocoaPods, Xcode compilation, signing, IPA execution, StoreKit sandbox, real provider calls, or physical accessibility/layout.

Machine-readable matrix evidence is in [validation/matrix-results.json](validation/matrix-results.json), with one log per script. Native-generation evidence is in [native-prebuild-linux-success.log](native-prebuild-linux-success.log).

Blocked journeys are expected safe failures, not test passes for product completeness. Recognition cannot complete because no minor-compatible route and legal approval exist. Purchase cannot complete because no verified App Store/RevenueCat product exists. The dossier must not substitute mocks, generated screenshots or source inspection for those results.

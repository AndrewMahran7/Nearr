# End-to-end QA results

Status: source, database, Edge deployment and signed Development artifact qualification passed. Real provider, payment, upgrade and physical-device journeys remain blocked.

| Journey | Automated / artifact evidence | Live or device result |
|---|---|---|
| New eligible adult | Age/region, Terms/AI separation and server gates pass component and PostgreSQL tests | Recognition remains disabled pending provider/legal qualification. |
| Existing user upgrade | Additive migrations preserved 42 users, 20 saves, 66 jobs and ownership hash | Public 1.4-to-1.7 physical upgrade not run. |
| Ineligible / under-13 | 60 age/region combinations plus ingress/claim/worker denials pass | Correctly denied; under-13 has no guardian path. |
| Free user | Three-find ledger, reservation/settlement and saved-data independence pass | Enforcement remains disabled while recognition is unavailable. |
| Paid / restore / refund | Snapshot, webhook, transfer, grace, expiry/refund and concurrency contracts pass synthetic and PostgreSQL tests | Apple product and sandbox transactions do not exist in verified evidence. |
| Localized user | Ten catalogs, fallback, persistence, native generation and 40 IPA resources pass | Native-speaker and physical Share Extension review pending. |
| Legacy client | Server architecture closes old provider routes and preserves saved data | Actual public binary compatibility test pending. |

The final repository matrix passed 143/143 scripts. Focused evidence also includes root TypeScript; localization/native localization; consent identity and save-flow boundary; 32 privacy checks; 12 eligibility database suites including 60 policy combinations; 21 monetization policy checks; 28 monetization database cases; 663 worker tests (656 pass, 7 intentional skips); and Plus/webhook/worker Deno checks. `git diff --check` passed.

An isolated Linux Expo prebuild and standalone Share Extension Metro bundle passed with one Resources phase per target and 40 localized native files. EAS Development build 69 then completed Xcode archive/sign/export. Direct IPA inspection verified both bundle identifiers, version/build parity at 1.7.0 (69), bundle signing-resource manifests, embedded provisioning profiles and every required locale file. The archive log contains `** ARCHIVE SUCCEEDED **` and no nested `CFBundleVersion` mismatch. Windows inspection confirms artifact structure; EAS performed the signing operation.

Machine-readable evidence is in `validation/matrix-results.json`, `development-build-69-artifact.json`, and `DEVELOPMENT_DEPLOYMENT_RECORD.json`. A green signed artifact does not substitute for physical iPhone execution, VoiceOver/large-text/layout review, real recognition, StoreKit sandbox, native-speaker review or public-upgrade testing.

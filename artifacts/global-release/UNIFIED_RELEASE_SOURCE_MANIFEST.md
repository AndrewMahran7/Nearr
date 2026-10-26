# Unified release source manifest

Prepared from preserved worktrees on branch `integration/nearr-global-fieldnotes-monetization`.

| Source | SHA / state | Role |
|---|---|---|
| Latest Fieldnotes baseline | `99db449b26131a0c02d8642332832a74bd1440ec` | Physical-UI QA source and first integration parent. |
| Age-aware Development baseline | `3eea578d30ce1cd4a913320cc33301de03d96194` | Existing eligibility/deployment foundation. |
| Corrected release baseline | `ca08c154347096fe5da0bf2739cf0b25c0b706b0` plus preserved dirty privacy work | Privacy/Terms and permission corrections reconciled in `78502d1`. |
| Integration merge | `08b296113ce4a75638e49da9a0c76ed57b39a62f` | Unified Fieldnotes and Development ancestry. |
| Global database contracts | `2c54ff1` and `ad6f111` | Eligibility, consent, Plus, locale, ingress and queue-claim controls. |
| Signed Development candidate | `d4138146459f880950dc794d4d983ee70107f769` | App 1.7.0 (69), app-version runtime, EAS build `af64b897-32a0-40f7-a690-c802c1920e39`. |

The five additive global migrations were applied only to Nearr-Dev project `qnfxnmvxpjzfydgudtvs` on 20 October 2026 / 21 October UTC. Before/after evidence recorded 42 auth users, 20 saved places and 66 jobs with the ownership hash unchanged; a queued media task was preserved. Legal, market, recognition, purchase, catalog, sales and allowance gates remain false. Production database and services were unchanged.

Development Edge now runs `create-share-job` v75, `process-share-link` v88, `process-share-jobs` v144, `plus-api` v1 and `revenuecat-plus-webhook` v1 from the unified candidate. The Railway media worker remains historical deployment `69831ef2-7da5-495d-95b4-f1618b2f0b6e`; Railway authentication expired before the unified worker could be deployed. Fail-closed provider gates prevent unsafe dispatch.

Signed internal EAS build 69 was archived from the stated candidate SHA. Direct IPA inspection found host `com.nearr.ios` and extension `com.nearr.ios.ShareExtension` both at 1.7.0 (69), signing resources and provisioning profiles in both bundles, and all 40 required native localized resource files. IPA SHA-256 is `eeb6d6ea8e716578961bb7f2154bd0d8b595f15853713e8bde44ef3f887b2fce` (51,495,750 bytes). No OTA was published.

The branch is a qualified integration and Development handoff, not a public-release authorization. Provider permission, legal approval/publication, real payment catalog/sandbox evidence, native-speaker review, physical-device/upgrade QA and App Store Connect configuration remain external gates.

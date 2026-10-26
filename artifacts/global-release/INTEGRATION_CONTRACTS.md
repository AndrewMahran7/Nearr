# Unified release integration contract — 2026-10-20

Worktree: `C:/Users/andre/Desktop/Nearr/.tmp/nearr-global-integration-recovered`.
Branch: `integration/nearr-global-fieldnotes-monetization`.

## Source boundaries

- Fieldnotes baseline: `99db449b26131a0c02d8642332832a74bd1440ec` (verified local HEAD).
- Age-aware Development source: `3eea578d30ce1cd4a913320cc33301de03d96194`, merged without conflicts in `08b2961`.
- Corrected release baseline: `ca08c154347096fe5da0bf2739cf0b25c0b706b0`; dirty privacy/Terms changes copied through a three-way patch and resolved in `78502d1`. Original worktree preserved. A null privacy approval remains null.
- Root owns integration, eligibility/consent, backend dispatch, native config, dependency manifest, release engineering and commits.
- Legal/provider agent owns five legal/provider dossier files; no runtime mutations.
- Payments agent owns Plus client/Edge/SQL/QA files; old monetization flags stay suspended.
- Localization agent owns catalogs, locale hook, UI translation, native language bridge/plugin and localization/ASO dossier; root layout, age, consent, legal and Plus components coordinated separately.

## Safety contracts

- Account eligibility, AI sharing permission, Terms acceptance, provider permission and purchase entitlement are distinct server decisions.
- New eligibility: `account_eligibility_v2` with country of residence and minimized age band; no date of birth. Countries and floors are policy decisions with citations in the legal matrix, not assertions that a threshold alone establishes compliance.
- No under-13 path or simulated parental approval. Minor provider permission remains unavailable without an actual qualified mechanism. No legacy adult status silently becomes a new 13+ declaration.
- `is_account_eligible_for_ai(uuid)` is service-only and fail-closed. Old `is_adult_eligible_for_ai(uuid)` cannot reopen Gemini dispatch for this application.
- `is_account_eligible_for_purchase(uuid)` initially requires adult band and qualified market; payment products stay unavailable until server/store evidence is configured.
- Saved data and account rights remain available independently of recognition/payment eligibility.
- Provider calls: research budget $0 until a permitted candidate, existing authorized credentials, an explicit bounded cost and a viable benchmark can be established. No new vendor commitment.
- Runtime localization uses maintained i18next, explicit UI keys, device fallback, persisted selection and shared extension language. User content/proper nouns are never silently translated.
- Current native runtime `1.6.59` is source evidence, not authorization to publish changed native modules as an OTA. New native runtime/build numbers require live EAS/ASC inspection.
- Public release remains manual. Missing physical screenshots, payment sandbox evidence, contractual qualification or legal approval cannot be replaced by source tests.

## Live state inspected

Railway project `4037a3b5-d66f-409e-b734-56c22c244e3e`, Development environment `57d055b7-5326-4f96-a7a9-70523ee0d3f0`, media-worker service `3c8cd190-b118-4ee4-9338-407843ef4e1f`: `69831ef2-7da5-495d-95b4-f1618b2f0b6e` remains SUCCESS. Its historical source-equivalence proof is recorded in the inherited October 19 provenance report. The same service ID has no deployments in the Railway production environment; the separate `Nearr` service must be inspected rather than assuming it is empty.

No live mutation or release gate is claimed by this document.

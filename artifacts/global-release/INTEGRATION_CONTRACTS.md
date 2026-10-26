# Unified release integration contract ? 2026-10-25

Worktree: `C:/Users/andre/Desktop/Nearr/.tmp/nearr-global-integration-recovered`

Branch: `integration/nearr-global-fieldnotes-monetization`

Signed Development candidate: `d4138146459f880950dc794d4d983ee70107f769`

## Source and safety boundaries

- Fieldnotes baseline: `99db449b26131a0c02d8642332832a74bd1440ec`.
- Age-aware Development source: `3eea578d30ce1cd4a913320cc33301de03d96194`, merged in `08b2961`.
- Corrected privacy baseline: `ca08c154347096fe5da0bf2739cf0b25c0b706b0`; preserved corrections reconciled in `78502d1`. A null policy approval remains null.
- Account eligibility, AI-sharing permission, Terms acceptance, provider qualification and purchase entitlement are distinct server decisions.
- Eligibility stores country of residence and minimized age band, not birth date. Under-13 remains unsupported; no simulated guardian approval exists.
- Service-only eligibility functions, queue ingress/transition/claim guards and worker checks fail closed. The legacy adult alias cannot reopen Gemini dispatch.
- Saved data, account controls and deletion rights remain independent of recognition and payment eligibility.
- Runtime localization uses i18next, explicit keys, device fallback and persisted choice. User content and proper nouns are not silently translated.
- Plus access requires a fresh server-verified RevenueCat snapshot; client state cannot grant entitlement.
- Local EAS versioning supplies one explicit iOS build number to the host and Share Extension before Xcode starts. Build 69 proves nested-bundle parity.

## Development state

The five additive global migrations are applied to `qnfxnmvxpjzfydgudtvs`; preserved counts are 42 users, 20 saved places and 66 jobs. Edge deployments are recorded in `DEVELOPMENT_DEPLOYMENT_RECORD.md`. The unified Railway worker was not deployed because the CLI session was unauthorized and interactive OAuth timed out. The historical worker remains active, while all recognition/provider gates remain false.

Signed EAS build `af64b897-32a0-40f7-a690-c802c1920e39` is an internal Development build, version 1.7.0 (69), runtime 1.7.0. It is structurally qualified by direct IPA inspection but has not been installed and exercised on a physical iPhone.

Production database, Edge, Railway, OTA, App Store listing and public binary remain unchanged. Public release stays manual and blocked by the external gates in the final report.

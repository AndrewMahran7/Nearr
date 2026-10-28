# Live store and release readback

Observed 27 October 2026 PT / 28 October UTC in the authenticated App Store Connect and RevenueCat sessions. Read-only: no version, product, privacy, agreement, release-mode or submission change was made.

## App Store Connect

App ID **6764170112**, Nearr, Andrew Mahran account:

- Public **1.4.55 — Ready for Distribution**.
- Editable **1.5.58 — Prepare for Submission**, no build selected; the upload-build placeholder remains.
- Only **English (U.S.)** is localized in that version's locale menu. The other nine requested locales have not been saved/read back.
- **Manually release this version** is selected (visually checked). Automatic release was not enabled because mandatory launch gates are unresolved.
- App Review lists historical completed/removed entries, most recently the public 1.4.55 entry dated September 5. No 1.7 review submission was created. There is no new submission ID or Waiting for Review evidence.
- Public App Privacy remains **Data Not Collected**, shown as published four months ago. This is inaccurate; see `../LEGAL_AND_PRIVACY_RECONCILIATION.md`. No unsupported answers were entered.
- Support URL: `https://nearrapp.com/support`; marketing URL: `https://nearrapp.com/`; privacy URL: `https://andrewmahran7.github.io/nearr-legal/privacy`. A later bounded direct HTTPS check verified support, terms and the canonical GitHub privacy page return 200. Support lists the expected contact; privacy and Terms both retain August 19, 2026 effective dates. The initial web-tool errors were not outages. These reachable pages are not approved new 1.7 legal texts; see `public-url-readback.json`.
- Free Apps Agreement **Active**. Paid Apps Agreement **Active — New Agreement Available**; bank/tax/DSA indicators Active. The Account Holder must handle any required new agreement personally. No agreement was accepted here.
- Existing review credentials were not verified and are not repeated in this report. A working, authorized review account for the final candidate remains necessary.
- Final age-rating questionnaire, territory availability, export/compliance answers and final review notes were not certified or changed. A 13+ product policy is not itself an Apple age-rating determination.

The proposed next version is 1.7.0, not attachment of a 1.7 build to 1.5.58. Action-time confirmation was requested for changing the stale draft and saving the localized draft package through Windows UI; no response had arrived at this readback. This is separate from the mandatory qualification gates for submission.

## RevenueCat

Authenticated **Nearr Dev** project `7d727ef6`:

- Active webhook **Nearr Dev Monetization v2** points to `https://qnfxnmvxpjzfydgudtvs.supabase.co/functions/v1/revenuecat-webhook`, the legacy endpoint, not `revenuecat-plus-webhook`.
- Active offerings shown: `nearr_tokens_v1` (three packages) and default `nearr_monetization_v2` (four packages).
- The default offering contains 20/50/200 token packages and **Nearr Pro monthly**, package `$rc_monthly`, product `com.nearr.pro.monthly.v1`.
- Intended `nearr_plus_v1` is not among the displayed active offerings. No Plus catalog activation, entitlement/product/webhook mutation, or sandbox transaction was performed.

Proposed Plus pricing remains $1.99/month for ten successful finds per billing period; no new price or commercial obligation was created. Purchases remain deferred. Local explicit free-only support must not be conflated with live configuration or qualified recognition.

## EAS and iOS

`eas whoami` authenticated as the existing account. The bounded read-only five-build query is retained in `eas-ios-readback.json`. All five returned iOS builds are INTERNAL Development builds; it is not a query of every historical build.

Latest returned build: **1.7.0 (72)**, EAS `3d96cf71-c507-449e-af77-3bfd7fd57f38`, FINISHED, Development, source `4346840b69749b4ff54a7c9bd2e0abb0e67c8b12`, runtime `1.7-onboarding-date-v1`. It is not an App Store release candidate.

Reused exact-build packaging evidence: `../../onboarding-integration/ipa-verification.json`. IPA SHA-256 `0ac0b517d48eb7b3ccfd365b80d3ab0bebab42f78f562f1da0604b982fbfc3dc`. Host `com.nearr.ios` and extension `com.nearr.ios.ShareExtension` both 1.7.0 (72), ten language resources each, shared `group.com.nearr.ios`, native date picker, provisioning/signature manifests present. Internal provisioning has one registered device and expires February 22, 2027. Development Supabase/channel/runtime remain embedded; host is a development client. This is packaging inspection, not on-device execution or cryptographic Apple signature validation on Windows.

The actual Production policy guard was exercised with `EAS_BUILD_PROFILE=production node scripts/checkPrivacyPolicyRelease.cjs --eas-build`. It correctly refused: **PRIVACY_RELEASE_BLOCKED — founder-approved offline policy snapshot missing; explicit founder policy approval not recorded.** No approval marker was invented, Production EAS build launched, IPA uploaded, or build selected in ASC.

Physical-iOS Share Extension behavior, public 1.4.55 upgrade/data continuity, TestFlight smoke testing, and any enabled StoreKit flow remain unverified. Android emulator evidence cannot substitute for these.

## Metadata and screenshots

`metadata-candidates.json` contains ten conservative localized draft records; `metadata-validation.json` verifies character/UTF-8 limits. Recognition-qualified marketing is kept separate and explicitly not upload-ready. There is no native-speaker certification, ranking claim, or assertion of working recognition.

The previous 141 real Android captures remain useful UI evidence, not automatically an Apple-ready, rights-cleared ten-locale screenshot set. No new localized marketing sets were uploaded or read back. Do not disguise Android captures as verified iOS runtime, advertise disabled recognition, or reuse old 1.5 screenshots as current 1.7 evidence.

**Actual outcome: BLOCKED, not submitted, no automatic release, no paid activation.**

# Localized screenshot fidelity

Status: **not qualified for the unified release. Zero actual localized Fieldnotes runtime captures produced in this environment.** No physical iPhone or native simulator QA is claimed.

The preserved corrected 1.5 package contains 126 reconstructed PNG candidates: nine locales × seven stories × two portrait sizes (1206×2622 and 1320×2868), nine contact sheets and 63 SVG compositions. This work re-read all 126 PNG files, checked their SHA-256 against the prior manifest and checked IHDR dimensions. [Preserved asset audit](aso/preserved-screenshot-audit.json) records the result and exact source root. The prior manifest itself labels the assets “SOURCE-RECONSTRUCTED, NOT NATIVE CAPTURE” and source `ca08c154347096fe5da0bf2739cf0b25c0b706b0`.

Those assets use the older interface and are **excluded from unified-release uploads**. Contact sheets are review aids. SVG sources and headline/story research may guide composition after capture; neither can prove the new UI, actual translation, paid flow or recognition behavior. The previous product copy and image provenance are retained without overwriting either release worktree.

Capture the qualified signed native build in each of the ten supported interface locales. Record build/runtime/source SHA, device model/iOS, locale, text size, appearance, account eligibility, feature flags and whether recognition data is an approved fixture or a real run. Preserve raw captures beside any marketing composition; do not paint a translated UI onto an English screenshot.

| Story | Required actual screen/state | Specific fidelity check |
|---|---|---|
| Share → Find | Supported post handed to the native extension | Actual localized native loading/permission/recovery; no invented result |
| Check a result | Quick Check or verified saved result | Uncertainty and saved status truthful; proper names preserved |
| Multiple places | Multi-place review | Real candidate count, count grammar, selected/failed states |
| Personal map | Fieldnotes map with saved pins | Correct current icon, colors, dock, markers and locale |
| Original context | Near-full-screen place detail | Fixed header, genuine image provenance, original-post language preserved |
| Nearby | Reminder preferences or actual reminder | Permission state correct; full switches and no clipping |
| Your preferences | Language selector and optional Plus where qualified | Real Store price/offer; saved access remains free |

Additional QA evidence must include neutral age/region entry, under-13 restriction, applicable higher-age restriction, explicit AI permission/refusal, legacy update-required state, account deletion, purchase pending/cancel/restore/refund and language persistence across app/extension restarts. German expansion, CJK glyphs and accessible text sizes need actual screenshots with no overlap, truncation of material terms, hidden controls or status-bar contrast problems.

Current automated evidence is limited to React/source regression checks and native project generation: [resource audit](localization/native-resource-audit.json), [successful prebuild](native-prebuild-linux-success.log), and the root E2E report. These do not replace raw native capture or physical QA. App Store dimensions must be rechecked against the actual target display class at upload time using [Apple screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/).

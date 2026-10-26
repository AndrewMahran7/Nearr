# App Privacy disclosure matrix

Status: final implementation inventory candidate; **not entered or approved in App Store Connect**. Apple's answers must cover all data collected by the app and integrated partners, even when only some users or regions use a feature. The prior 35-type audit was retained; “Data Not Collected” is not supportable.

| Apple category | Collected / linked | Purpose and evidence to confirm before submission |
|---|---|---|
| Email address | Yes / linked | Account authentication, recovery and support. Confirm Supabase auth configuration and support workflow. |
| User ID | Yes / linked | Supabase account, ownership, permissions, queue, RevenueCat opaque customer mapping. |
| Precise location | Yes / linked | Nearby map/reminders and place context when permission is granted. Confirm server versus on-device flows and background-location behavior. |
| Coarse location | Yes / linked where derived/sent | Regional/nearby behavior and recognition context. |
| Photos or videos | Yes / linked | Shared source media/frames used to identify places; sent only after eligibility and AI permission. |
| Audio data | Yes / linked | Audio extracted/transcribed from shared videos where enabled. |
| Other user content | Yes / linked | URLs, captions, notes, corrections, saved places and support input. |
| Browsing history | Yes / linked | Social-post/source URLs submitted from outside the app. |
| Search history | Yes / linked | Place and saved-place searches where sent/stored. Confirm retention. |
| Purchase history | Conditional / linked | Apple/RevenueCat product, entitlement and transaction lifecycle; Nearr does not receive payment-card data. |
| Product interaction | Yes / linked | Saved-place, queue and allowance operations; optional Plus funnel analytics remains disabled. |
| Device ID | Needs final SDK audit | Push token/device-scoped operational IDs may meet Apple's definition; advertising ID is not intentionally collected. |
| Crash data | Needs final binary/vendor audit | Confirm every bundled SDK and EAS/native crash setting. |
| Performance data | Needs final binary/vendor audit | Worker/server telemetry and any client performance SDK. |
| Other diagnostic data | Yes / linked as applicable | Error, retry, provider, queue and request diagnostics; ensure no unnecessary source content. |
| Age band and country | Yes / linked after account declaration | Eligibility and compliance. Apple may map this to Other Data; no date of birth is collected. |
| AI/Terms/privacy permission records | Yes / linked | Compliance, security and service operation; privacy viewing is recorded only for an approved exact snapshot. |
| Language preference | Yes / linked for authenticated sync | App functionality and localized server notifications. |

Purposes should be limited to App Functionality, Developer Communications where support requires it, and Analytics only if separately activated and disclosed. None of the prepared code authorizes Third-Party Advertising, developer advertising/marketing, data-broker sharing or cross-app tracking. Tracking should remain **No** unless a final SDK/partner audit shows linking with third-party data for ads or ad measurement.

Provider sharing must name the real recipients and purposes in the approved privacy policy: Supabase, Railway/hosting, Apple, RevenueCat if enabled, Google Places/Maps, the qualified recognition/transcription/media-acquisition providers, notification infrastructure and support systems. Verify each provider's retention, training, region and deletion behavior. OpenAI API data is not used for training by default, but ordinary abuse-monitoring logs may retain content up to 30 days; describe the exact account controls actually obtained.

Apple's definitions and conditional-collection rule are in [App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/). The app privacy policy must identify collection, uses, third-party sharing, retention/deletion and withdrawal as required by [App Review Guideline 5.1](https://developer.apple.com/app-store/review/guidelines/).

Before submission, inspect the signed binary and privacy manifests, enumerate SDK network behavior, resolve Device ID/crash/performance rows, confirm source-media retention and all subprocessors, then enter answers in App Store Connect and read them back. The approved public policy URL must match the exact in-app snapshot. No answer in this file is an App Store Connect submission record.

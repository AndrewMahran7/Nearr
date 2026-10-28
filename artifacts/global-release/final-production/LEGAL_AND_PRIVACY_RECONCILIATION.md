# Legal and App Privacy reconciliation

Reviewed 27 October 2026 PT / 28 October UTC. **Not approved, published, or entered as final App Privacy answers.** This record corrects stale assumptions; it does not certify legal compliance.

## Live public and Apple state

- App Store Connect app `6764170112`, authenticated Andrew Mahran session, still publishes **Data Not Collected** (shown as published four months ago). This is materially inconsistent with account and saved-place processing.
- ASC's policy URL is `https://andrewmahran7.github.io/nearr-legal/privacy`. The app's policy manifest and eligibility support link also use this address. Terms use `https://nearrapp.com/terms`. No URL was silently changed.
- `https://nearrapp.com/privacy` was retrieved and displays an August 19, 2026 policy. It includes account data, shared media, diagnostics, location and a 90-day first-party website attribution cookie. It is not the new 1.7 approved policy. The web retrieval tool could not retrieve the other two URLs; that is not proof that those URLs are down.
- Apple Business currently shows **Free Apps Agreement: Active** and **Paid Apps Agreement: Active (New Agreement Available)**. Account Holder action on the newer terms is not simulated. The prior report saying simply “Paid Agreement awaiting acceptance” is historical, not current readback.

## Exact technical redlines to the existing 13+ draft

`../PRIVACY_TERMS_FINAL_DRAFTS.md` remains the full proposed consumer wording. This turn changes only:

1. Replace “asks for age range / does not request full birthdate” with the actual Birthday flow: full birthday is screen-memory input, converted locally to an age range; only age range/country are persisted or sent. Successful submission clears it, and component unmount discards it. Evidence: `components/AgeEligibilityGate.tsx`, `lib/birthdayEligibility.ts`, `lib/localEligibility.ts`, and the retained Birthday contract tests. Do not describe local input as never requested.
2. State that optional app behavioral analytics is disabled, without equating this to no operational records. `lib/providerAudiencePolicy.ts` returns false and `lib/analytics.ts` returns before anonymous-ID creation or insertion.
3. Restore the existing website referral/campaign-cookie disclosure (up to 90 days). Do not claim this alone proves Apple Tracking; website attribution and linking app data with third-party advertising data are different questions.

The Git diff is the exact redline. Operator/contact remain Andrew Mahran (individual), andrew.mahran@icloud.com. Effective date remains unset because publication has not occurred. No fake approval date, provider entitlement, retention setting, or consumer launch promise was added.

## App Privacy findings and unresolved declarations

Apple defines collection as transmission off-device with access longer than real-time servicing. Its label must cover integrated partners and different feature/age/region cohorts, not merely the default screen. [Apple App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/).

| Item | Evidence-based disposition |
| --- | --- |
| Account email and user ID | Collected and linked for authentication/ownership. “Data Not Collected” cannot remain. |
| Birthday | Full date stays in screen memory in this flow. Do not mark full birthdate as server-collected merely because a native picker displays it. Persisted age band/country and permission records are separate account-linked data. |
| Other Data Types | Age band, residence country, language preference, and legal/AI permission records fit Apple's residual category when not covered by another specific type. App Functionality; linked to the account. This resolves the mapping recommendation, not a saved ASC response. |
| Device ID | Account-associated push tokens/install identifiers used for delivery meet the device-level identifier concern; retain a Yes candidate for App Functionality, linked, pending final binary/SDK verification. Do not infer advertising-ID collection. |
| Tracking | Inspected 1.7 source has no intended ad network/data-broker path and optional analytics is off. The technical candidate remains No, contingent on exact final SDK/partner behavior. A first-party website referral cookie alone is not the required evidence of cross-company app tracking. |
| User content, browsing/search, precise/coarse location, diagnostics | Retain the detailed existing matrix, but distinguish destination coordinates from the user's location and real-time requests from retained partner data. The selected provider route and final native SDK evidence still matter. |
| Purchases | Deferred free-only code is not proof that every historical transaction/RevenueCat flow is absent. Scope final declarations to actual shipped/current data practices, including any existing accounts, before removing this category. |

Apple definitions support the category/Tracking recommendations; these are engineering inferences from inspected data flows, not Apple approval. No wholesale “No” answers are inferred from disabled optional analytics.

## Consolidated approval boundary

The final consumer policy cannot truthfully name a qualified 13+ recognition route until guardian authorization, teen safeguards, acquisition/transcription recipients, retention, and markets are decided and evidenced. Free-only versus paid wording also must match the actual activated service. Prepare one final, hash-matched policy/Terms package after these decisions, obtain the founder/privacy owner's approval, publish at the canonical HTTPS locations, update the in-app snapshot and legal configuration, then read back ASC answers. Do not repeatedly ask for minor text approvals while those material decisions remain open.

No public legal site, Apple privacy answer, release option, or agreement was modified by this reconciliation.

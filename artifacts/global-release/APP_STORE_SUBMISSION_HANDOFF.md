# App Store submission handoff

Status: candidate assets and code are prepared; App Store Connect configuration, signed-binary qualification and submission are blocked. Public release must remain manual.

| Item | Prepared | Still required |
|---|---|---|
| Version/build | App version 1.7.0, app-version runtime, EAS Development profile | Reinspect remote build numbers, create signed candidate, verify IPA/runtime/extensions and record EAS ID. Build 61 is historical only. |
| Product | Unified Fieldnotes, age gate, AI permission, Plus, ten locales, Share Extension | Physical upgrade, layout, VoiceOver, large text, dark mode and extension QA. |
| Age rating/regions | Conservative policy matrix | Accurate ASC questionnaire and availability only for qualified markets. No Kids Category claim. |
| Privacy/Terms | Exact Development drafts and disclosure inventory | Counsel/founder approval, effective dates, publish canonical HTTPS pages, bundle approved hash-matched snapshot and enter ASC answers. |
| Third-party AI | Explicit permission/revocation and server gates | Name exact approved provider/data handling in policy and review notes; provider qualification evidence. |
| IAP | One monthly Plus implementation | Create subscription group/product, RevenueCat mapping/webhook, localized price, sandbox matrix and review screenshot. |
| Localization | Ten runtime/native catalogs and metadata drafts | Native-language review and real per-locale signed screenshots; upload/readback in ASC. |
| Release control | EAS lanes and production guards | Select manual release, attach correct build to the current draft, provide working review account/instructions. |

Suggested review flow after qualification: sign in with the supplied permanent review account; select a supported age/country; view approved Terms/privacy and grant AI sharing; submit the provided permitted test post; review/save a result; open saved place on the map; then open Plus, view localized monthly price, purchase in sandbox, restore, and confirm historical places remain after entitlement changes. Every step must be true in the submitted binary and live review backend.

Apple requires complete functional IAPs, accurate screenshots and metadata, an in-app and metadata privacy-policy link, and explicit permission before sharing personal data with third-party AI. References: [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), [App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/), and [subscription setup](https://developer.apple.com/app-store/subscriptions/).

Do not submit while the current legal/provider/payment gates are false. Do not attach a new build to an old incompatible draft, publish a production OTA for native changes, invent review credentials, or automatically release after approval.

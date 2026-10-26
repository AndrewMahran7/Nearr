# App Store submission handoff

Status: unified code and a signed internal Development candidate are prepared. App Store Connect configuration and public submission remain blocked; release must stay manual.

| Item | Prepared evidence | Still required |
|---|---|---|
| Version/build | 1.7.0 (69), runtime 1.7.0, EAS `af64b897-32a0-40f7-a690-c802c1920e39`; host/extension parity and 40 native locale files verified in IPA | Create the later distribution/App Store build only after all gates pass; attach and read back the exact build in ASC. |
| Product | Unified Fieldnotes, eligibility, AI permission, Plus, ten locales and Share Extension | Physical upgrade, Share Extension, layout, VoiceOver, large text and dark-mode QA. |
| Age rating/regions | Conservative jurisdiction matrix and fail-closed server policy | Counsel-approved markets; accurate ASC questionnaire and availability. No Kids Category claim. |
| Privacy/Terms | Exact Development drafts and disclosure inventory | Founder/counsel approval, effective dates, canonical HTTPS publication, approved hash-matched snapshot and ASC answers. |
| Third-party AI | Explicit permission/revocation and server gates | Exact qualified provider, data handling, review notes and real benchmark evidence. |
| IAP | One monthly Plus implementation | Create `nearr_plus_monthly_v1`, RevenueCat mapping/webhook, localized price, sandbox matrix and review screenshot. |
| Localization | Ten runtime/native catalogs and ten metadata drafts | Native-speaker review and real per-locale screenshots from the current build; upload/readback in ASC. |
| Release control | Development build and production guards | Review account/instructions, monitoring/rollback check, manual release selection. |

Build installation page: `https://expo.dev/accounts/andrewmahran/projects/nearr/builds/af64b897-32a0-40f7-a690-c802c1920e39`.

Suggested review flow after qualification: sign in with a permanent review account; select a supported age/country; view approved Terms/privacy and grant AI sharing; submit a permitted test post; review/save a result; open the saved place; then open Plus, view Store-localized price, purchase in sandbox, restore and confirm prior places remain after entitlement changes.

Do not submit while provider, legal, catalog, sales or allowance gates are false. Do not publish a production OTA for these native changes, invent review credentials, reuse old screenshots or enable automatic public release.

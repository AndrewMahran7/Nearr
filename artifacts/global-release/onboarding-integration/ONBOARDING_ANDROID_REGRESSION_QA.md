# Android integration regression

Existing Pixel 8a AVD (`emulator-5554`), Android 16, 1080×2400, density 420. Existing SDK and emulator were reused; no AVD was recreated and no app data wipe was performed.

The existing feature-built debug APK uses the same Android native contract (`1.7-onboarding-date-v1`, date picker 8.0.1). Its recorded SHA-256 is `d88dcfa493ecef93ffdc23d0adf9a330653547e43d18632462bb48be5022700e`. JavaScript was served from the **new integrated worktree**, not the original feature worktree. No new Android binary is claimed. The final iOS-only build-number changes do not alter that Android contract.

Metro started with explicit Development variables and the ignored local Development environment file. Startup logs confirmed Nearr-Dev (`qnfxnmvxpjzfydgudtvs.supabase.co`) and no persisted auth token. Wi-Fi and cellular data were disabled for offline checks; Metro remained reachable over ADB reverse.

## Observed screenshots

All paths below are relative to this document's `screenshots/` directory. Early screenshots document first-pass findings, not the final localization state.

| Check | Evidence/result |
| --- | --- |
| Separate language screen | `02-integrated-language.png` |
| Immediate offline Spanish selection | `03-offline-spanish.png` |
| Birthday follows language | `04-offline-spanish-birthday.png` |
| Language survives cold restart | `05-spanish-restart.png` |
| Native picker opens | `06-native-picker.png` |
| Untouched seed does not submit DOB | `07-untouched-seed-rejected.png` |
| Deliberate synthetic adult date | `08-selected-synthetic-birthday.png` |
| Country choices in separate sheet | `09-country-list.png` |
| Continue enabled only after date + country | `10-birthday-ready.png` |
| Offline welcome reached | `11-offline-welcome.png` |
| Offline onboarding advances | `12-offline-tutorial.png` |
| Inherited English choice labels found | `13-offline-practice.png` |
| Choices corrected and visually retested | `14-localized-interest-choices.png` |
| Personalized copy corrected | `18-resumed-tutorial.png` |
| Bundled tutorial video/rehearsal starts offline | `19-offline-challenge.png`, `20-offline-rehearsal.png` |
| 1.6× text, scrollable birthday + fixed CTA | `21-birthday-large-text.png`, `22-large-text-scrolled.png` |
| 1.6× language selection | `23-language-large-text.png` |

The first challenge/account screenshots exposed further untranslated interface copy. Final source `4346840` corrects those missing translation calls/keys and has stronger automated catalog coverage. Original post video text and captions remain original content.

## Data and limitations

Read-only inspection of the emulator's local declaration after the synthetic adult journey showed exactly `{"ageBand":"18_plus","countryCode":"US"}`, plus locale `es-MX`; no DOB was in that declaration. There was no persisted auth session or declaration owner. To exercise a second local identity, a guarded QA helper removed **only this synthetic declaration** after backing up the database locally; other storage was preserved. This is not an app feature, an age-gate bypass for accounts, or a server modification.

After system font-size changes, Android reported input-dispatch timeouts for both Nearr and System UI. Screenshots `25a-restriction-picker.png`, `25b-restriction-form.png`, `26-recovered-birthday.png` preserve this interruption. The existing AVD was rebooted without wiping data. Do not interpret the interrupted attempt as a successful restriction check; subsequent results are recorded below.

Actual authenticated existing-session restoration, Google/Apple login, reinstall and account switching were not performed on this emulator. Automated contract coverage is reported separately. Physical iPhone QA remains required. Large-text screenshots verify reachable/scrollable layout, not overall Android performance certification.

## Restriction retest after recovery

The AVD recovered after reboot and dismissing a Pixel Launcher timeout. A native picker date in 2015 plus United States produced the restricted screen (`31-picker-final-check.png`, `32-restricted-success.png`). A cold restart stayed restricted (`33-restricted-after-restart.png`), and hardware Back did not expose an editable age declaration (`34-restricted-back-no-bypass.png`). Storage inspection confirmed exactly `{"ageBand":"under_13","countryCode":"US"}`, no account token or owner. This passes the local restricted-user persistence check; it does not substitute for a server-backed restricted-account test.

The QA-only underage declaration was then removed using the guarded helper, retaining other storage and recoverable ignored backups. Wi-Fi, cellular data and font scale 1.0 were restored. No account/server eligibility record was changed. Intermediate captures 25–30 document interrupted/timing attempts; only the explicit successful captures above are acceptance evidence.

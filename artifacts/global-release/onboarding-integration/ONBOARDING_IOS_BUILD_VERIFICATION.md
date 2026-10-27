# Signed iOS Development build verification

**COMPLETED: Nearr 1.7.0 (72), internal Development client. Physical iPhone QA remains open.**

- EAS build: `3d96cf71-c507-449e-af77-3bfd7fd57f38`.
- [Install/build page](https://expo.dev/accounts/andrewmahran/projects/nearr/builds/3d96cf71-c507-449e-af77-3bfd7fd57f38).
- [Signed IPA](https://expo.dev/artifacts/eas/-mob2ZDJV5E00uaAmaaLPw5IEmfN-YE2Ll1wQ7TABAQ.ipa).
- Source: `4346840b69749b4ff54a7c9bd2e0abb0e67c8b12`.
- Created: 2026-10-27 18:28:25 UTC; EAS FINISHED: 2026-10-27 18:37:35 UTC.
- Profile / channel / environment: **development / development / development**.
- Expo project: `@andrewmahran/nearr`, `2ec7a08a-2078-4232-a244-c9d16fb75ffe`.
- Runtime: `1.7-onboarding-date-v1`.
- IPA SHA-256: `0ac0b517d48eb7b3ccfd365b80d3ab0bebab42f78f562f1da0604b982fbfc3dc`.

## Actual IPA inspection

Command: `python scripts/inspectOnboardingIpa.py .tmp/onboarding-integration/nearr-development-72.ipa 72`. Exit 0; sanitized machine evidence in `ipa-verification.json`.

| Check | Result |
| --- | --- |
| Host ID / version / build | `com.nearr.ios` / `1.7.0` / `72` |
| Extension ID / version / build | `com.nearr.ios.ShareExtension` / `1.7.0` / `72` |
| Date picker compiled | RNDateTimePicker symbols present in native executables; locked dependency 8.0.1 |
| Native locales, both bundles | en-US, es-MX, es-ES, pt-BR, fr, de, it, ja, ko, zh-Hans |
| Expo.plist runtime/channel | `1.7-onboarding-date-v1` / `development` |
| Expo updates project | `https://u.expo.dev/2ec7a08a-2078-4232-a244-c9d16fb75ffe` |
| Embedded host + extension config | appEnv=development, backendEnv=development, Supabase `qnfxnmvxpjzfydgudtvs.supabase.co` |
| Signing evidence | Both embedded ad-hoc profiles + `_CodeSignature/CodeResources` present |
| Team/app group | `9S69NZQTUX` / `group.com.nearr.ios` for both |
| Registered devices | One iPhone in both profiles; expiry 2027-02-22 |
| Fieldnotes icon | Existing source unchanged; AppIcon60x60 + compiled Assets.car present |
| Host JS / extension JS | Host intentionally not embedded (Development launcher); extension main.jsbundle present |

EAS used the existing remote distribution certificate and separate profiles. Non-interactive CLI did not revalidate credentials against Apple's portal, but EAS completed the signed native archive. This Windows host inspected the IPA and profiles; it did **not** run Apple's `codesign --verify` or install on an iPhone. Physical launch is still an acceptance step.

## Development update / launching

The new native client must be installed first. After the above IPA/runtime verification, the guarded command `npm run dev:update -- -m "Nearr 1.7 onboarding build 72 founder QA" --platform ios --non-interactive` successfully published an **iOS-only Development update**:

- [Update dashboard / preview](https://expo.dev/accounts/andrewmahran/projects/nearr/updates/9b1887fc-7ba8-4a08-8893-e0c67420f3b7).
- Group `9b1887fc-7ba8-4a08-8893-e0c67420f3b7`; iOS update `01a17eaa-1a89-700c-a350-7f5542e5bab9`.
- Published 2026-10-27 18:40:39 UTC; branch/channel/environment Development; runtime `1.7-onboarding-date-v1`.
- Update source checkpoint `edb6cac9edd523b8b715797db73c12c8a4796225`. Application/native files are byte-identical in Git to native build source `4346840`; only QA tools/evidence differ.
- EAS displayed a dirty marker because the manifest-verification helper was created while export was running. That untracked QA script was the only change; no runtime/application source changed. It is committed with the final evidence.
- `node scripts/verifyOnboardingDevelopmentUpdate.mjs 01a17eaa-1a89-700c-a350-7f5542e5bab9` fetched the **actually served manifest** with iOS + exact runtime + Development channel headers. It confirmed the exact update ID, Development app/backend, Nearr-Dev host, launch asset and 42 bundled assets. See `served-update-verification.json`.

Open this update through the Development client's update browser/preview after installing build 72, or use the Metro fallback in the founder checklist. A hosted compatible update removes the local-server requirement; physical launch is still untested here.

The update uses the final application source; qualification-only commits after native source do not alter app/native/config/dependency files. Older runtime 1.7.0 and 1.6.59 clients are not targeted. No Production update or Store submission occurred.

## Superseded intermediate candidates

Build 70 (`b9999bdf-a1bc-4b96-bec4-912375379f61`, source `fcf2c78`) completed and was inspected. Build 71 (`6afca96b-3902-48b5-82ff-e19a2d72b36e`, source `5539bc3`) was dispatched during localization QA. They are not the final handoff. Build 72 includes the final corrected tutorial/account copy and should be installed for founder QA.

Installation is ad-hoc/internal, not App Store distribution. The same bundle ID replaces the installed Nearr app rather than installing side by side. See [Expo internal distribution](https://docs.expo.dev/build/internal-distribution/) and the founder checklist before replacing an installation with unsynced data.

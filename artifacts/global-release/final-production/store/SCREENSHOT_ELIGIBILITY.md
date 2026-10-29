# Screenshot eligibility for the authorized 1.7 draft

Audited 2026-10-28; source `d924c25e27a8ab8d3a834fefd4e97d762d32c188`. Read-only asset inspection; no screenshot modifications, browser actions, uploads, submission or release changes.

**Eligible existing iOS screenshot paths: none established.** Save authorized text drafts independently; do not upload Android captures or the old reconstructed package as current iOS 1.7 screenshots.

## Inventory and exclusions

The final worktree contains 454 tracked PNGs. PNG IHDR inspection found 347 at 1080×2400, 11 at 750×1334, eight at 900×1600, plus icon studies, comparison sheets and source images. None matches the current Dynamic Island medium/large or large Face ID screenshot dimensions. The seven tracked JPEGs are onboarding photo/post source assets, not screenshots of the app in use. This is a scoped repository/prior-report audit, not a claim that no iPhone screenshot exists anywhere on the founder's computer.

| Existing evidence | Eligibility decision |
| --- | --- |
| `artifacts/global-release/android-qualification/screenshots/` — 141 actual captures, including ten-locale map/detail/saved/settings/Plus sets | Android ADB provenance; 1080×2400 or altered Android test dimensions. `locale-map-en-US.png` visually inspected and shows Android status/navigation. Not iOS captures. Plus and recognition-fixture views additionally conflict with currently disabled launch features. |
| `artifacts/global-release/final-production/android/` — five standalone follow-up PNGs | Android API 36 Development build at baseline `3dbf102`, not the later free-only candidate or iOS. QA/error/notification states, not a localized iOS marketing set. |
| `artifacts/global-release/onboarding-integration/screenshots/`, `artifacts/onboarding-birthday-language/screenshots/`, `artifacts/global-release/android-emulator/` | Android onboarding/QA evidence; no current iOS provenance. Onboarding alone would also not demonstrate the principal app-in-use experience. |
| `artifacts/fieldnotes-implementation/small-device/android-*.png` | Ten files happen to be 750×1334, an accepted older iPhone size, but sidecars explicitly identify Pixel 8a ADB captures with `iosEvidence: false`. They have RGBA PNG color type 6. Correct dimensions alone do not qualify them. An eleventh 750×1334 file is explicitly a rejected diagnostic capture. |
| Older Fieldnotes captures, comparison sheets, icon studies and IPA-extracted icons | Android, layout comparisons, simulated artwork or icons; not current localized iOS app screenshots. The October 18 physical-UI QA README expressly says no native screenshots were captured. |
| Prior corrected 1.5 package | `LOCALIZED_SCREENSHOT_FIDELITY.md` records 126 reconstructed PNGs at 1206×2622 / 1320×2868 and explicitly excludes them from the unified release. Source is old `ca08c154…`; not native captures. Its linked `aso/preserved-screenshot-audit.json` is absent in this checkout. The cited `C:/Users/andre/Desktop/Nearr-worktrees/nearr-1.5-privacy-corrected` and `nearr-1.5-app-store-international` directories are absent now. No recovered asset is approved by this audit. |

## Current Apple requirements and remaining asset gap

Apple's live specification now labels the required iPhone class **Dynamic Island (medium display)**: 1179×2556 or 1206×2622 portrait. Large Dynamic Island accepts 1260×2736, 1290×2796 or 1320×2868. Confirm the actual ASC slot/scaling behavior at upload rather than relying on historical 6.9-inch labels. JPEG/PNG screenshots must not include alpha/transparency. iPad 13-inch screenshots apply if the app supports iPad; current `app.json` has `supportsTablet: false`. [Apple screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)

Apple permits tasteful overlays, but the majority of each device's set must show the actual current app in use; Android status-bar/platform imagery and misleading feature claims are not repaired merely by resizing or adding an iPhone frame. Rights to screenshots' content must also be established. [Apple screenshot guidance](https://developer.apple.com/help/app-review/guideline-reference/2-3-3-screenshots/), [App Review Guidelines 2.3.9–2.3.10](https://developer.apple.com/app-store/review/guidelines/)

Needed: actual current iOS captures for the ten intended interface locales, with build/runtime/source, device/iOS, locale, appearance, feature-state and content-rights provenance. Prioritize truthful map, manually saved places/details, notes and preferences. Do not advertise disabled recognition, successful AI results, paid Plus, or an unactivated free-find allowance. Preserve raw captures beside any future composition; native-language review remains unverified. No new capture or composition was authorized/performed by this audit.

## Metadata draft safety

`metadata-candidates.json` has ten records and an existing passing field-length/UTF-8 validation receipt. The base descriptions explicitly disclose unavailable video recognition and omit Plus/pricing claims. Those base fields are suitable for the separately authorized **unsubmitted preview draft**, not evidence that the app is release-ready or that a manual-only product has been approved for launch.

Never upload `pendingQualifiedRecognitionCopy`: it describes recognition, a three-find allowance and guardian authorization that are not yet qualified/active. Keep legal-publication, supported-market, translation and final-iOS-build caveats intact. The internal phrase “This draft” is not polished final consumer wording. This audit does not authorize changes to App Privacy, agreements, release mode, build selection or submission.

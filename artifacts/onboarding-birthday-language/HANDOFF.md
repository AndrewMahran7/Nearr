# PASTE BACK TO CHATGPT

## A. Status

Implemented the two separate Fieldnotes onboarding screens in an isolated Development branch. Android native build installed on the existing Pixel 8a / Android 16 emulator. Physical iPhone validation and a new iOS native build remain outstanding. This is not a public launch or Production release.

## B. Verified baseline

Started from `integration/nearr-global-fieldnotes-monetization` at `6e4096a34bb4a09b66227474659d753670d3764f`, newer than the supplied `001eea5`. The integration checkout was clean; its remote HEAD was rechecked. The primary dirty checkout and other worktrees were preserved.

Feature worktree: `C:\Users\andre\.codex\worktrees\nearr-onboarding-birthday-language\Nearr`.

## C. Birthday

Warm cream background, spacious heading, orange calendar accent, native date selector, compact residence selector, and a safe-area bottom Continue. No age chips or country grid. Details/support/privacy links are available under “About this check.”

The field begins empty. Native Android Done on the untouched seed does not create a birthday. Cancel preserves the previous choice. Future/impossible dates are rejected, leap years use calendar arithmetic, and February 29 ages conservatively on March 1 in non-leap years. Dates never pass through UTC conversion for age calculation. Retry retains input in screen memory; successful submission, restriction, identity change, or restart discards it.

## D. Language

Ten native-name language rows with a clear selected indicator, device-language fallback, immediate bundled translation, and persisted preference. No network needed for switching. German and Japanese were actually rendered; unsupported/RTL fallback and preference restoration are covered by automated tests. Existing Settings language selection remains in place. Translations still warrant native-speaker editorial review.

## E. Exact order

New installation: **Language → Birthday/residence → existing Welcome/offline practice → remaining account/consent steps**. A saved language preference skips the language screen. This differs from the preferred welcome-first sequence: the existing pre-account eligibility wrapper was retained so mounting onboarding hooks cannot create an identity or process restricted content before screening. The founder's required two separate screens are present.

## F. Eligibility and minimization

Only `{ageBand, countryCode}` is persisted or sent to the existing declaration RPC. DOB stays in React state; no DOB schema, analytics event, log, crash context, provider payload, or route parameter was added. Residence is explicitly selected, never inferred from language. Existing 13+ and higher regional thresholds remain unchanged. Unknown residence remains unsupported/fail-closed.

The UI explicitly describes self-declaration, not independent verification. Server policy, locked restricted decisions, separate legal/AI-sharing permission, worker gates, and Share Extension authorization remain authoritative. A local declaration cannot set `aiAllowed`. There is no parental-consent shortcut or retry-birthday control in the restricted screen.

## G. Existing accounts

Existing server-eligible accounts bypass birthday. Missing eligibility still requires the server declaration. Pre-account answers are reused only for the newly created anonymous identity explicitly bound to that local journey; a different/permanent account cannot inherit them. Existing account-transfer eligibility rules are unchanged. An account-keyed gate clears former-user input. Restricted local answers survive restart, and existing permanent sessions retain server-controlled saved-data/account-rights access.

## H. Navigation/auth

Automated Google integration, auth/deep-link/recovery, restored-session, anonymous onboarding, account transition, Create your map navigation/runtime, route-loop, offline onboarding, consent identity, and Share Extension tests passed. Back navigation and language→birthday transitions were exercised on Android. No live Google/Apple login or personal account creation was performed for these screenshots; physical Apple sign-in remains a device QA item.

## I. Visual evidence

Screenshots are direct emulator captures, not mockups. Main-app captures include:

- `screenshots/01-before.png`: old crowded page (with the existing Development connection warning).
- `screenshots/04-language-ready.png`: English language screen.
- `screenshots/05-birthday-light.png`: empty birthday screen.
- `screenshots/07-native-date-open.png`: native Android wheel dialog.
- `screenshots/09-native-year-selected.png`: native year editing / keyboard.
- `screenshots/11-residence-sheet.png`: compact selector opened into a readable list.
- `screenshots/12-birthday-ready.png`: explicit synthetic date and residence, enabled CTA.
- `screenshots/14-language-german.png` and `15-birthday-german.png`: instant localization and retained in-memory input after back navigation.
- `screenshots/21-small-large-font-current.png` and `22-small-large-font-fields.png`: 360×640 logical viewport, 160% text, corrected German wrapping and scrollable fields with fixed CTA.
- `screenshots/24-japanese-offline-language.png` and `26-japanese-offline-stable.png`: actual main app with emulator Wi-Fi and mobile data disabled. Local Metro remains reachable through ADB; this proves offline language/UI operation, not cold-start independence from Metro in a debug client.

Additional fixture screenshots are explicitly labeled `fixture`: the real UI mounted with local state callbacks, without auth or server writes. They validate appearance and failure presentation, not live backend outages. Temporary fixture registration is removed from `index.js` after QA.

- `31-fixture-dark-birthday.png` / `32-fixture-dark-language.png`: dark appearance.
- `33-fixture-service-delayed.png` / `34-fixture-restricted.png`: truthful service error and restricted outcome, with support/data access.
- `35-fixture-native-picker.png`: Android's system-themed date dialog over the dark app (the device was in light mode).
- `36-fixture-empty-after-native-done.png`: untouched native seed cannot populate the empty birthday.
- `39-fixture-retry-retains-input.png`: failed local callback preserves synthetic date/residence and displays readable retry messaging.
- `40-final-main-app.png`: normal app entry restored and successfully relaunched after fixture removal, with the persisted English preference and an empty birthday. Final Metro bundle returned HTTP 200; startup confirmed Development backend and no authenticated session.

The emulator was restored to its original 1080×2400 resolution, density 420, 100% font scale, light appearance and enabled Wi-Fi/mobile data. Non-selected intermediate captures (loading, animations and pre-refinement screenshots) are excluded from the committed evidence.

## J. Tests

`node scripts/validateBirthdayOnboarding.mjs`: **144/144 passed**. This executes every distinct command from `pretest:prebuild`, `test:prebuild`, and `test:safe-development`, plus the focused birthday, localization, consent, actual database, auth/account-transition, and Create your map suites. Full command names, exit codes, and timing are in `validation/results.json`; local detailed logs are in the same directory.

`test:global-eligibility-db`: **12 actual PostgreSQL security/eligibility suites**, including 60 region/age combinations, using disposable local databases and real migrations. No live cloud database mutations. See `eligibility-database-tests.json`.

`test:birthday-onboarding` uses pure calendar tests plus real React component/hook rendering with mocked native/server boundaries: empty/default guard, cancel/select, retry retention, back, restart, restricted persistence, minimized RPC, existing-account bypass prevention, and no redundant owned-anonymous prompt. Native rendering is separately evidenced above. No tests were weakened.

## K. Native build / OTA

Added Expo 51's compatible `@react-native-community/datetimepicker@8.0.1`; no suitable existing date control was present. Therefore no OTA was published to the old runtime.

New Development runtime: `1.7-onboarding-date-v1`. Local Android x86_64 debug build succeeded and was installed in place. See `android-build.json` for timestamp, APK path and SHA-256. This is a Development client that loads current JS from Metro, not a standalone release APK. No EAS build ID or OTA ID exists for this task.

Reproduction: load the Development `.env.local`, run Expo Android prebuild, set the existing Android SDK/JBR paths, then `node scripts/buildBirthdayAndroid.cjs`. On this Windows machine the generated, ignored Gradle files needed `java.io.tmpdir` and `org.sqlite.tmpdir` pointed at `android/.gradle-java-tmp` for both Gradle JVM and Kapt process arguments. Do not set these through broad `JAVA_TOOL_OPTIONS`: prefab misinterprets the JVM banner. No system Java/Android installation was changed.

iOS Development build number 70 and the distinct runtime are configured, but no iOS build was produced or submitted. Build 69/old runtime cannot receive this picker through OTA.

## L. Git

Branch: `feat/nearr-17-onboarding-birthday-language`. Implementation checkpoint: `acfc464`. Responsive/native QA and 144-suite evidence: `9ae72e9`. The final restoration screenshot/documentation commit follows those on the same pushed branch. Integration and the primary checkout remain untouched. See the final chat handoff for the final commit SHA and verified clean state.

## M. Production unchanged

No Production deployment, App Store submission, shared Development OTA, policy publication, recognition-provider change, or payment configuration change. Existing legal/provider qualification blockers remain; this UI work does not qualify or enable recognition/purchases.

## N. Founder physical-iPhone QA

1. Produce/install a fresh Development iOS build from this branch (build 70, runtime `1.7-onboarding-date-v1`), not an OTA over build 69. Use the existing Development signing/profile workflow.
2. Test an empty birthday, wheel selection/cancel/Done, leap day, future-date clamp, small iPhone, largest text, dark appearance, VoiceOver and bottom safe areas.
3. Confirm language changes immediately, persists after relaunch/login, and stays changeable in Settings; inspect German and CJK.
4. With a designated Development test identity, verify one age prompt, Google/Apple continuation, Create your map, restored eligible-account bypass, account switch, interrupted onboarding, and Share Extension authorization.
5. Use dedicated synthetic test identities for underage/higher-threshold/unsupported-region cases; do not lock a personal account with synthetic declarations. Restricted users should see support/data access, never fake parental consent or a birthday retry loop.
6. Test network loss and retry; no input should disappear on a transient declaration error. Confirm date never appears in persistent storage or outgoing payloads.

Physical iOS rendering and real-device OAuth were not available in this Windows session. Do not treat Android screenshots or mocked auth tests as that approval.

# Founder iPhone QA — Development only

Physical execution is OPEN. Do not interpret build/IPA inspection as a completed device test.

## Install the new native client

1. On the registered founder iPhone, open [Nearr Development build 72](https://expo.dev/accounts/andrewmahran/projects/nearr/builds/3d96cf71-c507-449e-af77-3bfd7fd57f38) in Safari and choose Install. It is an internal ad-hoc build, not TestFlight or the App Store. The existing profile contains one iPhone (identifier ending A01E). A different phone requires registration and a new signed build.
2. This build uses **com.nearr.ios**, the same bundle identifier as the installed Nearr app. It replaces that installation; it is not a side-by-side Development app. Do not delete the app or sign out of an anonymous map with unsynced data just to force onboarding. Use designated test identities and ensure saved data is recoverable first.
3. If iOS requests it, enable Developer Mode in Settings → Privacy & Security, restart and confirm. See [Expo physical-device setup](https://docs.expo.dev/get-started/set-up-your-environment/?device=physical&mode=development-build&platform=ios). Do not share Apple passwords or verification codes in chat.
4. Confirm version **1.7.0 (72)** and runtime **1.7-onboarding-date-v1**. Build 69 cannot run the new native picker. Builds 70 and 71 are superseded intermediate candidates.
5. This is a Development client: the host has no embedded production-style JS bundle. Use the exact compatible Development update identified in `ONBOARDING_IOS_BUILD_VERIFICATION.md`, or connect to Metro from this integration worktree. Do not open an older 1.7.0/1.6.59 update.
6. Confirm Settings build information shows **app=development, backend=development, Nearr-Dev**. If it does not, stop testing and report the displayed values; do not submit data.

For local Metro, run in `C:\Users\andre\.codex\worktrees\nearr-onboarding-ios-integration\Nearr`:

```powershell
$env:EXPO_PUBLIC_APP_ENV='development'
$env:EXPO_PUBLIC_BACKEND_ENV='development'
$env:DOTENV_CONFIG_PATH='.env.local'
node -r dotenv/config node_modules/expo/bin/cli start --dev-client --lan
```

Use the ignored, verified Development `.env.local` already present; do not copy credentials into chat. Put phone and computer on the same trusted Wi-Fi, allow Local Network permission, and open the displayed development-server QR/link in the installed Nearr client. Keep the server running. Test offline only after the bundle/assets have loaded. A compatible hosted Development update avoids the local-server requirement; its receipt must still match the runtime above.

## Test path

- Language: clean designated test state → device-language default → choose another language → immediate text update → restart → preference preserved. Check later choices, account headings, errors and AI/privacy consent. All ten locales need native-language review; source captions/proper names remain unchanged.
- Birthday: initially blank; Continue disabled. Open/cancel/reopen the native wheel, deliberately choose a date, then residence. Verify no untouched seed is submitted. Change country before submitting. Check future-date prevention and leap-day handling.
- Boundaries: use separate designated test identities for exactly 13 and just below 13 in the US; repeat around the configured higher threshold for another country. Use synthetic dates only. A restricted answer must stay restricted across restart; do not change a real account's birthday to evade it. Self-declaration is not independent verification.
- Layout: small iPhone, large Dynamic Type, Light/Dark, status bar and home indicator. Scroll to country/details; Continue must remain reachable. Native wheel controls must not be obscured by keyboard or safe areas.
- Flow: Language → Birthday/residence → Welcome → complete the offline practice → account/consent → map without a Create-your-map loop. Interrupt/restart during onboarding and during account transfer. Complete/defer Phase 2 without replaying completed stages.
- Accounts: Google and Apple sign-in, sign-out/sign-in, existing eligible account (no redundant birthday), missing eligibility, restricted account, account switch and anonymous-to-permanent transfer. Verify saved places stay with the correct owner. Reinstall only on a disposable test setup after confirming data recovery.
- Share Extension: open native share sheet from a harmless link, confirm Nearr presentation/localization and handoff, dismiss/reopen and verify no duplicate submission. Do not authorize or trigger unqualified provider processing. Disabled/restricted recognition must be truthful; no Plus storefront should silently activate.

Record phone/iOS version, native build, runtime/update ID, locale, test identity label (not credentials), pass/fail, screenshots and exact reproduction steps. Do not mark physical QA complete until these checks are actually performed.

# Final Android standalone stability qualification

## Scope and source binding

Focused follow-up to the retained notification-broadcast ANR, not a repetition of the original 30-entrypoint/141-capture qualification. The standalone binary uses the clean, exact `3dbf10278368c2074afa095627b71be21f24aaa3` source in the prior Android qualification worktree. Later final-release Plus/entitlement edits are outside this binary's scope and require their own tests. No tracked product source in the prior worktree was edited.

Build: local `assembleRelease` targeting the x86_64 emulator, debug signing certificate, production-mode embedded JavaScript, Development app/backend declarations, Nearr-Dev `qnfxnmvxpjzfydgudtvs`, native runtime `1.7-onboarding-date-android-v2`. Prebuilt dependencies also package other ABIs. This is a non-debuggable release-like test artifact, not a Store-signed Production artifact. Development-only QA controls intentionally remain available. No provider, payment, Production, or deployment configuration is changed by this work.

Build completed 2026-10-28 00:25:02 UTC in 19m34s. APK SHA-256: `dcff8cece1f8ba50ec4bacc96c862d152ccc43d85b2678545acbe86cff75d226`. The installed APK was independently read back and matched this hash. Embedded JavaScript is 6,109,832 bytes, hash `dc30d9eee31bd2076f6a31ea85b022168da1c1697f4b85feb69cc0ce7928e1e3`. There was no Metro listener or ADB reverse mapping. Native resources verify Android runtime v2; the root Expo Constants runtime retains the cross-platform v1 value and is not the native Android runtime authority.

## Retained ANR: recovered distinguishing evidence

Android DropBox still contains the exact `59b34b9f-d08b-4e4b-8095-385aeb637733` event at 2026-10-27 14:27:09 local. Direct `/data/anr/` file contents are permission-denied on the Google Play image; `dumpsys dropbox --print data_app_anr` provides the retained thread dump. Raw output is local/ignored; the scoped excerpt is `retained-anr-thread-evidence.txt`.

- Main thread: waiting in `HardwareRenderer.syncAndDrawFrame` / `DrawFrameTask::drawFrame`.
- RenderThread: in the **emulator-specific** `libEGL_emulation.so` `qemu_pipe_read` → `QemuPipeStream::commitBufferAndReadFully` → `rcCreateSyncKHR_enc` → `eglSwapBuffers` path.
- The timed-out notification broadcast was scheduled at uptime 10525577. The snapshot at 10586350 shows no matching receiver `Rcv` / `GoAsync` entry: dispatch had been delayed about 60.8 seconds before the notification handler ran.
- Earlier receiver invocations in the same event's debug history finished in 21, 89, 7, and 130 ms.
- System CPU reached 90–98%, predominantly kernel time; emulator graphics composer reached 97%. The original evidence also recorded severe host memory pressure and failed crash-dump helper execution.

This supports an emulator graphics/host scheduling stall rather than an observed notification delegate deadlock. It is evidence, not a proof that every real device is ANR-free. No speculative dependency patch is justified by this trace.

DropBox additionally retained an older 11:27 Nearr event from earlier Development testing, with main thread in `HardwareRenderer.setStopped`. It is historical, not a failure introduced during this run. The current-boot preflight reports no ANR.

## Runtime checks

Result: **PASS WITH DOCUMENTED LIMITS** for this bounded Android stability follow-up, not overall public-release qualification. Device: Pixel 8a Google Play emulator, Android 16/API 36. Runtime window: 2026-10-28 00:26:16–00:42:10 UTC.

| Check | Observed result |
| --- | --- |
| Standalone launch | Wi-Fi/mobile data disabled, no Metro; embedded Language and Birthday onboarding rendered, native date picker worked. |
| Authentication and permissions | Disposable Development adult account signed in; account-bound Birthday completed; actual Android location prompt answered Only this time. Previously denied notification permission enabled through Android App Info. Fine/coarse/background location subsequently granted by ADB as explicit test-fixture setup, not claimed as user-prompt coverage. |
| Local notification under CPU/memory contention | Actual app Send test notification control used; system notification readback and inspected screenshot show Nearr test reminder. Foreground Settings restored during load. |
| Bounded pressure | 45 seconds, two host workers at 60% duty each, 128 MiB total allocation. Host free memory 4,229 MiB initially, minimum 3,409 MiB. Both workers exited 0; unrelated heavy tests held during this window. |
| Android memory trim | `RUNNING_CRITICAL` accepted. `COMPLETE` rejected because app retained foreground importance; recorded as a tool/OS constraint, not a passed trim case or app defect. |
| Termination / cold launch | Three recorded force-stop/relaunch cycles restored authenticated Map; separate offline and recovery cold launches also completed. Android launch TotalTime 4,268 / 4,011 / 2,711 ms; UI-idle observation is slower and not a production performance benchmark. |
| Rapid lifecycle | Four consecutive HOME/foreground cycles completed. A 15-second UI-idle check expired; the next fresh dump confirmed Map and no ANR. This does not establish a 15-second responsiveness bound. |
| Configuration restoration | Four font/display changes accepted. A rapid font reset raced with Android configuration handling, leaving 1.3 until explicitly restored and read back as 1.0. App rendered the offline and saved-data surfaces at enlarged font. Not a full responsive-layout audit. |
| Offline / recovery | Cold launch without Wi-Fi/data showed the expected fail-closed eligibility retry surface. View my saved data opened the authenticated empty saved/map surface. Reconnecting and relaunching recovered Map. No saved-place contents were fabricated for this test. |
| Notification tap route | Tap executed, but the combined observation helper hit its 60-second tool deadline and reset. Later Map observation followed intervening cold launches; exact tap destination is therefore **inconclusive**, not claimed as passed. Delivery is independently verified above. |
| Crash / ANR | No ANR since boot, including snapshots before/after pressure and at end. 39,308 time-filtered log lines reviewed across all nine observed Nearr process IDs: zero fatal/ANR lines. One `Network request failed` JavaScript error occurred during deliberate offline mode and is retained. Other Android/emulator warnings are not suppressed or claimed absent. |

The pressure phase ran without competing test workloads. Later functional lifecycle timings may include the other agents' resumed regression tests. The recovered graphics-pipe trace, successful standalone notification delivery under bounded pressure, and absence of a new ANR support proceeding past this **specific emulator anomaly**; they do not remove the independent provider/Production/iOS release gates. No app-owned stability change was justified or made.

## Evidence and cleanup

- `final-receipt.json`: compact overall outcome and source boundary.
- `standalone-build.json`, `apk-inspection.json`, `installed-apk.json`: exact build, embedded bundle, native runtime, installed hash.
- `retained-anr-triage.json`, `retained-anr-thread-evidence.txt`: historical ANR differentiation.
- `pressure-results.json`, `before-pressure.json`, `after-pressure.json`, `final-runtime.json`: pressure steps, memory, process/thread observations and ANR state.
- `lifecycle-results.json`, `logcat-review.json`: exact counts, observation limits and classified errors.
- Five actual emulator PNG captures: offline standalone onboarding, delivered notification, offline retry, saved-data route and recovered Map. Notification/offline/recovered-Map captures were visually inspected.
- Raw Gradle, full historical DropBox and filtered runtime logs remain local/ignored; they are not committed because they may contain unrelated device context. Scoped retained trace and sanitized log review are the shareable evidence.

Cleanup completed 2026-10-28 00:42 UTC (`qa-cleanup.json`). Only this run's exact disposable Development identity was deleted; auth readback confirms absence and owned saved-place count is zero. Test-owned `com.nearr.app` data cleared successfully, app stopped, Wi-Fi/mobile data enabled, display restored to physical 1080×2400 / density 420 / font scale 1.0. Pressure workers and the build's Java processes exited. No Production data, shared places, or other worktree tracked files were modified.

## Known boundaries

This emulator uses Android 16/API 36 and x86_64 graphics emulation. Bounded CPU contention and OS memory-trim delivery do not simulate every physical-device thermal/OOM condition. Local notification delivery does not certify remote push delivery or iOS notifications. This work does not establish provider/legal qualification, Production compatibility, or physical iPhone behavior.

# Android emulator qualification

Development only; 2026-10-27. Source baseline `c3317f01fa5205ae9bfa6702e11780ba113e4efe`; final product changes through `4c424d9`. Real ADB interactions and unmodified screenshots, not rendered mockups. The Pixel 8a/API 36 emulator used a Development client and localhost Metro. This is not physical iPhone or standalone production performance certification.

## Observed runtime coverage

| Area | Actual result/evidence |
| --- | --- |
| Fresh onboarding | Separate Language then Birthday; device default English; blank declaration disables Continue; native spinner picker and Cancel; country selector; Back returns to Language. Screens 03–09. |
| Eligibility | Underage 2015 US declaration blocked offline and survived restart. Adult 2000 US declaration accepted. Native future-year edit was bounded by the picker (entered 2099 became 1900), not an observed custom error. Future-date rejection additionally covered automatically. |
| Offline | Ten language selections and birthday relaunches; complete local social-share walkthrough; bundled media; no provider call required. Optional real practice skipped. Screen 18 correctly says practice map, not a real saved row. |
| Authentication | Test-owned confirmed Development identity created with established QA admin tooling, then signed in through real email/password UI. Account-bound declaration requested once; eligible/18_plus/US read back. AI permission/legal approval remained false. No account creation loop. Signup email delivery was not tested. |
| Map/Saved | Map, dock, Show All Pins, selection, compact/full detail, More, Activity and return; real manual searches for Golden Gate Bridge and Eiffel Tower; persisted owned rows read back. Dorset Quarry is explicitly a local tutorial fixture, not database proof. |
| Persistence | Golden Gate saved row retained visited timestamp and reminders off across repeated cold starts. Second manual Eiffel save confirmed initial reminders off. Logout/relogin result recorded in final runtime receipt. |
| Gallery | Local Dorset two-photo gallery opened; actual swipe reached accessible photo 2 of 2 (46). Real Google place hero photos also displayed. |
| Filters | Food & drink with zero matches displayed category-specific empty message; dock remained; Show all places removed the stale message. Pan and double-tap zoom exercised, then Show All Pins. |
| Appearance | Dark theme selected through Settings; ten native locales exercised. Default and 900x1600/375dpi/160% font checked. |
| Quick Check | Three test-owned terminal fixtures only: needs_help, failed, cancelled. Real candidate selection attached the test post to existing Golden Gate save; job completed, one provenance row, still two real saves. Completed reopen routed to saved detail. Cancelled showed no actionable candidate. Offline and online restricted retries remained failed; zero media tasks. Screens 35–43. |
| Plus | Ten native localized disabled paywalls, disabled Restore; no purchases. Offline navigation was intercepted by truthful eligibility-service failure; View my saved data returned to map. Dedicated actual component/client tests cover offline Plus and zero purchase SDK loads. |

## Boundaries

No live recognition success claimed. No queued/processing fixtures inserted; no flags, policies, workers or payment products enabled. The secondary source-enrichment warning `global_eligibility_required` was non-fatal; manual resolution and persisted provenance were independently read back. Online retry verified that the existing database eligibility trigger refused dispatch.

Quick Check loading was observed as native refreshing/loading during fetch/save; backend processing UI branches are additionally automated, not a live worker run. No synthetic fixture is represented as recognition output. No native-speaker certification or physical iPhone pass.

## Runtime qualification caveat

The original Expo AV native reload crash was reproduced and patched (see NATIVE_AV_RELOAD_FIX.md). A separate ANR occurred during rapid display configuration changes while automated tests ran and host free RAM fell below 700 MB. Its exact notification-broadcast reason and system CPU pressure are preserved in `configuration-change-anr-redacted.txt`, screenshot 52. See final runtime receipt for isolated reproduction attempts; do not erase this observation or claim an unconditional zero-ANR session.

Screenshots 02 and 10 are not acceptance evidence: 02 still had the development menu; 10 preceded the screen resize taking effect. Screens 11–13 and 47–51 are the actual narrow/large-text captures.

## Final recovery checks

Rotating the disposable password invalidated the emulator session and exposed a real completed-checkpoint routing defect: public PreAuth could not render onboarding_complete and timed out to ERROR_RECOVERY. Both entry and ongoing guards now route that signed-out state to the account gateway. Regression failed before; routing/account-transition/auth-map tests passed after. Screens 54–56 and `auth-persistence.json` show native recovery. Explicit Settings logout, confirmation, password UI relogin and direct return to the map also passed (57–58); two real saves persisted and Birthday did not repeat.

Six isolated font/size/density changes recovered the map with no repeated ANR. A later Development reload exposed a pinned splash-screen error handler calling catch on an undefined native return. The JS/TS dependency guard handles void/synchronous/rejected returns while forwarding the original fatal error; five native-boundary tests pass. The final native retry and three consecutive cold starts passed with zero relevant error lines (`final-runtime.json`, screen 61). Earlier errors remain retained, not relabeled as passes.

`qa-cleanup.json`: test identity deleted, zero remaining owned saved rows, no cleanup errors. Three fixture jobs and owned provenance cascade with that identity. Shared canonical place records were not deleted. Test credentials were memory-only and never committed.

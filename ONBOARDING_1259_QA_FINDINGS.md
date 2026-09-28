# Onboarding 12:59 QA findings

Status: IMPLEMENTED / AUTOMATED VALIDATION PASSED / AWAITING PHYSICAL QA.

The recording itself was unavailable. This reconstruction uses the supplied timestamped observations, bounded Development analytics/database records, Railway logs, and source traces. Identifiers below are deliberately pseudonymous.

| Recorded observation | Confirmed cause or remaining hypothesis | Repair | Regression evidence |
|---|---|---|---|
| Welcome copy clipped | Fixed footer competed with short-screen scroll content | Footer cannot shrink; scroll content reserves footer space | `test:onboarding-1259-regressions` 27 plus physical large-text case |
| Shops showed Hydra | `shopping` was explicitly aliased to `travel` | Versioned shopping fixture with Old Towne Orange shop imagery/result/copy | tests 14–20; offline suite |
| Black/letterboxed local video | Video appeared before first render; source composition was landscape | Bundled poster stays visible until `onReadyForDisplay`; new vertical shopping loop | tests 19–20 |
| Two actions to launch practice | Phase 2 entered `practice_ready`, then map coachmark asked again | First tap prepares anonymous auth, records the starter, opens the exact post, then enters waiting | tests 21–22 |
| Generic queued row then review | The real job followed the ordinary durable recognition path; it was not a precomputed result | Waiting surface keeps a safe local source preview and actual backend status; Review is preserved | hardening tests 21–26 |
| Completion → blank map → same completion | Save screen imperatively navigated to map while onboarding state/AuthGate also owned the phase route | Save completion is persisted first; onboarding state machine is the sole route owner and imperative map navigation is suppressed | tests 10–13 |
| Completion mentioned tutorial | Payoff component was hard-coded to tutorial copy | Payoff reads the durable real saved ID/name and primary source thumbnail | test 26 |
| Settings blank spinner | Whole screen returned early while profile loaded | Static shell and Appearance render immediately; account status loads inline | test 28 |
| Two Google choosers | Anonymous `linkIdentity` callback was followed unconditionally by a second full `signInWithOAuth` when no permanent user was observed | One `signInWithOAuth`, one browser session, one callback owner, no automatic fallback chooser | tests 1–9 |
| Truncated `missing_auth_p…` | A second callback delivery without usable auth parameters reached the callback parser while browser return handling was active | Browser-owned callbacks are ignored by root/route consumers; provider errors are classified explicitly | auth deep-link suite |
| Create your map flash | Root AuthGate could route while the initiating screen was still resolving account/transfer destination | Post-auth latch now covers the full provider round trip and retains a retry latch on transfer failure | auth transaction tests 4–6 |
| Count 1 → 11 | Anonymous/local state was replaced as the authenticated account’s destination dataset arrived; no deletion evidence | Existing per-user cache ownership guard retained; settings/map must not label partial loading as final | physical scenario B remains required |
| Mad Yolks alert after auth | Development event was a local foreground proximity notification for a real saved place owned by the destination account, not a synthetic tutorial row or remote push. It was triggered by the one-shot check invoked on sign-in; persisted event lacked user-coordinate evidence | Authentication now synchronizes watchers/geofences but does not itself run `checkProximityOnce`; a genuine later foreground transition still may | tests 29 and 31; physical location proof remains required |

## Reconstructed Development session

| Milestone | UTC | Pseudonymous evidence |
|---|---:|---|
| Onboarding began | 19:59:47.690 | install session `c75bc0e27d` |
| Shops selected | 19:59:50 | selected category `shopping` |
| Wrong travel fixture selected | 19:59:51 | `instagram-travel-v1` / Hydra |
| Practice offered | 20:00:04.754 | local Phase 1 complete |
| Anonymous service session ready | 20:00:09.157 | principal `9c5d1fef33` |
| Durable share accepted | 20:00:19.780 | job `608a6e5c…20b7`, request `s_6647…c23` |
| Durable save completed | 20:00:46.079 | verified 2nd Floor review/save |
| Google started/completed | 20:01:03 / 20:01:18 | destination principal `e978748db8` |
| Nearby event | 20:01:18.962 | real destination-account Mad Yolks save; local foreground trigger |

No emails, provider URLs, credentials, or transfer secrets are included.

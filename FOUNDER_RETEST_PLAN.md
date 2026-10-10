# Founder retest plan

Use the existing Nearr 1.6.59 (59) Development build. No new native binary is required.

1. Force-quit and reopen the Development app once after the new OTA is published so it applies.
2. Open the Development-only QA reset and choose **Create fresh anonymous QA user**.
3. Complete deterministic Phase 1.
4. Start Phase 2, share the practice post, and continue even if it reaches review/background processing. The shortest exact founder regression path is to defer while that job exists.
5. On **Create your map**, choose Google and complete the chooser once.
6. Expected: the transition runs once and the Fieldnotes map opens. There is no second Google chooser, recurring Create your map screen, repeated Continue action, or `account_transition_failed` LogBox.
7. Force-quit and reopen. Expected: the signed-in map opens directly and the transferred real save/job remains owned by the account.

Optional provider parity: repeat from a fresh anonymous QA user with Apple. Apple uses the same fixed completion coordinator and V2 RPC.

If a retryable setup error appears, tap **Continue** once. Record the time and provider; do not repeatedly tap. The coordinator will start only one retry generation, which makes the Development log unambiguous.


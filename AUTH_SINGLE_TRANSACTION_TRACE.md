# Google authentication: single transaction trace

## Previous failure

1. Account screen prepared an authorized transfer grant when the intent required it.
2. `startGoogleSignIn` called `linkIdentity` for an anonymous session and opened `openAuthSessionAsync`.
3. The browser return and native URL consumers could both see the callback.
4. If the immediate read did not yield a permanent user, code unconditionally invoked a second `signInWithOAuth` helper and opened a second browser/chooser.
5. The callback route and root route guard could also navigate while the initiating account screen was resolving transfer state.

This explains both the second chooser and the visible `missing_auth_params` warning. It was an application fallback/ownership defect, not expected Google behavior.

## Current contract

`Continue with Google` claims one in-memory transaction ID. A second tap fails the single-flight claim. The adapter calls `signInWithOAuth` once and opens one `openAuthSessionAsync`. That browser result is the callback-exchange owner; echoed initial/warm links and the Expo Router callback screen become inert while the transaction is active.

States are `authenticating → authenticated → transferring → completed`, with terminal `cancelled` and `failed` alternatives. The account screen owns destination navigation. The root AuthGate is latched for the entire browser and transfer interval.

If authentication succeeds but route/transfer resolution fails, the permanent session is retained, a retry latch remains active, and the account screen offers a retry. Google is not relaunched automatically.

Existing-account sign-in never requires anonymous transfer preparation. Backup/account creation retain the existing durable grant/finalization machinery, including an empty real-transfer set. Synthetic `onboarding://` saves are not sent to transfer RPCs. Provider names still use the existing non-null merge rules.

## Security and compatibility

The flow retains Supabase state/PKCE handling and the configured app redirect. It does not bypass provider consent, account selection, MFA, state, nonce, or redirect validation. Physical provider authentication remains mandatory QA; mocked tests cannot prove the real provider callback.

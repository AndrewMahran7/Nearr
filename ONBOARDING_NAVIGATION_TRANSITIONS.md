# Onboarding navigation transitions

| Event | State transition owner | Navigation owner | Duplicate behavior |
|---|---|---|---|
| Practice share observed | onboarding reconciliation reducer | none | job revision/status reconciliation is idempotent |
| Review confirmed and durable save returned | `completeOnboardingV2PracticeSave` | AuthGate/state route | same saved ID becomes unchanged |
| Save screen completion callback | state machine first | suppressed for onboarding-owned completion | once latch records suppression |
| Poll/realtime/foreground terminal observation | reconciliation reducer | none unless state actually advances | later phase cannot regress |
| Google browser return | auth transaction | initiating account screen | root/callback route ignore browser-owned callback |
| Transfer/destination resolution | post-auth resolver | initiating account screen | retry latch blocks AuthGate flash |

Development builds log a bounded transition line containing revision/transition ID, reducer source, previous/next phase, state-machine owner, navigation action, duplicate flag, and reason. Route breadcrumbs additionally record practice reconciliation and suppressed competing navigation without URLs or secrets.

Back navigation remains screen-controlled. No delay, animation suppression, or blanket exception handling is used as coordination.

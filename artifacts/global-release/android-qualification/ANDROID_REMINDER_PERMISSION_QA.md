# Reminder permission recovery

## Real emulator results

- Onboarding location permission dismissed with Android Back; continuation showed location off. Notification request denied through the OS dialog; authentication remained reachable.
- Location subsequently granted while using the app. Actual saved-place reminder off persisted as false.
- Enabling while notification permission was denied returned the bounded permission failure/Allow nearby reminders state; no indefinite Updating reminder spinner and no false persisted success. Screenshot 29.
- Test-app-only OS notification/background-location permissions granted through ADB; actual UI retry persisted true. Screenshot 30.
- Mark visited through UI persisted visited_at and turned reminders off. Repeated process restarts preserved that state.
- A newly manually saved Eiffel Tower row after the fix started `notifications_enabled=false`, independently read from Development. No database default or backend policy was changed.
- Switch remained within its slot at default and narrow 160% font. Screens 48–50 show lower controls reachable by scrolling.

## Deterministic native-boundary tests

The permission race now invokes native calls inside a thunk within the handled Promise chain. This captures synchronous native throws as well as asynchronous errors. The existing ten-second deadline remains.

24 cases cover three permission APIs × granted, denied/dismissed, asynchronous error, synchronous throw/unavailable, status timeout, request timeout, late resolve with retry, and late rejection with retry. Assertions include no unhandled rejection, stale mutation or false persistence. Before/after logs retained locally; all cases are included in the original physical runtime entrypoint.

Actual delayed native responses are covered by deterministic boundary tests, not claimed as controllable OS timing. The later notification-broadcast ANR under host resource pressure is separately disclosed in Android runtime evidence; a permission Promise timeout is not an ANR prevention mechanism.

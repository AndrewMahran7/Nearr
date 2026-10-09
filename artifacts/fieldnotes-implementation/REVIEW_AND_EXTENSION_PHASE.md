# Activity, place review and share receipt

Implemented against the approved Fieldnotes direction in the isolated 1.6 worktree. Activity/review checkpoint: `8cfa31b`. This document describes implementation evidence, not an iOS device acceptance result.

## Product changes

- Activity uses a bounded FlatList and groups Needs your check, Finding places and On your map. Editorial rows and honest indeterminate status replace nested queue cards. Existing archive/save/undo behavior remains wired to its original services.
- Quick Check leads with the place question, a destination image and available original-video evidence. Candidate alternatives stay bounded; changing the visible exclusive candidate changes the selected candidate identity. Area matches remain labelled.
- Multi-place review gives each place a separate inspection action and 44-point selection control. Source identity, selection counts and saved counts remain distinct. Clearing all choices leaves a disabled save action visible. Persistence, duplication, rejection and omission policies remain unchanged.
- Photo captions distinguish destination photography from the original video. Existing active-only hydration, visited-page rendering, image limits and no-adjacent-prefetch policy remain in force.
- Small widths and larger text stack evidence/image panes and allow critical place names to grow. Activity and review use both semantic palettes.
- The share receipt uses the chosen bundled app icon, actual shared-payload identity and only a supplied local image. It performs no thumbnail lookup. Sending asks the user to keep the sheet open until acknowledgement; accepted says Sent to Nearr and You can close this. Duplicate and uncertain network outcomes are stated separately.
- Native startup and recovery surfaces use matching dynamic colors, scalable fonts and minimum action sizes. Native failures scroll at large text sizes. Standard compact height remains 360 points; accessibility categories may request up to 600 points, bounded by the host's available height. The React body also scrolls.
- The Development-only Activity data adapter requires both `__DEV__` and Map Preview Mode. It labels fixtures, guards all actions that persist/archive/delete/cache saved rows, skips fixture photo hydration, and supplies a no-op refresh. It renders the production Activity component.

## Motion and feedback actually implemented

| Surface | Actual behavior | Reduced/interrupted behavior |
| --- | --- | --- |
| Quick Check / multi-place disclosure | Existing LayoutAnimation runs only when Reduce Motion is off. | Immediate layout change when reduced. |
| Place browse programmatic paging | Animated scroll when motion is enabled. | Nonanimated scroll when reduced; direct paging gestures remain. |
| Share receipt icon | One 220ms opacity/0.96-to-1 scale entrance and small local pulse. | Static final icon, no pulse. Live OS changes use the shared conservative preference hook. |
| Share accepted | One success feedback call after the durable result; guarded per invocation. | No replay after Close, Open Nearr, or unmount. Shared helper coalesces feedback and tolerates unsupported hardware/module availability. |
| Share failed | One optional error feedback call after a direct share attempt exhausts recovery. | No step-by-step or intermediate automatic-retry feedback. |
| Review save | One optional success call after a single save, canonical selected group, batch outcomes, or explicit one-tap correction has persisted. Batch feedback is outside the per-candidate work. | Mounted-state guard; all-failed batches emit no success. No checkbox, poll, or reopening-result haptic. |

No source-to-pin flight or native shared-element transition was added by this phase. No recognition timing is represented as a percent or fixed promise. Native feedback strength/availability remains a device check.

## Validation

- `review-tests/results.json`: 25 targeted scripts pass, covering batch persistence, omission/selection, image hydration bounds, queue gestures, source evidence and accessible controls.
- `testFieldnotesReviewComponents`: 24 actual React component renders through native host mocks across light/dark, 320/390/430/375 widths, normal/large font scales and 0/1/5 images. It inspects the real responder tree and confirms photo taps are independent of selection controls. These tests do not measure native pixels or wrapping.
- `extension-tests/results.json`: 10 scripts pass. The new receipt suite renders the actual extension root 15 times through mocked native bridges/server boundary and checks accepted/pending/duplicate/failure/auth/configuration states, terminal actions, delayed acknowledgement after Close, local-only imagery, appearance tokens and reduced-motion alternatives.
- Native compact-controller test runs the real config-plugin copy and checks generated Swift equals its authoritative source, balanced structure, bundle-only loading, transparent outer host, bounded payload timeout, App Group identity, handoff encoding, dynamic colors and scrollable scalable failure controls.
- TypeScript passes for the integrated worktree; relevant diffs pass whitespace checks.

## Explicit native acceptance gaps

This Windows phase cannot compile UIKit locally or host an iOS Share Extension. Generated Swift structure tests are not a Swift compiler. Actual Instagram/TikTok/Safari host geometry, safe-area behavior, VoiceOver, maximum Dynamic Type, haptic availability and app/extension appearance continuity must be verified in the isolated Development iOS build. No synthetic HTML or host-mock rendering is presented as a native screenshot. Root-owned Android captures can verify the actual Activity/review routes separately; they cannot establish iOS extension embedding behavior.

Recognition services, server contracts, model/cost policy and native embedded-bundle selection were not changed. Submission idempotency, fail-closed environment checks, auth bridging, recovery attempts and terminal Done/Open Nearr actions retain their original implementation.

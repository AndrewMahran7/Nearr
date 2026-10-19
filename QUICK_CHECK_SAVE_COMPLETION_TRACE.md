# Quick Check save completion trace

## Confirmed failure path

The exact frontend sequence was:

1. A `needs_help` review selected a provider candidate.
2. `persistShareJobCandidate` created or reused the exact saved-place row and legitimately attached/enriched the shared source.
3. That backend path could also advance the review job.
4. The screen then called `markShareJobResolved` as a separate required step.
5. If the job was no longer `needs_help`, that RPC returned the “Job can no longer be resolved” failure.
6. The outer catch labelled the entire action “Could not save,” kept the stale review visible, and left Save actionable even though persistence may already have succeeded.

This was a completion-boundary bug. It was not safe to treat every “no longer resolvable” response as success because the job may have been cancelled, corrected, superseded by another result, or owned by another user.

## New boundary

Every single, picker, and multi-place save now carries a `QuickCheckCompletionIntent`:

- exact review job ID
- exact saved-place ID returned by persistence
- exact Google Place ID selected by the user
- canonical source URL when a source relationship is required

The screen stores a pending completion before resolving the review. If the resolution call fails, it re-reads the RLS-scoped job and the exact saved-place row. Verification requires:

- the same saved-place ID
- the same provider identity
- the required source URL in either the legacy primary source or child source association
- an authoritative completed job that resolves to that same saved row

Results are explicit:

| Authoritative state | Exact save/source | UI result |
|---|---|---|
| completed with intended saved row | yes | Verified completion; one completion/navigation outcome |
| still `needs_help` | yes | Place is saved; retain `Finish review`, retry resolution only |
| cancelled/unavailable | any | Truthful unavailable state; no success claim |
| completed with another saved row | any | Superseded/different-result state; no success claim |
| completed but provider/source mismatch | no | Unverified result; no success claim |

## Idempotency

- `resolvingRef` continues to coalesce double taps.
- A pending completion retries only `markShareJobResolved`; it never repeats place/source persistence.
- Before a fresh save, the screen re-reads the job. A review already completed or cancelled is not persisted again.
- If the exact saved row/source already exists while the job still needs resolution, only the resolution step runs.
- Realtime, polling, foreground, and remount paths observe authoritative job state and cannot turn another result into this user's success.
- All successful modes converge on `applyVerifiedCompletion`, which owns the existing exactly-once navigation signal and onboarding completion.

## Tests

`scripts/testOct18QuickCheckCompletion.ts` executes the decision matrix for exact completion, lost response, retry-only resolution, cancelled job, different result, missing source, wrong provider, and missing job. Existing Quick Check, save-completion, rolodex, evidence, multi-place, source-media, and share-submission suites also pass.

The founder's original Development record/request ID was not available, so this report does not claim a row-level production trace. No backend or RPC contract was changed.

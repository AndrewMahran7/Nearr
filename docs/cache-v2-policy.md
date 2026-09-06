# Recognition Cache V2 policy

Policy version: `recognition-cache-v2.1`

Recognition version: `vayrin-recognition-2026-08-26.v3-generic-guard-same-place-groups`

## Read and admission policy

`RECOGNITION_CACHE_READS_ENABLED` is the only read switch. Missing, malformed,
or false values fail closed. When false, every new logical submission follows
fresh automatic recognition; this does not restore Quick Check or manual search.

An answer is reusable only when its source and every primary destination slot
are `ELIGIBLE` at the same current feedback revision, with compatible identity,
evidence, policy, and recognition versions. Admission requires a successful
terminal job, successful durable media acquisition with SHA provenance, public
provider identity, specific semantic/geographic checks, and at least `0.80`
quality. Generic, broad, alternative-only, partial, failed, or contradictory
results are ineligible. Historical cache rows receive no implicit trust.

## States

| State | Meaning | Allowed transition |
|---|---|---|
| `UNVERIFIED` | No reusable validated answer | fresh completed admission -> `ELIGIBLE` |
| `ELIGIBLE` | Exact answer set may be reused | correction -> `QUARANTINED`; version drift -> `STALE`; deletion -> `REVOKED` |
| `QUARANTINED` | Correction committed; reuse blocked | worker claim -> `REVALIDATING`; bounded failure remains quarantined |
| `REVALIDATING` | Fresh independent inference in flight | agreement -> `ELIGIBLE`; disagreement/insufficient -> `DISPUTED`; technical failure -> `QUARANTINED` |
| `DISPUTED` | Conflicting or insufficient evidence; fresh inference required | later evidence and consensus -> `ELIGIBLE` |
| `STALE` | Identity/evidence/policy/recognition version incompatible | fresh compatible admission -> `ELIGIBLE` |
| `REVOKED` | Source or answer must not be reused | no automatic revival |

Temporary provider availability is tracked in work status and diagnostics, not
as an answer.

## Corrections and revalidation

An authenticated owner correction atomically changes that owner's save, records
an immutable idempotent event, moves their one current explicit assertion,
increments feedback revision, quarantines the server-derived slot (or whole
source if ambiguous), invalidates legacy truth, and creates durable work. No
network or model call occurs in that transaction.

Fresh revalidation produces one of:

- `AGREES_WITH_REPLACEMENT`: may validate the replacement if revisions still
  match and conflict gates pass.
- `SUPPORTS_PREVIOUS` or `SUPPORTS_OTHER`: remains disputed.
- `INSUFFICIENT_EVIDENCE`: remains disputed and future submissions run fresh.
- `TECHNICAL_FAILURE`: no answer-value write; bounded retry with the affected
  source and answer returned from temporary `REVALIDATING` to `QUARANTINED`.

The model sees reusable source evidence and structured hypotheses, never user
identity, private notes, support totals, or a claim that the replacement is true.

## Independent support and conflict defaults

Only explicit filming-location confirmation and explicit correction count.
There is at most one current support per eligible account/source/slot. History is
retained, but repeated actions, passive fresh autosaves, cache autosaves, soft
alternative saves, deletes, and notifications add zero votes.

A genuine conflict can resolve only when the leading canonical exact identity:

- has at least 3 eligible explicit supporters;
- leads the runner-up by at least 2;
- has at least two-thirds of eligible explicit support;
- has fresh model agreement; and
- has no unresolved strong source contradiction.

A single non-conflicting correction plus fresh source-supported model agreement
can validate an ordinary replacement. Numerical support never overrides a hard
contradiction.

## Multi-location policy

Stable mention/source-moment IDs represent depicted destinations. Alternatives
remain hypotheses within a destination slot and are never promoted to additional
locations or votes. A known-scope correction quarantines that slot and carries
independently valid siblings to the new feedback revision. Ambiguous scope uses
`*` and blocks whole-source reuse until resolved. A partial answer set can never
finalize the whole share.

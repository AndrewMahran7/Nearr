# Recognition Cache V2 architecture

## Before

The legacy path treated `recognition_cache` rows labelled
`VERIFIED_AUTO_SAVE`, `USER_CONFIRMED`, or `CANDIDATE_SET` as reusable answers.
A source-only saved-place lookup and completed same-source job replay could also
skip current inference. User corrections were recorded per account but did not
authoritatively quarantine global machine truth. Cache persistence had no
feedback-revision compare-and-swap at the final recipient-save boundary.

The recognition engine itself already has the behavior this release preserves:
economical Gemini handling for normal cases, automatic Sol escalation for hard
cases, specificity-preserving place canonicalization, primary autosave plus soft
alternatives, stable multi-place mention IDs, source-place groups, shared source
video/AI-note context, and a suspended paid Premium path.

## After

```text
new logical share
  -> canonical platform/content identity
  -> V2 flag + exact identity/evidence/policy/recognition-version gate
     -> miss/quarantined/disputed: current fresh recognition pipeline
     -> eligible complete answer set: locked atomic recipient-save commit
          -> own saved_place + source links + source-grounded AI note
          -> notification after commit

owner correction A -> B (short database transaction)
  -> update that owner's save immediately
  -> immutable idempotent correction event
  -> move that account's one current explicit support
  -> increment feedback revision and quarantine slot/source
  -> invalidate legacy row
  -> durable deduplicated revalidation task

revalidation worker (outside transaction)
  -> current non-Premium media/evidence/recognition lane
  -> bounded structured outcome
  -> revision/policy/evidence CAS
     -> agrees with B and no conflict: eligible
     -> supports A/other/insufficient: disputed
     -> technical failure: quarantined + bounded retry
```

## Durable model

- `recognition_source_states` owns the source-wide state and feedback/evidence
  revisions.
- `recognition_cache_answers_v2` owns stable slot answers, exact canonical place
  identity, provenance, source fingerprint, and validated revision.
- `recognition_correction_events` is immutable client-visible feedback history.
- `recognition_identity_support` keeps at most one current explicit assertion per
  user/source/slot. Passive model and cache autosaves never write it.
- `recognition_revalidation_tasks` is a durable, revision-keyed outbox.
- `share_media_tasks.task_kind = recognition_revalidation` uses the existing
  non-Premium worker lane with database claims, leases, bounded attempts, and
  abandoned-claim recovery.

No legacy row is migrated into V2. V2 admission occurs only after a completed
job and completed evidence-backed media task. A source lock rechecks the entire
requested answer set at save commit, so a cache result read before a correction
cannot commit after that correction.

## Dependency and compatibility audit

| Dependency/path | V2 treatment |
|---|---|
| `recognition_cache` trust labels | Audit/write compatibility only; never read as V2 truth |
| user `recognition_rejections` | Preserved; V2 correction also changes authoritative revision/state |
| completed same-source job | New logical submissions force a new job; request idempotency/in-flight dedupe remain |
| content identity | Canonical platform/content ID plus identity version; URL variants converge |
| content fingerprint | Admission records successful SHA-backed evidence and evidence revision |
| singleflight | Coordinates fresh work only; cannot authorize a cache save |
| source-only saved-place match | Permanently disabled as recognition reuse |
| legacy process-share-link | Cannot read V2 or bypass async V2 commit gate |
| Premium/shared engine | Current engine behavior retained; Premium/token ledgers untouched |
| client query/memory caches | Contain saves/presentation, not authority; database CAS remains final gate |
| older correction callers | Historical trigger/RPC replaced and defensively recreated to quarantine V2 |
| place merges | Support and comparisons resolve to the surviving exact public place identity |
| private/unknown source | Not admitted to the public cross-user V2 cache |

No client JavaScript changed, so no OTA or native build is part of this release.

# Founder QA and integration plan

**No backend was deployed by this task. Production is unchanged.** Development had advanced beyond the audit's original function snapshot before implementation. The branch starts from the current source `45cedb7fc3e5d391e68295f60e2e097640008faa` and preserves that work. A fresh final read still shows Development process-share-jobs v142 and its September 15 worker deployment. Merge with the current integration lane and recheck identities before any Development rollout.

## First collect better truth

The recommended next step is **collect better ground truth**. Obtain 100 additional independently adjudicated, rights-cleared videos, aiming for at least 20 real multi-place posts, multilingual spoken names, brief signage, similar nearby branches, wrong-country lookalikes and known negatives. Verify exact canonical IDs, accepted aliases/granularity, all required stops, evidence timestamps and label sources without looking at winner outputs. Group reposts, creators' repeated views and same-place clips before sealing at least 50 held-out groups. Keep historical founder cases as development regressions.

Two reviewers should adjudicate disagreements before evaluation; leave uncertain cases UNVERIFIED or REGION_ONLY. Resolve the existing La Jolla granularity conflict and the five strict-alias inconclusives without silently editing the frozen baseline. Create a new version and preserve original labels and hashes. Never treat a saved item or model agreement as independent truth.

## Development integration, after that evidence is ready

Use disposable QA users and QA-owned sources. Refresh Edge versions, Railway deployments, migrations and concurrent branches. If the lane advanced, integrate those changes first. Confirm the client source/result schemas remain compatible. Apply the two forward October 8 migrations, then coordinate Edge and worker claim-payload deployment in a drained-worker window; old callbacks without an attempt/lock claim are rejected. Keep parallel media disabled and OCR/retrieval/router/Jev in their current evaluation or shadow state.

Exercise these cases and inspect database state plus user-visible outcomes:

- Mallorca/Girona, Greece/Prada, explicit source/Places contradiction, broad-region-only and same-brand wrong-branch evidence remain review when exact support is absent.
- Deep REVIEW never becomes an ordinary automatic save. Failed named-lead recovery and deterministic permanent-failure retry loops stay blocked. Valid needs-help recovery still works from server evidence.
- A real multi-stop post recovers the complete deduplicated set at the declared granularity. A partial set remains partial/review and never counts as autonomous success.
- Correct/choose a place while media and Places requests are in flight; restart a newer attempt; cancel a task; deliver an old callback and delayed storage upload. Newer state and images must remain intact, with no extra save or notification.
- A qualified ordinary single save preserves canonical metadata, category, source, existing user edits, saved-place schemas and navigation. Repeated callbacks are idempotent. Supplemental note/revalidation targets are unchanged.
- Compare serial and bounded Places query traces for query/field-mask equality and actual request counts. Confirm no sponsor/account brand is promoted into a venue query.
- Check platform subtitles, no audio, failed ASR, multilingual speech and media cleanup. Compare retained-frame hashes against legacy extraction for the same source.

For performance QA, counterbalance both arms on the same sources, report queue-to-correct-result and active critical-path durations separately, and measure real worker concurrent CPU/RSS before enabling parallel preparation. Do not sum overlapping stage spans. Capture every provider attempt, cost, retry, failure and cancellation reservation.

Rollback boundaries: switch frame extraction to `legacy`; leave parallel false; use the internal serial Places mode for an isolated diagnosis. Do not roll back the safety fences merely to recover automatic-save volume. Keep forward database guards compatible with coordinated worker/Edge rollback. No Production rollout is included in this plan.

Known limits remain explicit in `SAFETY_SEMANTIC_DIFF.md`: ordinary recognition writes receive the new transaction fences; existing supplemental completed-parent behavior and historical billing reconciliation have narrower guarantees and need separate integration coverage. A local contract test is not a live multi-client race/load proof.

# Production 18+ rollout plan — **NOT AUTHORIZED / NOT EXECUTED**

Production Supabase ref `rlqvxdwtetxsqxhqztkw`; current public client is reported as Nearr 1.4.55/build 55. The prepared 1.5.58/build 58 EAS binary predates this age work and cannot provide the new native Share Extension behavior. Production DB, Edge, Railway, OTA, website legal pages and App Store state have not been changed by this work.

## Required go/no-go preconditions

1. Founder approves the exact access disruption/cutover, revised policy and Terms, privacy answers and release approach. Provider/counsel answer resolves whether the actual 18+ assurance, audience, and distribution satisfy the applicable Gemini restriction; self-attestation alone is not labeled verification.
2. Nearr-Dev End-to-End passes adult, unknown, underage, revoked, old 1.4, new 1.5, extension, anonymous transfer, retries, queued/in-flight tasks, RLS and provider-call telemetry. Recognition result replay remains unchanged where age permits processing. App Store replacement native build is tested separately.
3. Independently establish exact Production DB/Edge/worker versions and source hashes, migration prerequisites, recent encrypted backup plus restore verification, deployment credentials/target IDs and a **trusted forward-recovery/rollback tree** for every Edge change. Do not overwrite a newer deployed function with an older release-tree snapshot. Keep the previously established Production release and one-row repair evidence; recheck only the preconditions needed for this new rollout.
4. Capture pre-cutover counts by status, owner eligibility, queued task kind, and in-flight model operations without exposing customer payloads. Decide, with founder approval, whether to temporarily pause ingress/dispatch or accept a bounded service interruption. No silent recognition disablement.

## Coordinated cutover to evaluate

Merely installing the schema first leaves pre-existing queued jobs capable of reaching an old worker; merely deploying new code first makes eligibility RPC unavailable and temporarily denies everyone. A safe sequence therefore requires a founder-approved maintenance/quiescence window and proven service controls:

1. Quiesce new ingress and claim/dispatch with the previously validated, reversible controls; wait for currently running provider calls to finish or explicitly account for them. Record queue snapshot. If these controls cannot be proven, **no-go**.
2. Take and restore-verify a fresh encrypted Production backup. Recheck migration history/project ref and apply only the reviewed additive age migration. Confirm existing accounts remain pending and saved-place/source ownership counts are unchanged.
3. Deploy exact-source-preserving age-gated worker and `process-share-jobs` to their explicit Production service/project, then `process-share-link` and `create-share-job`. Keep all provider dispatch quiesced until deployed versions, hashes, health and negative tests are confirmed. Do not change unrelated recognition models or Railway configuration.
4. Exercise authenticated unknown, underage/revoked and old-client negative cases with **zero** provider calls; exercise an adult positive path using a reviewed test account and minimal paid calls. Verify active queues, status semantics, stale tokens, transfer and saved-place access. Only then resume dispatch/ingress.
5. Publish founder-approved legal text and accurate App Privacy/age-rating metadata through their own approval gates; test replacement 1.5 native binary. Submission and manual public release are later, separate decisions.

## Monitoring and forward recovery

Monitor rates of `age_eligibility_required`, `age_check_unavailable`, 401/403/503, queued/processing/needs_help task counts, old-client versions, model-provider request counts by eligibility, save success, error budget and saved-place/source ownership invariants. Any provider call for an ineligible account is an immediate stop/incident. A database or service outage must fail closed, not fall back to old recognition. If deployment fails, preserve the DB guard and pause provider dispatch; restore the **verified** prior code only behind a containment gate that still prevents ineligible processing. Do not simply drop age triggers or roll back old Edge/worker unrestricted paths. Account data is not deleted by this rollout.

Expected user disruption: all existing unknown-age accounts will need the new 1.5 eligibility route before new AI work. The public 1.4 client cannot show it; it must deny new recognition until that same account establishes eligibility elsewhere. Existing saves remain. This compatibility/usability tradeoff needs founder approval. No forced update was configured.

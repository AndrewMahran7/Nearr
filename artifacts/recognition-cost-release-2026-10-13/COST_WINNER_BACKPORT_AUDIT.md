# Cost winner backport audit

Original candidate: integration/recognition-adaptive-gold-v1 at 5ebf0d432fe2d331d89c23021d888cf5cbe6ad2b, diffed against its parent 6cb3084d4bea4357610a028e613db41fdf99a3b7. Release base: b30906ba59ad50a2e13ea5956606deb9e1a7fba9, whose worker tree matches live Railway and whose process-share-jobs index matches live Edge v124. No research branch was merged.

| File and function | Before | Backport | Coverage |
| --- | --- | --- | --- |
| services/media-worker/src/automaticDeep/automaticDeepRecognitionProvider.ts, analyze | Healthy empty normal evidence escalated to Deep. | When the new opt-in flag is true and canReviewEmptyEvidence passes, return normal empty result with diagnostic marker before Deep. | automaticDeepRecognition.test.ts positive, invalid, partial, multi, failure and flag-off cases. |
| services/media-worker/src/automaticDeep/emptyEvidencePolicy.ts, canReviewEmptyEvidence | Absent. | Requires valid parse, no emitted/rejected/partial place, insufficient evidence, no multi intent or failure. | Same tests. |
| services/media-worker/src/config/env.ts, loadConfig/redactedConfigSummary | No policy flag. | Adds ADAPTIVE_EMPTY_EVIDENCE_REVIEW_ENABLED default false and nonsecret summary. | adaptiveParentCategory.test.ts flag-default test. |
| services/media-worker/src/providers/model.ts, AnalyzeOutput | No marker type. | Adds optional emptyEvidenceReview diagnostic only; no persisted schema change. | Worker typecheck and suite. |
| supabase/functions/process-share-jobs/adaptiveLegacyIdentity.ts, evaluate/applyLegacyParentCategoryVeto | Absent. | Veto explicit food-category evidence against nonfood parent Places types, retaining normal candidates. | adaptiveParentCategory.test.ts matrix. |
| supabase/functions/process-share-jobs/index.ts, finalizeMediaTask | planAutomaticCompletion saw original candidates. | New opt-in flag maps only vetoed legacy candidates through the existing candidate_semantic_mismatch blocker. | Helper-to-Production-planner test, Deno check. |

Production's older completion gate does not inspect upstreamSafetyDecision, unlike the original candidate branch. The first test run caught this incompatibility. The final backport uses the gate's existing candidate_semantic_mismatch reason, and the helper test now exercises the actual mapping. It does not change the shared completion planner or any threshold. The backport's behavior on the actual Production gold corpus is still unqualified.

Only the two policy changes, related types/config, and tests were ported. Candidate-specific Sol verification, physical-identity V3, KartaView, DINOv2, SigLIP 2, MegaLoc, geometric verification, OCR/ASR routers, text routers, multi-place experiments and Jev were excluded.

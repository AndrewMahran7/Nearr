# Recognition cost release handoff

A. STATUS: BLOCKED.

B. WINNER: Prepared, not deployed: valid empty evidence early REVIEW before Deep; narrow explicit food-category/nonfood-parent veto through Production's existing semantic blocker.

C. BRANCH: release/recognition-cost-winner-v1 from b30906ba59ad50a2e13ea5956606deb9e1a7fba9. Final and remote SHA are recorded in the Git remote after commit; this document cannot embed its own commit SHA.

D. DIFF: See COST_WINNER_BACKPORT_AUDIT.md. Only two policies, config/type wiring and tests.

E. MODELS: Production Gemini gemini-3.5-flash-lite; Sol source default gpt-5.6-sol with no VAYRIN_MODEL override. Unchanged.

F. DATASET REGRESSION: Historical 112 Development/34 Calibration/62 Holdout; no paired current-Production-lineage replay.

G. AUTONOMOUS OUTPUTS: Current-lineage number changed UNKNOWN. Historical held-out candidate reported none changed, not transferable to this backport.

H. SAFETY: New wrong autosaves UNKNOWN; lost correct autosaves UNKNOWN. Cannot claim zero.

I. COST: Historical reported ~9.09% reduction; current reproduced/expected percentage UNKNOWN. Flags remain off.

J. LATENCY: Historical replay values in RECOGNITION_COST_RELEASE_VALIDATION.md; current before/after p50/p90/p95 UNKNOWN.

K. TESTS: Worker full suite 654 total, 647 passed, 7 skipped; targeted policy suite 75 passed; worker typecheck/build and Deno check passed; app typecheck passed; deterministic recognition regression passed with P10 technical; frozen Edge projection 91 cases/zero differences but incomplete for this gate. 11 focused backend/app scripts passed. test:wrong-place-mutation failed on expected UI text “Use this place”; changed files do not touch that UI or test, but the required app gate is not green. Specific 1.4.55, 1.5.58 and Development 1.6 client compatibility was not established.

L. DEVELOPMENT: Old Railway 11acd95c-90f3-407e-aefa-2f1d66fc05a9; no new deployment, smoke or monitoring.

M. PRODUCTION: Old Railway 6e78ebe9-58f7-4799-a90e-86238a1b14e9 at e9daf49; no new deployment. Edge remains v124.

N. PRODUCTION SMOKE: None; no deploy.

O. MONITORING: Baseline worker health OK; no postrelease error, latency, queue or provider comparison.

P. ROLLBACK: Railway old deployment canRollback/canRedeploy. Edge v124 bundle hash recorded, but complete source recovery/proven restoration remains open.

Q. DATABASE: No schema/data migration.

R. FRONTEND: Unchanged.

S. NEARR 1.5: v124 notification code preserved in branch. Live compatibility after deployment untested.

T. R&D LIMITATIONS: Accuracy is NOT solved. Historical autonomous precision was poor; multi-place exact-set remains weak; candidate completeness is a major bottleneck; physical-identity V3 found no accuracy winner.

U. NON-ACTIONS: No Jev activation, OCR/retrieval experiment, new Deep verifier, DINO/SigLIP/MegaLoc runtime, monetization change, Production OTA, frontend deploy or App Store change.

V. NEXT STEP: Continue operating the unchanged Production backend. Resolve Development lineage and rollback, then run a paired current-source gold regression and bounded Development qualification before reconsidering a cost/safety release. Future separate identity research should focus on reference data and temporal truth.

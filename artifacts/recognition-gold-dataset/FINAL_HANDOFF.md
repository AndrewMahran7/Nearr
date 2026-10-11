# PASTE BACK TO CHATGPT

## A. STATUS

**BLOCKED BY EXTERNAL LIMIT — shared Development deployment cannot be safely attested.** A narrow cost winner is proven, implemented on an isolated Development branch and pushed. The live worker's source commit is absent from deployment metadata and the concurrent shared branch differs substantially from the tested repaired baseline. No shared overwrite occurred. This is not a claim of production readiness: overall precision, multi-place resolution and durable per-job monetary guards remain gaps.

## B. FINAL DATASET

347 inventoried sources; 208 HIGH READY: 112 Development, 34 calibration, 62 sealed holdout with 60 independent source/place components. READY includes 124 exact singles, 36 complete multis, 46 negatives and two region-only cases; overlapping slices include 95 outdoor, 68 strong scene-only, 26 misleading-metadata and 35 exact-branch cases. All 208 have description-hidden and visual-only eligibility. Platform mix: YouTube 106, Instagram 76, Facebook 13, TikTok 13. Instagram-largest and TikTok-20 aspirations remain unmet. Expected places cover 50 country labels; the United States is largest at 65 source-case appearances, followed by Italy 8, Indonesia 7, and Australia/France/Iceland/Portugal 6 each. Geography counts are nonexclusive for multi-country videos.

10,546 retained reviewed frames, 336 source timeline reviews and 886 neutral input views are verified. Strict held-out multis have transition/tail review; no continuous playback or independent human annotation is claimed. Original seal/labels/splits were not changed after inference.

## C. BASELINE

Held-out repaired baseline: 9/56 correct autonomous exact-positive resolutions (16.07%); precision 9/17 (52.94%); exact-positive coverage 17/56 (30.36%); 8/62 wrong/unverified outputs. Single exact top-1 is 17/48. Multi detection is 3/8; complete autonomous exact sets 0/8. Latency p50/p75/p90/p95 is 8.610/11.871/16.444/20.868 seconds. Tariff cost is $4.940729–$4.972729 total, or $0.548970–$0.552525 per correct autonomous result; exact primary cost remains unknown for one timeout.

## D. WINNER

Original repaired model/prompt/frame stack plus two deterministic policies: healthy empty normal evidence returns review before Deep; explicit food-venue evidence cannot authorize an exclusively nonfood parent. Partial/multi/schema/provider failures retain their existing handling. No new autosave permission is added. The common-prefix comparison freezes the same normal provider outputs for both arms before either score.

Conservative held-out cost/correct ratio is 0.909136, 95% connected-group bootstrap interval [0.825217, 0.978259], 10,000 draws. All autonomous identities are unchanged. This supports a 9.09% adverse-bound point saving, with a 2.17%–17.48% interval. It misses the suggested 10% point target slightly but passes the preregistered statistical cost gate. It does not establish population safety or a latency improvement.

## E. ROUTING TIERS

| Held-out route | Qualification | Cases | Correct/positive | Precision | Coverage | p50 / p90 | Mean tariff cost |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Normal visual + Places | No Deep escalation; includes normal failures | 41/62, 66.13% | 9/41 | 9/17 | 17/41 | 7.163 / 9.534 s | $0.072758–$0.073538 |
| Deep review | Weak named, partial or multi evidence | 15/62, 24.19% | 0/15 | n/a, no autosaves | 0/15 | 16.407 / 21.965 s | $0.096632 |
| Empty review | Valid empty normal parse, no partial/multi intent | 6/62, 9.68% | n/a, zero exact positives | n/a | n/a | 10.747 / 12.927 s conservative replay bound | $0.004543 |

Tier labels describe executed routes, not independently established difficulty. No deterministic or text-only autonomous early-exit tier met calibration safety. Every tier uses Gemini; normal and Deep routes use Places, and the latter uses Sol. Full split-specific p50/p75/p90/p95 and economics are in `LATENCY_BY_TIER.md`.

## F. EASY CASES

Nine held-out correct autonomous results have approximately 6.65s p50 and 8.34s p90 within the retained-evidence boundary. Empty-review sources cost about $0.00454 each in retained common-prefix usage. No millisecond exact-identity path was established.

## G. HARD CASES

Weak named/partial/multi evidence keeps GPT-5.6 Sol and Places, with the existing maximum two Deep attempts and mandatory review policy. Automatic OCR, fresh ASR and retrieval were not justified for inclusion. Existing retained transcript evidence can still be used. Baseline spends on 21/62 Deep cases; candidate uses 15/62.

## H. MULTI-PLACE

Winner and baseline both detect 3/8 held-out multis, resolve zero complete autonomous sets, and autonomously recover 0/24 required places. Autonomous precision is undefined (zero predicted places), recall/F1/exact-set are zero; no autonomous extras. All eight return review. Their candidate p50/p75/p90/p95 is 13.114/21.691/27.398/33.371s, total cost $1.0014991 and average $0.1251874; cost per correct multi result is undefined. Temporal labels and dense transition review exist, but the tested model can miss required scene identities. A structural combination improved Development correct count but introduced four wrong/incomplete multi saves and was rejected.

## I. DESCRIPTION ABLATION

On five Development pilot sources (four exact positives), FULL 0/4 correct, DESCRIPTION_HIDDEN 0/4 with one wrong output, VISUAL_ONLY 0/4, TEXT_ONLY 1/4 with one wrong output. The text lane also disables Deep and is not a pure modality-only contrast. Full Development text-only evaluation introduced 11 new wrong saves. No masked-view held-out generalization is claimed; other eligible masked views remain materialized but unrun.

## J. AUTONOMOUS ACCURACY

Candidate correct autonomous resolution: Development 16/78 (20.51%), calibration 3/26 (11.54%), holdout 9/56 (16.07%). Held-out precision 52.94% and coverage 30.36% are reported together. The cost change does not improve held-out identity accuracy.

## K. SAFETY

Zero newly wrong confident outcomes and zero lost correct autonomous outcomes across the paired Development, calibration and held-out comparisons. One wrong Development parent substitution is removed. One correct Development review candidate is lost by early stopping; it is not counted as a negative. Held-out wrong/unverified rate remains 8/62 (12.90%), branches 3/12, negative autonomous false positives 0/6. Country/region check coverage is 0/17 because parsed provider geography is absent; zero measured mismatches must not be interpreted as verified geography safety. The held-out precision group-bootstrap interval is 27.78%–80.00%, not evidence of 99% reliability.

## L. SPEED

Candidate submitted p50/p75/p90/p95: 8.610/11.871/16.444/20.868s. The replay retains baseline latency and adds local policy overhead (mean 0.275ms); no 20% p90 gain is claimed. Acquisition, fresh ASR, queueing, DB writes and device display are not measured end to end. Physical Development QA must record them separately and account for overlapping work.

## M. COST

Candidate held-out total $4.459795–$4.491795; per submission $0.071932–$0.072448; per correct usable/autonomous result $0.495533–$0.499088 under the scorer's terminal-result definition. Exact primary costs remain null. Known candidate usage by provider: Gemini $0.356720, Sol $0.467075, Places search $3.616000 plus at most $0.032 unknown, geocode $0.020000. Measured avoided suffix work is $0.480934. All actual baseline requests still count as paid experiment spending.

## N. MODEL USAGE

Held-out candidate: Gemini 100% (62 calls), Sol 24.19% (15 calls), Places search 90.32% (114 calls), geocode 6.45% (4 calls). Fresh ASR/OCR/retrieval are 0% inside this evaluation boundary; retained transcripts and legitimate embedded video text remain available. Baseline Sol usage is 33.87% (27 calls). Candidate replay dispatches zero new physical requests.

## O. WHAT HELPED

Healthy-empty stopping avoids 34 Development, six calibration and six held-out Deep paths. The narrow food-parent veto removes one wrong Development save without losing correct autonomous results. A five-case live pilot verifies the empty stop executes. Conservative Development/calibration cost ratios are approximately 0.814/0.807; the independently sealed confirmation is reported separately.

## P. WHAT FAILED

The text lane, all four calibrated text routers, structural/schema/multi combination, adaptive frame pilot, broad literal-address enrichment and strict tenant/name binding did not meet the safety/usefulness criteria. OCR and ASR had small promising examples but unsafe outputs or weak generalization; local ASR also hallucinated speech over music. Retrieval had too few independent groups, and geometric verification produced false accepts. Those components remain outside the integration.

## Q. PARETO FRONTIER

Recommend the narrow candidate only for controlled Development. Retain baseline as rollback/control. The candidate adds sub-millisecond local overhead, so strict latency dominance is not claimed; it improves the practical safety-constrained cost frontier. Faster/cheaper unsafe alternatives are rejected. See `RECOGNITION_PARETO_FRONTIER.md`.

## R. SPEND

1,758 physical requests: $39.63596670 known tariff charges plus $0.032 unresolved reservation = $39.66796670 maximum exposure under the $50 cap. Exact invoice spending is unavailable; no free credits, taxes or purchases are assumed. Remaining maximum authorized exposure: $10.33203330. No paid plans, GPU services or storage purchases occurred.

## S. DEVELOPMENT

Prepared and pushed `integration/recognition-adaptive-gold-v1` at `5ebf0d432fe2d331d89c23021d888cf5cbe6ad2b`, based on repaired `6cb3084`. Both runtime flags default off. No deployment or migration. Worker tests: 703 pass, seven gated skips; focused tests 79 pass; native planner parity 320 pass; strict app/worker types and worker build pass. Broader scripts: 51/55 pass, with all four failures reproduced on the untouched base. Dataset tooling: 66 pass. Repository regression is not fully green.

Live Development deployment `11acd95c-90f3-407e-aefa-2f1d66fc05a9` has no source commit in metadata. Remote shared branch is `7e1b21613b00ca8f21a7659583b083359a01ad82`, different from the tested baseline. Reconciliation is required before any shared write. A durable cross-worker/Edge per-job dollar guard is not implemented by this patch; existing duration/frame/Deep/wall-time bounds and research batch reservations must not be misrepresented as that guard.

## T. PRODUCTION

Production and the ongoing Nearr 1.5 release were not modified or deployed. Railway/Supabase settings and schemas remain unchanged.

## U. GIT

R&D worktree: `C:/Users/andre/Desktop/Nearr-worktrees/recognition-gold-dataset`, branch `audit/recognition-gold-dataset`, start `6cb3084d4bea4357610a028e613db41fdf99a3b7`. Commits before this final report: `8a2bdb7` seal/preregistration, `eb3dcf6` experiments/baseline, `1423106` policy selection/preregistered held-out comparison. The final report commit is the commit containing this file; its exact SHA and push/clean status are supplied in the final chat handoff. Integration worktree: `C:/Users/andre/Desktop/Nearr-worktrees/recognition-adaptive-development`, commit `5ebf0d432fe2d331d89c23021d888cf5cbe6ad2b`, pushed and clean.

## V. NEXT STEP

Attest/reconcile shared Development source with its deployment owner, apply the portable integration, resolve inherited checks and record the exact Development deployment commit. Then perform the fresh-source physical iPhone QA in `FOUNDER_RECOGNITION_QA.md`. Do not tune on individual failures of this old sealed set. A fresh dataset generation is needed for identity/multi improvements; broad rollout additionally needs durable per-job monetary enforcement and complete live timing. Establish an approved access-controlled durable recovery location; current verified backups remain local on the same volume.

# Simple Sol Premium Recognition — Dev release report

## A. Isolation

- Repo: `C:\Users\andre\Desktop\Nearr`
- Worktree: `C:\Users\andre\Desktop\Nearr-worktrees\simple-sol-premium-recognition`
- Branch: `feat/simple-sol-premium-recognition`
- Base / starting HEAD: monetization integration `aea0174010d56ba8286aab84fac581c0f52bc0c1`
- Parity commit incorporated: `3f9fe43ede7163e9bfdb47f316cc111146df0605`
- Implementation commit: `9bd8c9369c34323700c6774ce9920f7e1742f553`
- Final HEAD: see final handoff (the report and live-proof fixes are committed after this file is generated)
- `origin/main`: `1e0772971cda925227c7f677fc249b9c8e643b4f`
- Relevant worktrees inspected: original checkout, parity, monetization, failed canonical recovery, and this isolated worktree.
- Original dirty checkout: untouched.
- Monetization integration available: **YES**, at `aea0174`; the live proof found and repaired two ambiguous PL/pgSQL wallet reads.

## B. Parity preservation

- Original M1: `solParityBenchmark.ts` → F1 diverse six-frame input → exact short `sol-parity-natural-v1` prompt/schema → Responses API.
- Runtime: `premiumRecognitionAdapter.ts` → the same exported `runPremiumRecognitionInference` → deterministic canonicalization/safety.
- Same inference implementation: **YES**. The benchmark imports the runtime inference function; test 1 proves the shared boundary.
- Same-evidence regression: all 44 persisted runnable F1:M1 attempts were replayed through the runtime post-processing path; the paid run itself used the shared inference implementation. No separate production prompt or model caller exists.
- Important differences after inference: bounded Places canonicalization and conservative save authorization. These changed wrong autosaves from 1 in the old simulator to 0 without changing the 42/44 runnable useful score.

## C. Premium architecture

Exact flow:

`eligible free result → authenticated explicit Premium Request → atomic token reserve → premium media task → safe evidence acquisition → one direct GPT-5.6 Sol call → specific-hypothesis Places canonicalization → deterministic safety → existing Nearr result contract → atomic consume/release`

- Gemini before Sol: **NO**
- Web: **OFF by default** (`PREMIUM_SOL_WEB_SEARCH_ENABLED=false`)
- MCP / agent loop / AI critic: **NO**
- Machine identity cache input: **NO**
- Places candidates before Sol: **NO**
- Generic Places discovery: **NO**
- Repeated Sol uncertainty loop: **NO**

## D. Evidence reuse

- Runtime accepts canonical URL/platform, current frames/timestamps, caption, transcript, OCR, creator/source metadata, source location context, duration, and request timing.
- Frame strategy: current bounded F1 diverse strategy, maximum six sent to Sol, with near-duplicate suppression upstream.
- Durable reuse telemetry is explicit per component (`REUSED` / `REACQUIRED`).
- The live proof intentionally created real-source terminal free jobs without attaching old durable media snapshots, so all 25 model-reached live runs correctly recorded media/frames/transcript/OCR/caption as **REACQUIRED**. The same social-post identity and URL were retained; no reshare or second post identity was created.

## E. Sol

- Model: `gpt-5.6-sol`
- API: OpenAI Responses API
- Prompt version: `sol-parity-natural-v1`
- Prompt/schema: exact parity exports; no production expansion.
- Reasoning: `high`; `store=false`; no temperature override.
- Images: base64 data URLs, `detail=high`, six-frame F1 budget.
- Context bounds: caption 4,000 chars; transcript 8,000; OCR 3,000; source location 300. The adapter applies an earlier 8,000/500 sanitation bound, and the shared prompt applies the authoritative parity bound.
- Sol requests per Premium execution: one when evidence acquisition reaches inference; bounded transport retry only.

## F. Canonicalization

Paid 44-run corpus replay:

- Places total: 96
- Mean: 2.182
- Median: 1
- P95: 5
- Max: 22 (the genuine 22-destination S04 roundup; budget is independent per logical destination)
- Parity baseline: 7.60/video

Thirty live requests across two independent batches:

- Places total: 46
- Overall mean: 1.533/request; model-reached mean: 1.84
- Median: 1
- P95: 5
- Max: 5
- Generic fallback queries: 0
- Mixed/pipe identity queries: 0
- Strong singleton limit: 2; ambiguity limit: one call for each of at most three hypotheses.

## G. Safety

- C07 paid replay: Sol returned San Diego Zoo based on the famous “Me at the zoo” context; exact Google canonicalization; evidence classified `CONTEXTUAL_OR_MEMORY_PRIOR`; result downgraded to review; one Places call; chargeable actionable; never autosaved.
- C07 live batches: both produced no useful result and released the token; neither autosaved.
- Wrong autosaves: 0 in paid replay; 0 across 30 live requests.
- Memory-prior autosaves: 0.
- Safety downgrades preserve review/named-lead output; LOW confidence alone is not rejected.
- Useful results lost due to safety in paid replay: 0. Live misses were inference/canonical usefulness variance, not an autosave safety rejection demonstrated by the stored result contract.

## H. R01–R08 paid runtime replay

| Case | Sol hypothesis | Canonical result | Decision | Chargeable | Places | Total latency | Sol cost |
|---|---|---|---|---:|---:|---:|---:|
| R01 | Cirque de Gens | named lead | options | yes | 3 | 93.683s | $0.121364 |
| R02 | Puʻu Kekaʻa (Black Rock) | named lead/options | options | yes | 3 | 66.177s | $0.076228 |
| R03 | Tamolitch Blue Pool | Tamolitch Falls (Blue Pool) | review | yes | 1 | 24.295s | $0.043144 |
| R04 | Dorset Quarry | Dorset Marble Quarry | options | yes | 2 | 49.573s | $0.064160 |
| R05 | Ōkere Falls Scenic Reserve / Kaituna River | Okere Falls Scenic Reserve Parking + named identity | options | yes | 2 | 33.356s | $0.053996 |
| R06 | Lake Havasu | Lake Havasu | options | yes | 3 | 36.336s | $0.039768 |
| R07 | Stryn cliff-diving site | named lead | options | yes | 3 | 74.822s | $0.088348 |
| R08 | Queen’s Bath on Moku Nui, Mokulua Islands | Moku Nui | options | yes | 2 | 30.100s | $0.048404 |

Required contamination checks passed in the paid parity-preservation run: no generic Cliff Jumping autosave, California-for-Maui, city-for-lake, U.S.-business-for-Norway, restaurant-for-Mokulua, or host-mall substitution.

Live quality was not stable enough for release: attempt 1 was 8/9 (R02 returned California beaches); attempt 2 was 7/9 (R01 and R06 returned no useful result). Across the two batches each priority identity appeared correctly at least once, but that aggregate is not substituted for the required single-batch 9/9 gate.

## I. Paradise Dynasty

- Paid Sol: `Paradise Dynasty at South Coast Plaza`
- Specific primary query retained the restaurant identity and Costa Mesa qualifier.
- Canonical: `Paradise Dynasty`, 3333 Bristol Street / South Coast Plaza context.
- Alternative branch: The Americana location, preserved as genuine transcript ambiguity.
- Parent substitution: **NO**. South Coast Plaza never replaced the tenant.
- Calls: 2; result: picker/review; chargeable actionable.
- Both live batches retained Paradise Dynasty and did not substitute the mall.

## J. Parity scorecard

- Original direct M1: useful 42/48; exact 32/48; priority 9/9.
- New runtime paid replay: useful 42/44 runnable = 42/48 source corpus; exact 32/44 = 32/48; wrong top-1 2; wrong autosaves 0; priority 9/9.
- Four cases were unavailable before any model call: P10 extractor failure, C02 Snapchat resolver unavailable, C03 duration 213s over limit, C05 model-output JSON parse failure.
- Live attempt 1: 13/15 useful, priority 8/9.
- Live attempt 2: 11/15 useful, priority 7/9.
- Combined live observations: 24/30 useful, six no-useful-result, zero wrong autosaves. This does **not** clear the required live 9/9 gate.

## K. Multi-place

- True logical destinations remain distinct; ambiguity remains nested per destination.
- At most three hypotheses per logical destination.
- No global three-place cap.
- Per-destination canonicalization budgets are independent. S04’s max of 22 calls reflects 22 genuine logical destinations, not a query ladder.

## L. Cache

- Machine recognition cache read: **NO**
- Machine trusted cache write: **NO** (`__skipRecognitionCachePersist` on Premium terminal paths)
- USER_CONFIRMED: same-source confirmed truth remains a free normal-path result and makes Premium ineligible; Premium never charges merely to rediscover it.

## M. Economics

Paid corpus replay:

- Known Sol total: $2.102100 across 44 calls
- Sol mean: $0.047775
- Places: request counts known; dollar cost **UNKNOWN**
- Acquisition/transcription/all-in: **UNKNOWN**, never counted as zero

Thirty live requests:

- 25 recorded Sol cost components; five runs did not record a Sol component because inference was not reached or no component was persisted.
- Known Sol total: $1.002377
- Mean among measured Sol calls: $0.040095
- P50: $0.035508
- P95: $0.097828
- Acquisition, transcription, Places dollar cost, and all-in: **UNKNOWN**

## N. Latency

Paid corpus replay:

- Sol median: 8.357s; Sol P95: 75.441s
- End-to-end median: 21.852s; P95: 93.563s

Live model-reached runs (n=25):

- Evidence prep median: 15.470s; P95: 21.558s
- Sol median: 14.003s; P95: 65.780s
- Sol + Places after evidence ready median: 14.472s; P95: 66.156s; max 86.422s
- Evidence prep + post-evidence execution median: 28.035s; P95: 82.173s; max 101.117s
- Queue wait is not included in component execution latency.

## O. Monetization integration

- Integrated: **YES**
- Normal free share token delta: 0; real normal-free creation RPC used in both live batches.
- Premium reservation: 15/15 in each batch; wallet moved from 15 available/0 reserved to 0 available/15 reserved.
- Actionable review consume: **PASS**
- No-result release: **PASS**
- Duplicate Premium tap: **PASS**, one reservation/one Premium task.
- Zero-balance purchase continuation: deterministic contract tests pass; the live harness funded the ephemeral user before requests and did not physically exercise the store continuation UI.
- Live testing exposed and repaired ambiguous `available_uses` references in both normal-free creation and Premium request RPCs via migration `20260905000001`.
- Live testing also exposed and repaired Premium acquisition-failure settlement: callbacks without a Sol payload now reach the non-chargeable fallback instead of returning HTTP 400.

## P. Tests

Final gate results are recorded in the final handoff. Core results before final rerun:

- Root TypeScript: pass
- Dedicated Premium Sol suite: 46/46 pass
- Sol parity harness: 9/9 pass
- Premium monetization suite: pass
- Worker suite: 498 pass, 7 skipped live, 0 fail (505 total)
- Worker typecheck/build: pass
- Deno Edge check with `--no-config`: pass
- Startup/release/deployment guards: pass
- `git diff --check`: pass (line-ending warnings only)

## Q. Dev

- Railway: Nearr Phase 2 Dev / development / media-worker; deployment `7909c6eb-9cf4-464f-afb0-3d5d13bd85ef`; image `sha256:24015ea038e1423b2f84b72d297ff3f7487c46f30042affe59cac6d04c16c113`; SUCCESS/RUNNING; `/health` and `/ready` pass.
- Edge: only `process-share-jobs` deployed, final version 96 verified active. Monetization remains version 30.
- Schema: Dev-only migration `20260905000001_fix_premium_request_available_uses.sql` applied; no Production schema mutation.
- OTA: **NO**
- Environment unmixed: **YES** (`qnfxnmvxpjzfydgudtvs`, Railway `development`, service `media-worker`).

## R. Founder QA

**NOT READY** for founder sign-off because the live priority gate did not reach 9/9 in either independent batch.

When the quality blocker is resolved, use:

1. Easy free share: normal result, no Premium offer, no token change.
2. Hard video: normal path misses, Premium offer appears, no reshare, result appears.
3. Premium success: one token consumed; review/save works.
4. Premium no result: token returned.
5. Zero balance: store purchase resumes the same Premium request.
6. Known hard case: compare a founder-identified video against manual ChatGPT.

## S. Production

- Main merge: **NO**
- Production Railway/Edge/schema/OTA/cache mutation: **NO**

## T. Architecture verdict

- Did the simple runtime path preserve the parity advantage? **YES in the paid same-evidence corpus; NO at the required live 9/9 reliability gate.**
- Did C07 become safe without destroying paid-corpus usefulness? **YES**
- Did Places request volume drop materially? **YES** (7.60 baseline → 2.18 paid replay mean / 1.53 live overall mean)
- Is this ready to become the Premium Request engine? **NO**, not until live priority reliability reaches 9/9 without forbidden retries or added orchestration complexity.

## U. Final verdict

SIMPLE SOL PREMIUM REQUEST NEEDS MORE WORK

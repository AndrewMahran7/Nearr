# Nearr P0 Research — ChatGPT Parity Recognition Harness

Generated 2026-09-04T20:05:26.985Z.

## A. Isolation

Repo: C:\Users\andre\Desktop\Nearr-worktrees\sol-chatgpt-parity

Worktree: C:\Users\andre\Desktop\Nearr-worktrees\sol-chatgpt-parity

Branch: experiment/sol-chatgpt-parity

Starting HEAD: 1e0772971cda925227c7f677fc249b9c8e643b4f

Final HEAD: record after final commit (report generated from working tree).

Clean: isolated from the original dirty checkout; experiment tree will be clean after evidence commit.

## B. Experiment architecture

Exact path: services/media-worker/src/solParity plus services/media-worker/src/cli/solParityBenchmark.ts.

Cache used: NO.

Google candidates sent to Sol: NO.

MCP: NO.

Web search: OpenAI Responses API native web_search only in M2/M3. Raw response is fsynced before post-model Places; labels load only after all inference.

## C. Corpus

Real distinct media cases: 48; attempted: 48; M1 model results: 44; acquisition/pre-model failures: 4. Failures: P10 provider_changed/extractor_failed; C02 Snapchat resolver unavailable; C03 duration 213s exceeded the acquisition cap; C05 yt-dlp provider failure. A superseded R03 canary persisted its model response, then failed canonicalization because of an initial harness import-path error; R03 was corrected and rerun, and the failed canary remains in the evidence.

Natural: 9; business: 28; hotel: 0; multi-place: 5; easy controls: 6; negative: 6. The requested 20 natural/5 hotel mix was not available and was not fabricated.

Manual screenshot sets available: NO — MANUAL_FRAME_ARM_NOT_AVAILABLE.

## D. Frame arms

F1 current: exact current Nearr diverse strategy/budget (six here), timestamps and SHA-256 hashes recorded.

F2 broad: up to 15 temporally stratified, perceptually diverse post-dedup frames; actual priority clips yielded 5–15 depending on available distinct frames.

F3 founder: input convention exists at artifacts/sol-parity/manual-frames/<case-id>/; no founder sets existed.

## E. Model arms

M1 Sol: gpt-5.6-sol, high reasoning, images plus bounded source context, no web.

M2 Sol + web: identical evidence plus native web_search.

M3: implemented and tested, not paid-run because it was secondary and M2 already showed high cost/latency with no quality uplift.

## F. R01–R08

### R01

Nearr (FROZEN_RECENT): Cliff Jumping; auto_save.

Sol: Cirque de Gens on the Ardèche River (useful).

Sol + web: Plage de la Draille on the Gardon River (useful).

Best: Sol vision-only.

### R02

Nearr (FROZEN_RECENT): Mokulēʻia Beach Park; auto_save.

Sol: Puʻu Kekaʻa (Black Rock) (useful).

Sol + web: Keoneʻōʻio (La Perouse Bay) (useful).

Best: Sol vision-only.

### R03

Nearr (FROZEN_RECENT): no result; manual_fallback.

Sol: Tamolitch Blue Pool (useful).

Sol + web: Tamolitch Blue Pool (Tamolitch Falls) (useful).

Best: Sol vision-only.

### R04

Nearr (FROZEN_RECENT): Dorset Marble Quarry; multi_candidate_confirmation.

Sol: Dorset Quarry (useful).

Sol + web: no result (not useful).

Best: Sol vision-only.

### R05

Nearr (FROZEN_RECENT): Okere Falls; auto_save.

Sol: Okere Falls Scenic Reserve (Kaituna River gorge) (useful).

Sol + web: Trout Pool Falls cliff-jumping pool, Ōkere Falls Scenic Reserve (useful).

Best: Sol vision-only.

### R06

Nearr (FROZEN_RECENT): Lake Havasu State Park; multi_candidate_confirmation.

Sol: Copper Canyon on Lake Havasu (useful).

Sol + web: Copper Canyon Jump Rock, Lake Havasu (useful).

Best: Sol vision-only.

### R07

Nearr (FROZEN_RECENT): Kissner's; candidate_picker.

Sol: Unidentified cliffside lake in Norway (useful).

Sol + web: Oppstrynsvatnet (Strynsvatnet) (useful).

Best: Sol vision-only.

### R08

Nearr (FROZEN_RECENT): Na Mokulua; auto_save.

Sol: Queen’s Bath cliff-jumping inlet on Moku Nui (Mokulua Islands) (useful).

Sol + web: Shark’s Cove, backside of Moku Nui (Nā Mokulua / “The Mokes”) (useful).

Best: Sol vision-only.

### V05

Nearr (FROZEN_RECENT): South Coast Plaza; candidate_picker.

Sol: Paradise Dynasty at South Coast Plaza (useful).

Sol + web: Paradise Dynasty at South Coast Plaza (useful).

Best: Sol vision-only.

R03 M2 search provenance: 6 web-search calls. Captured queries: site:instagram.com/tpace5 cliff jumping Blue Pool; site:instagram.com/tpace5 cliff jumping Blue Pool; Tamolitch Blue Pool cliff jumping viewpoint; Tamolitch Blue Pool cliff jumping video same ledge cedar tree; "tpace5" Instagram. Source hosts retained in raw evidence: www.reddit.com, oceanblueproject.org, www.twowanderingsoles.com, www.oregonhikers.org, www.swimmersdaily.com, rootednroaming.com, lookouteugene-springfield.com, www.dirtbagswithfurbags.com, www.bendsource.com, oregontails.org, antisocialtourist.com, oregonpark.org, www.merkley.senate.gov, www.oregon.gov, oregonwhitewater.org, www.cookfamily.org, en.wikipedia.org, arxiv.org, www.youtube.com, denphototravel.com, outdoorpilgrim.com, www.pinesnvines.com, www.friendsoftheumpqua.org, www.flickr.com, visitmckenzieriver.com.

## G. Paradise Dynasty

Nearr’s frozen result was South Coast Plaza. Direct M1 returned Paradise Dynasty at South Coast Plaza; M2 returned Paradise Dynasty at South Coast Plaza. Both retained the restaurant identity; South Coast Plaza remained host/locality context rather than replacing the tenant.

## H. Overall scorecard

CURRENT NEARR (best frozen comparable artifact, N=41): exact 20; useful 20; useful top3 20; wrong 10; wrong autosave 2; no answer 11.

SOL ONLY F1: exact 32/48; useful 42/48; top3 42/48; wrong 2/48; wrong autosave 1/48.

SOL + WEB F1 targeted: exact 6/18; useful 15/18; top3 15/18; wrong 2/18; wrong autosave 0/18.

## Critical comparison

| Case | Nearr top1 | M1 Sol top1 / quality / latency / cost | M2 Sol+Web top1 / quality / latency / cost |
|---|---|---|---|
| R01 | Cliff Jumping<br>exact=N useful=N<br>69185ms; $UNKNOWN | Cirque de Gens on the Ardèche River<br>exact=N useful=Y<br>68389ms; $0.069064 | Plage de la Draille on the Gardon River<br>exact=N useful=Y<br>170263ms; $0.549943 |
| R02 | Mokulēʻia Beach Park<br>exact=N useful=N<br>156141ms; $UNKNOWN | Puʻu Kekaʻa (Black Rock)<br>exact=N useful=Y<br>82360ms; $0.084408 | Keoneʻōʻio (La Perouse Bay)<br>exact=N useful=Y<br>198241ms; $0.506019 |
| R03 | NO ANSWER<br>exact=N useful=N<br>172476ms; $UNKNOWN | Tamolitch Blue Pool<br>exact=Y useful=Y<br>58019ms; $0.075288 | Tamolitch Blue Pool (Tamolitch Falls)<br>exact=Y useful=Y<br>63786ms; $0.192603 |
| R04 | Dorset Marble Quarry<br>exact=Y useful=Y<br>142542ms; $UNKNOWN | Dorset Quarry<br>exact=Y useful=Y<br>46593ms; $0.04946 | NO ANSWER<br>exact=N useful=N<br>197743ms; $UNKNOWN |
| R05 | Okere Falls<br>exact=Y useful=Y<br>36651ms; $UNKNOWN | Okere Falls Scenic Reserve (Kaituna River gorge)<br>exact=Y useful=Y<br>51992ms; $0.060676 | Trout Pool Falls cliff-jumping pool, Ōkere Falls Scenic Reserve<br>exact=N useful=Y<br>132561ms; $0.481463 |
| R06 | Lake Havasu State Park<br>exact=Y useful=Y<br>138648ms; $UNKNOWN | Copper Canyon on Lake Havasu<br>exact=Y useful=Y<br>41412ms; $0.038168 | Copper Canyon Jump Rock, Lake Havasu<br>exact=Y useful=Y<br>76498ms; $0.227983 |
| R07 | Kissner's<br>exact=N useful=N<br>164028ms; $UNKNOWN | Unidentified cliffside lake in Norway<br>exact=N useful=Y<br>132874ms; $0.12192 | Oppstrynsvatnet (Strynsvatnet)<br>exact=N useful=Y<br>59955ms; $0.183827 |
| R08 | Na Mokulua<br>exact=Y useful=Y<br>93755ms; $UNKNOWN | Queen’s Bath cliff-jumping inlet on Moku Nui (Mokulua Islands)<br>exact=Y useful=Y<br>31623ms; $0.042696 | Shark’s Cove, backside of Moku Nui (Nā Mokulua / “The Mokes”)<br>exact=Y useful=Y<br>69554ms; $0.184399 |
| V05 | South Coast Plaza<br>exact=N useful=N<br>8527ms; $UNKNOWN | Paradise Dynasty at South Coast Plaza<br>exact=Y useful=Y<br>33108ms; $0.040532 | Paradise Dynasty at South Coast Plaza<br>exact=Y useful=Y<br>51648ms; $0.125623 |
| TOTAL (priority N=9) | exact=4; useful=4 | exact=6; useful=9 | exact=4; useful=8 |

## I. Frame-selection effect

Paired priority cases: 9; broad wins 1; ties 7; losses 1; net useful-case uplift 0.

MANUAL_FRAME_UPLIFT: UNKNOWN — exact founder frames unavailable.

BROAD_FRAME_UPLIFT: 0; frame selection was not the primary gap.

## J. Web-search effect

Wins: 1. Ties: 15. Losses: 2. Wrong answers introduced: 0.

Median Sol latency delta: +18401 ms. Median known model-token cost delta: +$0.123723. Web tool fees are unknown.

## K. Orchestration effect

On the same F1 automatic frame policy, direct M1 was useful on all nine priority cases; the frozen Nearr priority baseline was useful on 4/9. R03 moved from no result to Tamolitch; R07 moved from unsafe/incorrect behavior to a truthful Norwegian natural lead. This identifies orchestration around the capable model as the main avoidable loss, within an overall SOL_SIMPLE_PATH_WINS result.

## L. Canonicalization

M1 Sol destination objects: 79. Canonical exact: 28; alias: 24; ambiguous: 4; named lead: 23. Bad substitutions: 0 observed in simulated decisions. Named leads were preserved.

## M. Safety

Wrong autosave simulation: 1 for M1; 0 for targeted M2.

Geo contradictions: 0 M1. Semantic nonsense/known wrong identities: 1 M1.

Famous/generic controls with model results: 5. False exact-famous matches: 2 (Panera branch and San Diego Zoo). Panera stayed a named lead; San Diego Zoo canonicalized and produced the single unsafe M1 simulated autosave. Web did not fix either. This save policy is not production-ready without an additional famous/generic-scene guard.

## N. Latency

Current Nearr known frozen latency: median 10927 ms; p95 172476 ms.

Simple Sol M1 end-to-end observed stages: median 29687 ms; p95 102445 ms.

Sol + web targeted: median 69554 ms; p95 198241 ms. Web-only substage timing is not exposed, so it is UNKNOWN.

## O. Cost

Sol actual known model-token spend across every paid attempt (including superseded canaries): $8.961983; attempts 73; attempts with missing token cost 2.

Web search: 134 calls in selected F1 M2 results; tool cost UNKNOWN.

Places: 113 requests in selected F1 results; 365 observed across initial processing, one diagnostic, and two complete rechecks. Text Search Pro list price used: $32/1,000; maximum pre-free-cap list-price estimate $11.68. Actual billed cost UNKNOWN because account-level free caps/plans were not returned. Pricing reference: https://developers.google.com/maps/billing-and-pricing/pricing.

All-in: UNKNOWN because web, transcription, and Places provider billing were not returned. Missing cost was never counted as zero.

## P. Architecture conclusion

SOL_SIMPLE_PATH_WINS

Direct M1 materially beat the frozen current Nearr priority behavior, eliminated the R03 hypothesis-loss failure, kept R05/R08 natural identities, kept R07 in Norway, and retained Paradise Dynasty. It produced one unsafe simulated autosave in 48 attempted cases (44 reached the model; C07 San Diego Zoo was unsafe), versus two in 41 comparable frozen current cases; therefore the recognition architecture wins, while its save gate still requires a control-specific hardening pass before any production promotion. M2 was slower, costlier, rate-limited twice, and did not improve paired quality. F2 had one win and one loss, so broader automatic frames were not primary.

## Q. Recommended Nearr architecture

Next test a minimal development-only adapter: existing acquisition → current six representative frames (with a bounded broad fallback only when coverage is low) → caption/transcript/OCR/source context → direct gpt-5.6-sol M1 → persisted hypotheses → existing Places canonicalization → conservative existing result contract. Keep named natural leads when Places misses. Use web search only as an explicit second-stage research escalation, not unconditionally. Preserve the simulated save gate and add a stricter uncertainty rule for generic chain/zoo imagery. Do not add Gemini until quality parity is retained under a later cost experiment.

## R. Production

Main merge: NO.

Production mutation: NO.

Nearr-Dev deployment: NO.

## S. Final verdict

CHATGPT PARITY EXPERIMENT SUPPORTS SIMPLIFYING VAYRIN

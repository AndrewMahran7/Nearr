# Vayrin same-place moment consolidation

## Production incident audit

The production reel `DcetoQJxbt-` had two affected jobs. The first persisted
three resolver slots (`Cenote`, `Underground Cenote`, `Cenote 7 Bocas`) and five
unique Google candidates. The second persisted two slots (`Cenote`, `Cenote 7
Bocas`) and five candidates. Both opened multi-candidate review. The worker runs
used Gemini, not the Vayrin fallback, and emitted `multiple=true` before the
Edge finalizer built the slots.

The old path was:

1. the analysis model emitted `places`;
2. `buildVenueMentions` treated each distinct normalized name/region (or model
   logical id) as a searchable slot;
3. exact same-name/same-region entries were deduplicated, but visual continuity
   was not considered;
4. Context-Aware Places and V3 operated after slots already existed.

Timestamps did not directly create slots. Scene transitions did not have a
dedicated grouping stage. The exact cause was model-authored moment labels being
accepted as independent places; name dedupe could not merge the three different
labels.

## Exact-reel reconstruction

The privacy-safe local inspection retained 14 frames at 0–12.947 seconds. ASR
contained only the song line, with no place identity. Important visual/text
moments were:

- 0–1s: generic cenote caption, pool, and zipline;
- 7s: “next cenote” narrative within the reel, without a “next stop” or travel
  segment;
- 10–11s: underground cenote/bats, cave, and wooden stairs;
- 12s: `CENOTE 7 BOCAS`; a passing hotel road sign is explicitly retained as a
  passing mention.

Same-place evidence is the continuous cenote geology/water/activity, compatible
Quintana Roo/Mexico context, lack of travel or geographic conflict, and the
specific final identity clue. There is no affirmative city/region/country,
named-venue, travel-segment, or platform-location conflict. The expected product
group is one visitable attraction containing all relevant moments.

## Grouping contract

Recognition now runs a pure consolidation decorator after either Gemini or the
Vayrin fallback and before Edge mention creation:

`raw model moments -> tri-state comparison -> logical-place clusters -> mentions -> Places`

Pairwise results are `SAME_PLACE`, `DIFFERENT_PLACE`, or `UNKNOWN`. Distinctive
same names, an existing shared logical id, overlapping canonical IDs (when
already available), and visual-anchor overlap are positive same-place signals.
Explicit next-stop/day/travel text, incompatible geography, two genuinely
distinctive venue names, and strongly incompatible scene/category families are
positive separation signals. Generic labels such as `Cenote`, `Beach`, and
`Restaurant` prove neither direction. `UNKNOWN` joins conservatively unless a
strong separation exists.

Merged places retain bounded timestamps, explicit/inferred evidence, scene
anchors, category tags, geography, partial Never-Dead-End evidence, and ranked
identity alternatives. Passing mentions remain contextual and never enter the
logical-place count. No new model or Places request was added.

## Cache and safety

Recognition version `vayrin-recognition-2026-08-26.v3-generic-guard-same-place-groups` forces
old machine-only `CANDIDATE_SET` and `VERIFIED_AUTO_SAVE` rows to recompute.
`USER_CONFIRMED` truth continues to win before the version check. The existing
media autosave, semantic compatibility, Context-Aware Places, V3 verification,
and Multi-Place Review gates are unchanged.

## Frozen-corpus benchmark

The corpus has 18 fixtures: seven same-place, eight true-multi-place, and three
ambiguous. It contains 46 raw moment entries and produces 28 logical place
groups. On this corpus:

- same-place merge precision: 100% (7/7);
- different-place split recall: 100% (8/8 videos at their exact labeled count);
- false splits: 0;
- false merges: 0;
- resolver-slot/Places-call upper bound: 46 -> 28 (-18, -39.1%);
- multi-place review cases: 18 -> 8 (-10, -55.6%);
- model-call and model-cost delta: 0 calls / $0;
- grouping latency: in-process deterministic work; the 22-test focused suite,
  including startup and assertions, completes in about 0.4 seconds.

For the exact reel, affected production outputs had five unique candidates. A
post-change local provider run produced one logical mention, one Places call,
one candidate (`Cenote Siete Bocas`, canonical Google ID
`ChIJs9lnx0plTo8RWUUKvVa1nt4`), Candidate Confirmation, and no autosave. Total
local command wall time was 61.8 seconds; the historical production worker runs
were 47.6 and 53.6 seconds, so those provider-dependent samples are reported but
are not treated as a controlled latency comparison.

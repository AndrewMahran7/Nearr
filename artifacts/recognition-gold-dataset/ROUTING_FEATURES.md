# Routing features — experimental

The fitted text-first policies consume 13 bounded scalars, in a frozen order:

| Feature | Meaning |
|---|---|
| minimum_confidence | Lowest server-decision score among selected places |
| confidence_missing | No usable decision score is available |
| exact_support_fraction | Fraction supported by an existing exact-identity gate |
| source_named_fraction | Fraction with source-named support |
| candidate_bound_fraction | Fraction with candidate-bound support |
| distinctive_visual_fraction | Fraction with distinctive visual support |
| geography_conflict | Existing geography/location veto is present |
| model_prior | Existing prior-only or upstream-review veto is present |
| review_option_count | Review alternatives, capped at ten and divided by ten |
| place_count | Autonomous destinations, capped at ten and divided by ten |
| multi_detected | Multiple destinations were detected |
| partially_unresolved | Finalization still requires help |
| technical_failure | The stage failed |

Names, place IDs, coordinates, captions, source IDs, gold classes and gold outcomes
cannot enter the feature vector. Training targets enter only the offline development
fit. Connected source/place components receive equal total training weight.

Separate deterministic policies inspect actual frame membership, successful parsing,
partial-place evidence and provider entity types. They can stop an unproductive
recovery or veto a save; they do not manufacture identity evidence. Logs retain
policy flags, reason codes, evidence counts and physical provider usage.

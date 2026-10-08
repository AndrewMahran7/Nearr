# Recognition optimization corpus, generation 1

The frozen corpus contains **116 real source cases plus 2 constructed multi-place controls**, not 200-300 independent videos. All historical outcomes are exposed development data. There are **0 calibration and 0 genuinely unseen held-out cases**. This task cannot establish population accuracy or generalization with this corpus.

The operative full manifest is [dataset-v2/inputs.json](dataset-v2/inputs.json), with separately stored [labels](dataset-v2/labels.json) and [freeze/provenance](dataset-v2/freeze.json). The initial manifest remains in `dataset/`; revision 2 quarantines two public La Jolla cases before any replay execution because uploader location and Commons category may conflict. No model outcome prompted that quarantine.

| Label | Real cases | Constructed controls | Exact-place denominator |
|---|---:|---:|---|
| VERIFIED_EXACT_SINGLE | 40 | 0 | Eligible, subject to the declared alias/locality granularity |
| VERIFIED_MULTI | 0 | 2 | Controls excluded from real accuracy |
| VERIFIED_REGION_ONLY | 5 | 0 | Excluded |
| KNOWN_NEGATIVE | 10 | 0 | Safety/precision controls, not exact-place recall |
| UNVERIFIED | 61 | 0 | Excluded |

## Sources and label authority

The import combines 47 unique legacy Sol/regression sources, 41 additional cliff sources, and 30 public benchmark cases. The 28-case founder-reviewed metadata corpus overlaps these legacy sources; it contributes evidence/labels, not 28 additional videos. One duplicate legacy URL and the cliff `CJ004`/legacy `R08` duplicate are merged. The two public multi cases combine frames from independently sourced clips; they are not real submitted multi-place posts.

The 40 exact-single labels comprise **22 retained internal curated/source-verified labels and 18 retained public-source adjudications**. They are inherited labels, not 40 newly independently verified cases. Founder-reviewed fixtures are an allowed truth source under the task. Legacy `HIGH_CONFIDENCE` and provisional labels are not automatically promoted. Independent cliff verification requires the previous `VERIFIED_EXACT` tier; most cliff guesses remain unverified. Public cases with only lake/region/parent or component alternatives are region-only. Both La Jolla public cases are quarantined. Their parent-source labels must also remain quarantined in any retrieval experiment.

Each label retains its source reference and prior quality. A curated label can still be wrong; disagreement requires adjudication and a new immutable label revision. Provider candidate IDs, saved states, confidence, and benchmark model answers do not create truth. Country/region fields on unverified historical records are not used as scoring truth.

## Grouping, rights and blind evaluation

Inputs carry source keys, physical-place keys where known, creator keys where retained, and connected-component groups: **100 groups**. Cross-platform URLs and shortcode aliases are canonicalized where identity is established. A public composite is connected to each component source. Same-place public clips share their place group. Repeated sources are not independent samples.

Unknown creators, uncatalogued reposts and perceptually similar frames remain a limitation. No claim of exhaustive perceptual deduplication is made. Every case is in the same exposed partition, so missing links cannot silently create held-out leakage. A future split must extend these groups using media hashes, near-duplicate inspection, creators and venue identity **before** inference or tuning.

The public benchmark retains source URLs and license descriptions. Existing social evidence is reused locally under its existing evaluation authorization. No new media was acquired, republished or added to a permanent retrieval collection by this importer. Cached binaries stay outside committed evaluation artifacts. Neither a source's data license nor its presence in a benchmark grants unrestricted image rights.

`dataset-v2` hashes:

- Inputs: `71dbd1c4ab6cf8ef1d4bd14c2e9b0258e95f8c32b31609ac85e5741f46e1b56a`.
- Labels: `14a1690ad5a5d3942b504a873f9ed7e9edd47b21776b69d9615bf9dc3102c6e1`.

Frozen artifacts use LF through `.gitattributes`. Legacy request evidence is accepted only if its byte hash matches the captured hash or differs solely by deterministic CRLF/LF conversion.

## Executable replay subset and scoring limits

[policy-replay-dataset](policy-replay-dataset/freeze.json) selects all available paired raw model/runtime records, then source-deduplicates: **31 real cases from 32 recorded attempts**, with **15 verified exact labels and 16 unverified labels**. Selection uses evidence availability, never correctness. No exact label is manufactured for the missing acquisition/model records.

The retained raw calls have source-text hashes and lengths but do not preserve all source caption/transcript strings. Provider request logs do not always retain rejected provider candidates. Consequently the executable boundary is conditional post-deep policy replay, not fresh recognition: current canonicalization runs only for complete retained response sets; current safety receives retained typed evidence; current automatic-deep review and pure finalization execute. See [baseline scope](RECOGNITION_OPTIMIZATION_BASELINE.md).

The initial frozen scorer uses exact accepted aliases and required locality. Five of its six unmatched top-1 predictions are naming forms accepted in older secondary manifests but omitted by narrower founder/cliff label imports (`H09`, `P01`, `P05`, `P06`, `R08`). They are **scoring inconclusives, not five established wrong physical places**. `H06` is a physical branch conflict: Montclair versus Rialto. The first baseline and labels are preserved; this report does not silently expand aliases after observing outcomes. Adjudicate and freeze a documented new scoring revision before a larger benchmark. These all remain review in the ordinary deep policy.

The historical premium 29/31 score uses different labels and safety/output semantics; it is not directly comparable to this stricter 9/15 alias/locality replay score. Neither is the current application's end-to-end autonomous accuracy.

## Next corpus generation

Acquire/adjudicate at least 50 genuinely unseen groups, preferably within a 200-300-real-case corpus, with complete real multi-place sets, chain branches, wrong-country/region negatives, multi-language proper nouns, and ordinary weak-metadata cases. Freeze source evidence and exact branch/place IDs or explicit accepted aliases before tuning. Keep independent annotator disagreements visible. Retain calibration and held-out partitions separately; do not relabel these historically exposed cases as unseen.

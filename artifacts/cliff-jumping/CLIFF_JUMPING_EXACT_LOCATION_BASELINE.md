# Nearr 42-video cliff-jumping exact-location benchmark

Generated 2026-09-05T23:11:31.611Z. Primary exact metrics use only VERIFIED_EXACT and HIGH_CONFIDENCE_EXACT cases. Provisional and unresolved cases are reviewed for plausibility but excluded from Exact@k. All inference was persisted before ground-truth research; the runner manifest confirms ground truth was not loaded.

## A. Corpus

Founder videos: 42
Attempted: 42
Acquired: 42
Technical: 0
Unique founder content: 42. CJ004 is also the historical R08 content (same shortcode), retained as a founder case.

## B. Ground truth

VERIFIED_EXACT: 7/42
HIGH_CONFIDENCE_EXACT: 21/42
PROVISIONAL_BEST_GUESS: 10/42
UNRESOLVED: 4/42

## C. Production Free

Exact@1: 0 / 28
Exact@3: 0 / 28
Specific reasonable@3: 0 / 42
Broad-area-only: 0
Generic descriptor shown as identity: 0
Wrong named exact: 0; empty/non-actionable: 42
Technical: 0

The current free path acquired every public clip, but its evidence extractor returned no place identity on all 42; it therefore produced no candidates. This is an accuracy failure, not an acquisition failure.

## D. Simple Sol

Raw Sol Exact@1: 27 / 28
Raw Sol Exact@3: 27 / 28
Canonical Exact@1: 25 / 28
Canonical Exact@3: 26 / 28
Specific reasonable@3: 36 / 42
Broad-area-only: 0
Generic descriptor shown as identity: 2
Wrong raw exact: 1
Technical: 0

Canonicalization broadened the raw top identity on CJ004, CJ009. At top 3, only CJ009 was fully lost; CJ004 retained a Moku Nui alternative at rank 2.

## E. Auto Deep simulation

Exact@1: 25 / 28
Exact@3: 26 / 28
Cases recovered from free: 36
Cases harmed: 0

## F. Every case

| Case | Ground Truth Status | Best Ground Truth / Research Hypothesis | Production Free Top 3 | Simple Sol Canonical Top 3 | Exact@1 | Exact@3 | Specific/Reasonable? | Failure Cause | Notes |
|---|---|---|---|---|---:|---:|---:|---|---|
| CJ001 | PROVISIONAL_BEST_GUESS | Lac de Vouglans | — | Lac de Vouglans; Gorges de l’Ardèche; Gorges du Tarn | NS | NS | Y | GROUND_TRUTH_UNRESOLVED | A 22.5 m jump and wooded, horizontally bedded limestone reservoir fit Vouglans, but no public post or independent same-clip source names it. |
| CJ002 | UNRESOLVED | Marseille multi-location montage (individual clips unresolved) | — | La Vesse; Fort Saint-Jean; Abandoned Piscine de Luminy | NS | NS | Y | GROUND_TRUTH_UNRESOLVED | The source supplies Marseille only; the five exact clip identities proposed by Sol could not be independently tied to the individual montage segments. |
| CJ003 | HIGH_CONFIDENCE_EXACT | Sooke Potholes | — | Sooke Potholes Provincial Park; Wally Creek (Kennedy River); Englishman River Falls Provincial Park | Y | Y | Y | NONE | Distinctive river potholes and cliff geometry match public cliff-jumping media from Sooke; no same-clip naming source was found. |
| CJ004 | VERIFIED_EXACT | Moku Nui | — | Na Mokulua; Queen’s Bath cliff-jumping cove, Moku Nui | N | Y | Y | NONE | The source says Hawaii and tags Kailua and the Mokes; the shortcode is the historical R08 duplicate, and public sources distinguish larger Moku Nui from Moku Iki. |
| CJ005 | HIGH_CONFIDENCE_EXACT | Ponta da Piedade sea-cave complex | — | Ponta da Piedade; Captain's Cave (Gruta do Capitão); Algar da Albandeira | Y | Y | Y | NONE | The source identifies Portugal; golden limestone stacks, arches and grottos match the Ponta da Piedade complex. |
| CJ006 | HIGH_CONFIDENCE_EXACT | Lido Galomar | — | Lido Galomar | Y | Y | Y | NONE | The source tags Madeira; the built volcanic-rock lido, platforms and pool geometry match Galomar. |
| CJ007 | HIGH_CONFIDENCE_EXACT | Cala Varques | — | Cala Varques; Cala Mitjana; Cala Sa Nau | Y | Y | Y | NONE | The source says Mallorca and 13.5 m; independent cliff-jumping media documents the natural arch/ledge at Cala Varques. |
| CJ008 | HIGH_CONFIDENCE_EXACT | Cenote Zaci | — | Cenote Zaci; Cenote Ik Kil; Cenote Xux-Ha | Y | Y | Y | NONE | The source says Mexico and cenote; the large open urban cenote, walls and established jump platform match Zaci. |
| CJ009 | HIGH_CONFIDENCE_EXACT | Waimea Bay Jump Rock | — | Waimea Bay Beach Park | N | N | N | CORRECT_IDENTITY_LOST_BY_CANONICALIZATION | The source tags Hawaii and Oahu; the isolated beach boulder and shore profile match Waimea Bay’s named Jump Rock. |
| CJ010 | UNRESOLVED | Unidentified Mallorca coastal sea hole | — | Unidentified coastal sea cave or blowhole on Mallorca | NS | NS | N | GROUND_TRUTH_UNRESOLVED | The source calls it a secret hole in Mallorca. No public same-clip match or responsibly named exact feature was found. |
| CJ011 | HIGH_CONFIDENCE_EXACT | Makapipi Falls | — | Makapipi Falls; Ching's Pond (Blue Sapphire Pool); Kopiliula Falls | Y | Y | Y | NONE | The source tags Maui, Hana and Road to Hana; the bridge-above-waterfall geometry matches Makapipi Falls below Hana Highway. |
| CJ012 | HIGH_CONFIDENCE_EXACT | Tamolitch Blue Pool | — | Tamolitch Falls (Blue Pool) | Y | Y | Y | NONE | The source says PNW; the exceptionally clear blue pool, forested basalt rim and documented jump height match Tamolitch. |
| CJ013 | HIGH_CONFIDENCE_EXACT | Ching’s Pond (Blue Sapphire Pool) | — | Ching's Pond (Blue Sapphire Pool) | Y | Y | Y | NONE | The source tags Hawaii, waterfall and bridge jumping; Ching’s has the matching highway bridge, concrete platform and turquoise pool. |
| CJ014 | HIGH_CONFIDENCE_EXACT | Spitting Cave | — | Spitting Cave; China Walls | Y | Y | Y | NONE | The source calls the spot iconic; the cave mouth, surge and high ledges match extensive public Spitting Cave cliff-jumping imagery. |
| CJ015 | HIGH_CONFIDENCE_EXACT | Pont d’en Gil | — | Pont d'en Gil; Pont Natural de Cala Varques | Y | Y | Y | NONE | The limestone sea arch, cavern opening and ledges match Pont d’en Gil across independent dive and travel imagery. |
| CJ016 | HIGH_CONFIDENCE_EXACT | The Arch at Pappy’s Point | — | Sunset Cliffs Natural Park | N | N | N | MODEL_WRONG_EXACT_IDENTITY | The source says San Diego; independent local reporting identifies Pappy’s Point and The Arch as the active Sunset Cliffs jump feature, matching the sea-arch scene. |
| CJ017 | HIGH_CONFIDENCE_EXACT | The Crack at Wet Beaver Creek | — | The Crack at Wet Beaver Creek; Bull Pen Swimming Hole on West Clear Creek; Grasshopper Point Swimming & Picnic Area | Y | Y | Y | NONE | The source says Arizona; the narrow red-rock swimming cleft and jumping ledges match The Crack. |
| CJ018 | PROVISIONAL_BEST_GUESS | Embalse de La Toba | — | Embalse de la Toba; Embalse del Portillo; Embalse de Escales | NS | NS | Y | GROUND_TRUTH_UNRESOLVED | The reservoir setting is visually consistent, but the source is generic and no same-clip or creator evidence tied it to La Toba. |
| CJ019 | HIGH_CONFIDENCE_EXACT | Potem Falls | — | Potem Falls; Middle McCloud Falls; Hatchet Creek Falls | Y | Y | Y | NONE | The source states a 72 ft waterfall; public sources describe Potem as a roughly 70 ft single plunge into a broad teal pool matching the scene. |
| CJ020 | HIGH_CONFIDENCE_EXACT | Cenote Maya Native Park | — | Cenote Maya park; Cenote Chukum; Cenote Palomitas | Y | Y | Y | NONE | The source tags Mexico and cenote and states 80 ft; the immense enclosed vault, wooden access and jumping setup match Cenote Maya. |
| CJ021 | UNRESOLVED | Unnamed waterfall on Nahua Expeditions’ Tzotzil route | — | Unidentified jungle waterfall on Nahua Expeditions’ Tzotzil Expedition route; Cascada El Aguacero | NS | NS | N | GROUND_TRUTH_UNRESOLVED | The creator and official itinerary establish the Tzotzil expedition route, but neither publishes a canonical name or coordinates for this waterfall. |
| CJ022 | PROVISIONAL_BEST_GUESS | Area Recreativa El Chantre (Rio Jucar) | — | Área recreativa Chantre; Las Chorreras del Cabriel; Área Recreativa de Cañamares (Río Escabas) | NS | NS | Y | GROUND_TRUTH_UNRESOLVED | The cliff-lined river recreation area is consistent with the footage, but the source is generic and no same-clip proof was found. |
| CJ023 | VERIFIED_EXACT | Bassin la Paix | — | Bassin La Paix | Y | Y | Y | NONE | The original caption explicitly names Bassin la Paix and Reunion; public mapping and waterfall descriptions match. |
| CJ024 | VERIFIED_EXACT | Es Pontas | — | Es Pontàs | Y | Y | Y | NONE | The original caption explicitly names #espontas and Mallorca and states 24 m; government geology mapping identifies the same 20 m sea arch. |
| CJ025 | VERIFIED_EXACT | Fort Lauderdale Aquatic Center | — | Fort Lauderdale Aquatic Center; International Swimming Hall of Fame Aquatic Complex | Y | Y | Y | NONE | The source identifies a High Dive Global 27 m competition and timing; the documented 2024 event used the permanent 27 m Fort Lauderdale tower. |
| CJ026 | PROVISIONAL_BEST_GUESS | Marble River Provincial Park | — | Marble River Provincial Park; Medicine Bowls (Browns River); Three Pools Recreation Area | NS | NS | N | GROUND_TRUTH_UNRESOLVED | The limestone canyon is plausible, but BC Parks says river swimming is not designated and no same-clip or creator location evidence was found. |
| CJ027 | VERIFIED_EXACT | Koosah Falls | — | Koosah Falls | Y | Y | Y | NONE | The original caption explicitly says Koosah Falls and Oregon; public waterfall measurements and imagery match. |
| CJ028 | PROVISIONAL_BEST_GUESS | Koosah Falls | — | Koosah Falls; Sahalie Falls; Lower Lewis River Falls | NS | NS | Y | GROUND_TRUTH_UNRESOLVED | The broad undercut basalt waterfall strongly resembles Koosah, but the source supplies no geographic clue and no same-clip match was found. |
| CJ029 | HIGH_CONFIDENCE_EXACT | Tamolitch Blue Pool | — | Tamolitch Falls (Blue Pool) | Y | Y | Y | NONE | The source states a 57 ft jump into exceptionally blue water; independent cliff-jumping media reports about 54 ft at Tamolitch and imagery matches. |
| CJ030 | HIGH_CONFIDENCE_EXACT | Honeymoon Beach cliff-jumping ledge | — | Honeymoon Beach; Pantai Plix; Tegal Wangi Beach | Y | Y | Y | NONE | The source says Bali; independent Bali cliff-jumping guides identify and map this distinctive ledge at Honeymoon Beach/Jimbaran Panorama Point. |
| CJ031 | HIGH_CONFIDENCE_EXACT | Dorset Marble Quarry | — | Dorset Marble Quarry; West Rutland Marble Quarry (The Deep Hole) | Y | Y | Y | NONE | The source says Vermont and 81 ft/25 m; the flooded white-marble quarry walls match Dorset, which is independently documented for cliff jumping. |
| CJ032 | HIGH_CONFIDENCE_EXACT | Torre Incina at Cala Incina | — | Torre Incina | Y | Y | Y | NONE | The source tags Italy and Polignano a Mare; public local sources document high-rock diving beside Torre Incina and the coastal tower/ledge morphology matches. |
| CJ033 | PROVISIONAL_BEST_GUESS | Waimea Bay Jump Rock | — | Waimea Bay Beach Park; Black Rock (Puʻu Kekaʻa) | NS | NS | Y | GROUND_TRUTH_UNRESOLVED | The boulder and shore geometry match Waimea Jump Rock, but the source contains no geographic clue and no same-clip naming source was found. |
| CJ034 | VERIFIED_EXACT | New River Gorge Bridge | — | New River Gorge Bridge | Y | Y | Y | NONE | The source explicitly tags Bridge Day, New River Gorge and West Virginia; the bridge is unmistakable. This is BASE jumping, not a water cliff jump. |
| CJ035 | PROVISIONAL_BEST_GUESS | The Toilet Bowl at Lake Powell | — | Lake Powell; Lake Powell | NS | NS | N | GROUND_TRUTH_UNRESOLVED | The source identifies Lake Powell and the enclosed slickrock hole is plausible, but public sources use Toilet Bowl/Hole in the Roof inconsistently and publish competing coordinates. |
| CJ036 | VERIFIED_EXACT | Balangan Beach cliffs | — | Balangan Beach cliffs; Tegal Wangi Beach cliffs; Honeymoon Beach cliffs | Y | Y | Y | NONE | The original source explicitly tags Bali, Balangan and Balangan Beach; public cliff-jumping guides describe the same cliffs. |
| CJ037 | HIGH_CONFIDENCE_EXACT | Cascade des Baumes | — | Cascade des Baumes | Y | Y | Y | NONE | The source says a 20 m championship spot near Millau; the tourism office describes the 18 m Cascade des Baumes dropping into the Tarn and public imagery matches. |
| CJ038 | PROVISIONAL_BEST_GUESS | Gunlock Falls | — | Gunlock Falls | NS | NS | Y | GROUND_TRUTH_UNRESOLVED | The stepped red-rock seasonal falls are consistent and independently documented as a cliff-jumping site, but the source supplies no location clue. |
| CJ039 | PROVISIONAL_BEST_GUESS | Escalante Potholes Recreation Site | — | Potholes Recreation Site; Cauldron Linn; White River Falls | NS | NS | Y | GROUND_TRUTH_UNRESOLVED | The carved granite pools fit the BLM-described Escalante Potholes cliff-jumping site, but the source has no location clue and no same-clip match. |
| CJ040 | HIGH_CONFIDENCE_EXACT | Koosah Falls | — | Koosah Falls; Sahalie Falls; Lower Lewis River Falls | Y | Y | Y | NONE | The source tags Oregon/PNW; the 74 ft broad undercut basalt drop and pool match Koosah across multiple public cliff-jumping videos. |
| CJ041 | PROVISIONAL_BEST_GUESS | Cenote Zaci | — | Cenote Zaci; Cenote Ik Kil; Cenote San Lorenzo Oxman | NS | NS | Y | GROUND_TRUTH_UNRESOLVED | The large open cenote and urban masonry are consistent with Zaci, but the source provides no location clue and no same-clip match was found. |
| CJ042 | UNRESOLVED | Three-location montage (individual clips unresolved) | — | Lake Atitlán; Furore Fjord; Ho'opi'i Falls | NS | NS | Y | GROUND_TRUTH_UNRESOLVED | The source asks which jump was favorite but names none. Sol proposed Lake Atitlan, Fiordo di Furore and Ho’opi’i Falls; none was independently tied to a specific segment. |

## G. Unresolved ground truth

### CJ002

- Why unresolved: The source supplies Marseille only; the five exact clip identities proposed by Sol could not be independently tied to the individual montage segments.
- Best researched hypothesis: Marseille multi-location montage (individual clips unresolved)
- Production guesses: none
- Sol guesses: La Vesse; Fort Saint-Jean; Abandoned Piscine de Luminy
- Plausibility: STRONGLY_PLAUSIBLE

### CJ010

- Why unresolved: The source calls it a secret hole in Mallorca. No public same-clip match or responsibly named exact feature was found.
- Best researched hypothesis: Unidentified Mallorca coastal sea hole
- Production guesses: none
- Sol guesses: Unidentified coastal sea cave or blowhole on Mallorca
- Plausibility: WEAK

### CJ021

- Why unresolved: The creator and official itinerary establish the Tzotzil expedition route, but neither publishes a canonical name or coordinates for this waterfall.
- Best researched hypothesis: Unnamed waterfall on Nahua Expeditions’ Tzotzil route
- Production guesses: none
- Sol guesses: Unidentified jungle waterfall on Nahua Expeditions’ Tzotzil Expedition route; Cascada El Aguacero
- Plausibility: WEAK

### CJ042

- Why unresolved: The source asks which jump was favorite but names none. Sol proposed Lake Atitlan, Fiordo di Furore and Ho’opi’i Falls; none was independently tied to a specific segment.
- Best researched hypothesis: Three-location montage (individual clips unresolved)
- Production guesses: none
- Sol guesses: Lake Atitlán; Furore Fjord; Ho'opi'i Falls
- Plausibility: PLAUSIBLE

## H. Free → Sol recovery

Free failures tested: 42
Strict scorable cases recovered by canonical Sol: 26/28
Specific-or-exact cases recovered across all 42: 36/42
Recovery percentage: 85.7%

## I. Failure causes

Production: acquisition 0; frames 1; evidence-too-weak 41; descriptor-only 0; broad geography 0; wrong identity 0; ranking 0; canonicalization 0; technical 0.
Simple Sol on the strict denominator: acquisition 0; frames 0; descriptor-only 0; broad geography 0; wrong raw identity 1; ranking 0; canonicalization-at-top3 1; technical 0. The 14 non-scorable cases remain ground-truth-limited.

## J. Accuracy-max

Executed: YES
Architecture: Composite: SIMPLE_SOL F1:M1 baseline plus F2:M2 dense-frame, native-web escalation on 14 initially weak cases (13 remain unscored; CJ016 was independently promoted to HIGH_CONFIDENCE_EXACT after the blind run).
Raw Sol Exact@3: 28 / 28
Canonical Exact@3: 26 / 28
Reasonable@3: 38 / 42
Remaining strict canonical misses: CJ009, CJ016

Dense-frame web Sol recovered the raw exact identity for CJ016, but canonicalization broadened it back to the park. Results on provisional/unresolved cases remain plausibility evidence and cannot increase the strict Exact@k numerator without new external ground truth.

## K. Recommended recognition architecture

1. Keep normal recognition as a fast evidence collector and explicit-name resolver, not as the final cliff geolocator.
2. Automatically escalate when the free result is empty, generic, broad, divergent, or below exact-feature confidence. That rule escalates all 42 cases here.
3. Preserve 12–15 temporally diverse frames before perceptual dedupe; never collapse a dynamic clip to two near-duplicate endpoint frames without a second selection pass.
4. Run GPT-5.6 Sol with caption, hashtags, transcript, OCR, creator metadata and frames; request three exact physical-feature hypotheses with coordinates and bounded evidence.
5. Add web/same-content retrieval only after a weak first Sol pass, especially for montages and unnamed features. Treat web results as evidence, not truth.
6. Verify candidate morphology and geography, then rank a candidate family before canonicalization.
7. Make natural-feature canonicalization specificity-preserving: a broader park, lake, island group, beach or region must not replace a named jump rock, ledge, cave, pool, falls or individual island.
8. If map providers lack the natural feature, retain the Sol identity and coordinates as a named lead; do not collapse upward to a broad parent.
9. Autosave only independently corroborated exact identities. Present uncertain top three for confirmation; never autosave descriptors or broad geography.

See `recommended-architecture.md` for the implementation contract.

## L. Product requirement

Can current Nearr get effectively every cliff-jumping spot into top 3? **NO**
Can Simple Sol? **NO** — raw 27/28, but canonicalization and an exact-feature miss reduce final exact results.
Can Auto Deep? **NO**
Can Accuracy Max? **NOT YET PROVEN**

## M. Cost

Ground-truth research API spend: not measurable in available tool telemetry.
Production Free inference: not instrumented.
Simple Sol measured model estimate: $3.077452.
Accuracy-max measured model estimate: $6.797951.
Web-search tool charges, if any: not emitted.

## N. Latency

Production Free: P50 15661 ms; P95 24972 ms; max 66677.07373046875 ms (file-completion timestamps).
Simple Sol: P50 42077 ms; P95 132934 ms; max 156499 ms.
Accuracy-max escalations: P50 141174 ms; P95 236155 ms; max 236155 ms.

## O. Production

Mutations: NONE
Deployments: NONE

## P. Final state

Branch: research/cliff-jumping-exact-location
Final HEAD: supplied in the committed-run handoff; use `git rev-parse HEAD`
Clean: verified after commit

## Q. Final verdict

42-VIDEO CLIFF BENCHMARK COMPLETE — ACCURACY GAP REMAINS

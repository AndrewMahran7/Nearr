# Adaptive frame selection — experimental

The current isolated strategy uses at most 24 source-time probes over the entire
retained timeline. It keeps the first and last samples, measures adjacent 64-bit
perceptual-hash changes, and selects one frame from each temporal stratum.

Low-diversity video receives six frames, moderate diversity twelve, and high diversity
twenty-four. Explicit itinerary/multiple-place source wording may increase coverage;
it never proves that multiple places are depicted. Adaptive strata survive deduplication.
Source labels, place identities and benchmark categories are not selection features.

This implementation measures scene changes and perceptual diversity. It does not yet
claim learned landmark salience, image embeddings or sharpness/OCR salience. Sub-probe
transients can be missed. Full timeline annotation remains separate and denser.

Tests cover long and irregular timelines, endpoints, increasing scene diversity,
source hints, ordering and small budgets. Runtime defaults remain unchanged.

The earlier uniform-six pilot was faster on five development cases but introduced a
confident wrong destination. The adaptive strategy is now being measured separately.
No frame strategy is approved for integration from those five-case results.

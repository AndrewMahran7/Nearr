# Recommended cliff-location recognition architecture

This recommendation is based only on the 42-case founder corpus.

- **Normal/free role:** acquire media, preserve captions/hashtags/location tags, transcribe/OCR, resolve explicit exact names, and detect weakness. It must not return success merely because it recognized an activity or broad area.
- **Automatic escalation:** invoke Sol when top three are empty, descriptor-only, broad geography, a parent feature rather than the jump feature, mutually inconsistent, or unsupported by explicit evidence. All 42 free results in this run qualify.
- **Frames:** retain 12–15 diverse temporal frames, require action/context/landmark coverage, and trigger a second pass when perceptual dedupe leaves fewer than six useful frames.
- **Sol:** first pass without web, high reasoning, three exact feature hypotheses. Second pass with dense frames and web/same-content discovery only for weak or conflicting output. Use independent calls/ensemble for montage segmentation.
- **Verifier/ranker:** verify each hypothesis against source geography, morphology, structures and coordinates. Rank exact feature identity above map-provider popularity.
- **Natural features:** maintain parent-child aliases (Jump Rock → Waimea Bay → park) without replacing the child. A canonical parent may annotate, never overwrite, the exact jump feature.
- **Coordinate fallback:** preserve a model/research coordinate and named lead if Google Places has no exact natural-feature entity; show uncertainty and radius.
- **Autosave:** only an exact, specificity-preserved identity with independent corroboration may autosave. Provisional and unresolved results require user confirmation.

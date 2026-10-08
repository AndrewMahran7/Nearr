# Selective OCR experiment

**Actual local OCR ran; it is not enabled in recognition.** EasyOCR 1.7.2 (Apache-2.0 code) was a practical alternative to a new Paddle installation because PyTorch/CUDA were already available. The official interface returns polygon, text and reading confidence; that confidence does not establish what role the text plays in the video. [Official EasyOCR repository](https://github.com/JaidedAI/EasyOCR).

[OCR_PLAN.json](OCR_PLAN.json) froze ten inputs before inference: six generated text/role controls and four real frames. The controls are readable signs, a menu, a promotional overlay, PRADA on a simple shirt shape, and a blank frame. They are **synthetic text-reading controls**, not place labels or evidence of real-scene recognition accuracy. Real frames come from an existing locally bundled Mad Yolks fixture (0s,4s), and cached public Griffith Observatory and Dettifoss videos (4s). No real expected OCR text was invented, and their outputs remain unadjudicated.

All **6/6 controls** exactly matched their supplied text (including the blank negative). The PRADA clothing control received reading confidence approximately **1.000**, and the promotional overlay **0.992**. This is a concrete reason that a high-confidence OCR string must still pass entity-role, scene attribution and geography safeguards.

| Input | Regions | Latency | What was observed |
|---|---:|---:|---|
| Storefront control | 1 | 1,085ms | HARBOUR CAFE; first inference includes warmup |
| Street sign control | 1 | 128ms | WILLOW STREET |
| Menu control | 1 | 160ms | SOUP SALAD COFFEE |
| Social overlay control | 1 | 118ms | BEST CAFE IN TOWN |
| Clothing brand control | 1 | 128ms | PRADA; reading confidence is not venue identity |
| Blank control | 0 | 85ms | No detected text |
| Mad Yolks 0s | 3 | 213ms | Promotional text and SANTA CRUZ; one reading misspells SANDWICHES |
| Mad Yolks 4s | 12 | 392ms | Promotional text, low-confidence background fragments, partial MAD |
| Griffith 4s | 0 | 78ms | No detected text in this selected frame |
| Dettifoss 4s | 0 | 90ms | No detected text in this selected frame |

This sample does **not** show independent OCR recovers the complete restaurant name, improves autonomous resolution, or replaces a deep call. It does show local text extraction is feasible and produces both usable geography and irrelevant/noisy fragments. The empty real-frame results are not proof that their source videos lack text.

Hardware: RTX 3050 laptop GPU 6GiB; Python3.12.7, PyTorch2.5.1+cu121. Engine/model initialization including two downloads: **4.892s**. Peak allocated tensor memory: **518,467,072 bytes (~494MiB)**; this excludes CUDA context and other process memory. Detector83,152,330 bytes; English recognizer15,143,997 bytes. Exact hashes are recorded in [ocr_pilot_results.json](ocr_pilot_results.json). Model weights are isolated under ignored `.tmp/ocr-pilot/models`; no GPU service or infrastructure was provisioned.

The evaluation adapter [selectiveOcrPilot.py](../../scripts/eval/selectiveOcrPilot.py) preserves source/frame SHA256, timestamp, normalized polygon, raw text and confidence. It runs only the frozen selected inputs. Runtime `OcrSegment` was not expanded and `NoopOcr` remains the live default. There is no source/answer cache write. Before integration, add evidence IDs and region provenance to the OCR contract, select frames using predeclared weak-metadata/ambiguity/text-detector conditions, and evaluate both positive venue signs and overlays/menus/clothing across languages. Repeated OCR and model paraphrases of the same pixels must share provenance and cannot count as independent corroboration.

Source provenance for the existing Mad Yolks fixture is documented in `onboarding-authentic-fixtures-phase2-auth/ONBOARDING_FIXTURE_MEDIA_AUDIT.md`; this pilot does not assert a new redistribution license. Griffith CC0 and Dettifoss CC BY2.0 source pages are retained in [media_manifest.json](media_manifest.json). Only text results, hashes and code are committed. No new permanent reference corpus is created. Exact paid experiment spend: **$0.00**.

# Sparse local OCR evidence

This isolated tool reads neutral `input.json` and its numbered JPEGs. It never reads a manifest, truth labels, source URLs, caches, split records or creator evidence for OCR selection. It writes a separate immutable sidecar and does not modify the input or canonical dataset. It does not call a paid service or install/download an OCR model.

```powershell
python -X utf8 scripts/gold-dataset/localOcr.py --probe
python -X utf8 scripts/gold-dataset/localOcr.py --input PRIVATE/input.json --out PRIVATE/ocr-sidecar.json
python -X utf8 scripts/gold-dataset/localOcr.test.py
```

The development machine has Windows.Media.Ocr with `en-US` installed. Other requested languages fail explicitly. The tool needs the existing Python Pillow, NumPy and OpenCV packages and Windows PowerShell 5.1. `--probe` needs only Python and Windows PowerShell. The [Microsoft RecognizeAsync API](https://learn.microsoft.com/en-us/uwp/api/windows.media.ocr.ocrengine.recognizeasync) reads a software bitmap using the selected recognizer language.

Selection first probes at most 32 uniformly spaced source-time targets, including the first and final retained timestamps. Source-time targets avoid overrepresenting densely sampled edit boundaries. A cheap connected-component and horizontal-glyph-alignment score ranks likely text regions. Temporal-bin winners are considered before other candidates, exact pixel-file duplicates are suppressed, and at most eight frames receive OCR. Blank/low-salience frames can result in zero OCR calls. Limits are configurable using `--max-probes`, `--max-frames` and `--min-salience`; every actual configuration is recorded and hashed. The score estimates text-like structure, not location relevance or OCR confidence.

Each sidecar contains:

- Parent input hash, neutral input ID/view, sampled indices, original frame hashes and source timestamps.
- Per-frame text, line/word boxes in original image pixels, text angle and decode/OCR elapsed time; deduplicated lines retain their observed timestamps.
- Engine name, language, Windows build, engine DLL version/hash, configuration/tool/helper hashes, selector dependency versions, non-identifying host processor/architecture/logical-CPU count and total/process/selection timings. Windows OCR does not expose its actual execution-device choice.
- A distinct skipped status when no frame passes selection. Empty text is an OCR observation; it is not proof that a source has no text or no identifiable place.

Windows OCR does not expose word confidence; values remain null. Its language-model weights are not exposed by this API, so the DLL hash is not a complete model-weight fingerprint. Sparse probes may miss brief signs; the heuristic can mistake natural texture for glyphs or miss stylized/small/non-English writing. Repeated lines are deduplicated for convenience while full per-frame observations remain. OCR text is untrusted source content and must never be treated as instructions, verification evidence, or a place identity by itself.

Use this as a separately named OCR evidence ablation. Adding the sidecar to an inference adapter is an explicit later configuration choice; the tool does not silently alter FULL, VISUAL_ONLY, masked views or an existing baseline. Keep the sidecar private. TEXT_ONLY is rejected, and output files must be outside the neutral input directory.

Synthetic tests exercise actual Windows OCR on a generated reading control, sparse late-timeline coverage, blank-frame skipping, budgets, exact-frame deduplication, input/path/modality validation, explicit language failure, metadata non-forwarding, immutability and source-byte mutation detection. They establish tool behavior, not venue-recognition accuracy.

# OCR experiment — supporting evidence, not identity authorization

Windows local OCR is available in English. The tool probes at most 32 temporal
positions, ranks text-like structure, and recognizes at most eight selected frames.
Receipts bind input/frame hashes, timestamps, word boxes, engine version and timing.
Source media and canonical inputs remain unchanged. No paid OCR service was called.

| Split | Inputs | Retained frames | Probed | OCR frames | Frames with text | Mean local stage |
|---|---:|---:|---:|---:|---:|---:|
| Development | 112 | 2,604 | 1,363 | 647 | 367 | 4.135 s |
| Calibration | 34 | 1,236 | 692 | 243 | 117 | 4.193 s |

The serial batch consumed 646.887 seconds including orchestration and source-integrity
checks. OCR stage totals are 605.735 seconds. These are local Windows timings, not
Railway CPU forecasts. Confidence values are unknown because this API does not expose
them. Sparse English OCR can miss brief, stylized, small or non-English signage.

The isolated five-case OCR inference pilot resolved 2/4 exact positives autonomously
but added one wrong or unverified confident output. Its $0.317244 provider tariff
excludes local compute; retained-sidecar inference latency excludes the original OCR
generation. It is rejected as a standalone replacement.

An exploratory literal-name audit of all prepared sidecars finds matches to retained
candidates in 20 development inputs and two calibration inputs. Matches include an
incorrect parent venue and incomplete multi-place sets. Text occurrence is therefore
not sufficient authorization. No OCR-based review promotion is implemented or deployed.

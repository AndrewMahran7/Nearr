# ASR routing experiment

Status: isolated development pilot complete; no ASR change selected for integration. The sealed holdout remains unused.

The five-case paired pilot contains four audio tracks and one silent source. Local Whisper medium and base.en ran on the existing RTX 3050 6 GB laptop GPU. Checkpoints, audio bytes, settings, transcripts and preparation times have private hash receipts. Neither local run made paid requests; electricity and hardware cost are unpriced.

| Local model | Four audio inference times | Total inference time | Cold model load |
|---|---|---:|---:|
| medium | 10.959, 1.051, 22.558, 1.142 s | 35.710 s | 6.708 s |
| base.en | 3.888, 0.305, 6.640, 0.254 s | 11.087 s | 1.159 s |

These are measured local inference times, excluding extraction and cold loading. They are not production job latency. The narration supplies useful venue and street evidence; medium retains the street spelling more accurately. Both models emit generic closing phrases for the three music tracks. A speech detector also scores music highly, so a speech-positive flag alone is insufficient permission to transcribe or trust the transcript.

The live recognition pilot with medium transcripts cost $0.3936291 across 17 provider requests and correctly resolved 1/4 exact-positive cases autonomously, with no wrong or unverified autonomous output. The paid Whisper pilot cost $0.34854842 across 20 requests and resolved 1/4, with one wrong or unverified autonomous output. These totals include the downstream recognition and Places work; they are not ASR-only prices. Both pilots still failed the one negative case. Each has only five cases, and stochastic downstream differences prevent attributing all output changes to transcription.

The base.en transcripts have not received a separate paid recognition run. Faster local decoding alone does not demonstrate preserved exact identity. There is no evidence here for replacing the production ASR model or automatically enabling ASR on every input.

The experiment adapter supports retained transcripts, fresh metered OpenAI transcription, and hash-verified local transcript sidecars. Local extraction, model loading and transcription times are reported separately. The paid local-ASR recognition pilot reads a retained transcript; its inference latency is not a fresh audio-to-result latency. Source lineage, extraction and transcription receipts are private; names and source URLs are not committed. No transcription receives gold labels.

A future selective lane should require missing useful text plus credible speech evidence, reject boilerplate and music artifacts as identity support, and measure added correct autonomous resolutions against extraction and decoding time. Such a policy has not passed calibration, so it remains experimental. Existing retained transcripts remain legitimate input; their historical acquisition cost is outside this retained-evidence benchmark.

# Recognition Regression V2 Artifacts

This directory is the shared fixture and result store for strict backend place-recognition regression.

- `corpus.json`: five-domain category overlay and deterministic contract controls. It deliberately contains no answers.
- `cliff-corpus.json`: all 42 founder-provided Instagram links. One is the existing `R08`; the other 41 are research-only until independently ground-truthed.
- `ground-truth.json`: post-inference labels, alias/locality/specificity rules, quality levels, and reviewed corrections.
- `contract-replay.json`: deterministic outputs for the Atuh Beach and broad Bali intent controls.
- `baseline.json`: live current-backend per-case and per-category ratchet.
- `deterministic-baseline.json`: frozen replay/CI ratchet, intentionally separate from the stochastic live baseline.
- `latest-results.json` and `latest-live-results.json`: latest full live scorecard.
- `latest-deterministic-results.json`: latest Tier 1 frozen replay scorecard.
- `case-results/`: bounded copies of current failed-case diagnostics.
- `runs/current-live-baseline/`: persisted no-cache live attempts, raw backend outputs, normalized results, and failure artifacts.

Ground truth is loaded only after all inference attempts have been persisted and ranked. Raw transcripts, secrets, and chain-of-thought are not stored here.

Routine deterministic command:

```text
npm run test:recognition-regression
```

Paid live command (with provider credentials and explicit consent):

```text
RECOGNITION_LIVE_CONFIRM_PAID=1 npm run benchmark:recognition-live -- --all
```

Use `--category food|cliff-jumping|hiking|landmarks|travel`. Add `--include-research` to exercise unresolved research cases, including the complete 42-link cliff source. Research cases remain `PROVISIONAL`/`UNSCORED` and cannot inflate release accuracy.

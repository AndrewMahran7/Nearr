# Vayrin Hypothesis-First Hard-Path Benchmark — 2026-08-27

This is a deterministic replay of retained, candidate-blind GPT-5.6 Sol outputs from the frozen production audit. It is not represented as a fresh paid inference run. The implementation recreates the same architectural boundary: hypotheses first, Places second.

## Result

- Benchmark pass: **YES**
- Audit routing: 5 HARD / 3 EASY (62.5% HARD)
- Top-1 exact: 3/8
- Top-1 correct/plausible: 6/8
- Top-3 plausible: 8/8
- Truthful partial/ambiguous: 2/8
- Wrong or obviously wrong top-1: 0
- Simulated wrong autosaves: 0
- Baseline comparison: 6 wins / 2 ties / 0 losses
- R04/R06 good autosaves preserved: YES

| Case | Route | Current frozen top-1 | Hypothesis-first top-1 | New classification | Frozen winner |
|---|---|---|---|---|---|
| R01 | HARD | Cliff Jumping | Cirque de Gens | AMBIGUOUS | BASELINE |
| R02 | HARD | Batteries to Bluffs Trail | La Perouse Bay lava cliffs | CORRECT_PLAUSIBLE | BASELINE |
| R03 | HARD | Chickasaw National Recreation Area | Tamolitch Blue Pool | CORRECT_PLAUSIBLE | BASELINE |
| R04 | EASY | Dorset Marble Quarry | Dorset Marble Quarry | CORRECT_EXACT | TIE |
| R05 | EASY | none | Okere Falls Scenic Reserve | CORRECT_EXACT | BASELINE |
| R06 | EASY | Lake Havasu | Lake Havasu | CORRECT_PLAUSIBLE | TIE |
| R07 | HARD | Ken's Korner Shopping Plaza | Stryn | PARTIAL_BUT_TRUTHFUL | BASELINE |
| R08 | HARD | Moke's Bread & Breakfast | Moku Nui (larger Mokulua Islet) | CORRECT_PLAUSIBLE | BASELINE |

## Economics

- Mean frames per HARD case: 9.6
- Mean retained Sol cost per HARD case: $0.1451
- Total retained HARD cost: $0.7255
- Mean retained HARD latency: 77.7s
- Canonical Places calls implied by retained hypotheses: 9

## Corpus

41 real fixtures: 27 unique labeled Instagram fixtures, 6 verified/public shipping fixtures, and 8 frozen audit cases. Only R01–R08 have comparable retained outputs; the remaining corpus is coverage inventory and is not assigned invented model scores.

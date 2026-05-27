# Share Gold Set Evaluation Summary

- Total rows: 28
- Pass: 14
- Partial: 9
- Fail: 5
- Pass rate: 50.0%

## Pass rate by category

| Category | Total | Pass | Partial | Fail | Pass % |
| --- | ---: | ---: | ---: | ---: | ---: |
| Name + Address | 5 | 4 | 1 | 0 | 80.0% |
| @ + Address | 7 | 6 | 1 | 0 | 85.7% |
| Name or @ Only | 9 | 2 | 3 | 4 | 22.2% |
| Address Only | 3 | 1 | 2 | 0 | 33.3% |
| Restaurant Post / Nothing | 4 | 1 | 2 | 1 | 25.0% |

## Failures by type

| Failure type | Count |
| --- | ---: |
| wrong_place | 2 |
| wrong_country_or_city | 1 |
| compact_handle_name_mismatch | 7 |
| candidate_should_manual_fallback | 1 |
| unknown | 3 |

## Top 10 worst failures

| # | URL | Expected | Actual | Reason |
| ---: | --- | --- | --- | --- |
| 1 | https://www.instagram.com/p/DYPweEqPtWy/ | (none) @ (none) [manual_fallback] | Panera Bread @ 20920 West Roosevelt St, Buckeye, AZ 85326, USA [candidate_picker] | unknown |
| 2 | https://www.instagram.com/p/DTI2vG0jreQ/ | (none) @ (none) [manual_fallback] | Hot Birds @ 580 Auto Center Dr, Watsonville, CA 95076, USA [candidate_confirmation] | candidate_should_manual_fallback |
| 3 | https://www.instagram.com/p/DSYfkivkiOA/ | Taqueria Los Pericos @ Santa Cruz, CA [candidate_confirmation] | Taqueria Los Pericos @ 139 Water St, Santa Cruz, CA 95060, USA [candidate_picker] | compact_handle_name_mismatch |
| 4 | https://www.instagram.com/p/DOXJtDlgcoi/ | Point Market & Cafe @ Santa Cruz, CA [candidate_confirmation] | Pacific Point Market & Cafe @ 302 Pacific Ave C, Santa Cruz, CA 95060, USA [candidate_picker] | compact_handle_name_mismatch |
| 5 | https://www.instagram.com/p/CwRQwIEI7GJ/ | (none) @ (none) [manual_fallback] | Santa Cruz Media @ 215 Storey St, Santa Cruz, CA 95060, USA [candidate_picker] | unknown |

## Recommendations (ranked by impact)

1. **compact_handle_name_mismatch** (7 cases) — Normalize compact handles (no spaces) to spaced candidate names when scoring matches so "paradisedynasty" matches "Paradise Dynasty".
2. **unknown** (3 cases) — Manually review these — current heuristics did not classify the failure mode.
3. **wrong_place** (2 cases) — Audit Places query construction — the agent is picking the wrong establishment. Boost weight of caption-provided venue name and require name+address co-presence in the chosen candidate.
4. **wrong_country_or_city** (1 cases) — Add a region/locality sanity check before accepting Places candidates; reject results whose city/state diverges from the caption-extracted city/state.
5. **candidate_should_manual_fallback** (1 cases) — Tighten candidate_confirmation when evidence is weak (no caption address, low places score) — prefer manual_fallback.

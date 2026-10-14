# Recognition release diff

Branch release/recognition-cost-winner-v1 starts at b30906ba59ad50a2e13ea5956606deb9e1a7fba9. Runtime changes are limited to the worker's optional empty-evidence early REVIEW path and the Edge legacy candidate food/nonfood parent veto, each disabled by default. The candidate's tests and config/type wiring accompany them. See COST_WINNER_BACKPORT_AUDIT.md for exact functions and RECOGNITION_OUTPUT_EQUIVALENCE.md for qualification limits.

No model, prompt, Places provider, source evidence acquisition, autosave threshold, cache policy, database migration, result schema, notification finalizer, client, frontend, monetization or Jev runtime was edited. The Edge index changed only at its import and legacy completion mapping; the v124 notification state machine remains byte-for-byte as in the release base.

Neither flag was enabled anywhere. No application, Edge function, database or Railway deployment occurred. This is a reviewable backport, not a released backend.

# Age eligibility state machine — proposed 1.5 implementation

Server authority is `public.account_age_eligibility`; a missing row means **pending**. Persisted statuses are `adult_self_declared`, `under_18`, and `revoked`. The client additionally renders `loading` and `error`, neither of which authorizes live recognition. The method is `self_declaration` or `administrative`, not independently verified age. Policy version and decision timestamps are recorded.

`pending → adult_self_declared` and `pending → under_18` are made only through `declare_age_eligibility_18_plus(boolean)` for the JWT subject. The same answer is idempotent. A conflicting second answer fails with `age_decision_locked`; an underage or revoked account cannot self-upgrade. Administrative restriction/reassessment would require a separately reviewed operator procedure; there is no client transition for it.

The one-time V2 anonymous-to-permanent transfer copies a source adult declaration only when the destination has no decision. The destination's existing restriction wins. A missing, malformed, or unavailable server answer is ineligible. This is account-bound self-attestation, not an age-verification guarantee; creating a different account remains a possible evasion and is an unresolved assurance question.

The Development schema migration is `supabase/migrations/20261018000001_adult_age_eligibility.sql`; `20261018000002_adult_dispatch_transition_guard.sql` also denies ineligible claims of pre-existing queued rows. Existing users were **not** bulk-marked adult. As of 2026-10-18, the Nearr-Dev post-migration aggregate was 42 pending, zero adult and zero underage; rollback-contained test declarations persisted zero rows.

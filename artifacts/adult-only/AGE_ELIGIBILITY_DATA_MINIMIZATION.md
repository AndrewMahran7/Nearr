# Age eligibility data minimization

The schema stores only user ID, eligibility status, assessment method, policy version, and assessment/change timestamps. It does **not** ask for birth date, age in years, government identity, biometrics, or parental details. A `true` answer means the account holder declared 18+, not that Nearr independently verified it. An under-18 answer is retained as a restriction rather than inviting repeated guesses.

The owner can read their decision under RLS. Clients cannot directly insert/update/delete the row or ask the arbitrary-user eligibility RPC. Service-role code can ask the boolean eligibility question for a JWT-authenticated caller or a job's stored owner; no raw age evidence is sent to AI providers by this check. Normal account deletion cascades the record with the auth user; no new general retention or deletion deadline is asserted here.

Risks requiring review: account recreation can defeat simple self-declaration; administrator decisions need an audited procedure; ages are not independently assured. Do not call this `age_verified`, log exact answers in analytics, or add identity collection without separate necessity/privacy review.

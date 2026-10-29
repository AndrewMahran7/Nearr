# Terms acceptance implementation

The existing warm themed modal now reads the authoritative `get_my_global_access` decision. Its checkbox starts unchecked, has an accessible checked state, and enables the primary action only after selection. Terms and Privacy links remain available. The copy now distinguishes agreement to Terms from acknowledgement of Privacy in all ten locale files. Light and dark colors reuse the existing theme.

`record_global_terms_and_privacy()` is an authenticated, atomic RPC. It reads the current approved versions server-side and stores both timestamps in `account_processing_permissions`. It refuses unapproved legal text and never writes AI permission. The modal is required for eligible signed-in accounts once `legalApproved` is true; until approval, existing Development account/data access remains available while AI remains blocked. The client refreshes server access after success, and an error keeps the modal visible. `termsAccepted` now requires both current revisions; a stale revision cannot silently count as accepted. The former profile-only acceptance and fail-open read are no longer used at the access gate.

This is source implementation only. The new migration has not been applied to Development or Production. Public legal text remains the old August 2026 revision and must be approved before the flag can open the acceptance RPC.

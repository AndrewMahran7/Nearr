# V2 transfer implementation — locally qualified successor

This supersedes the 2026-10-09 **rejected** candidate. The old SQL remains at `V2_TRANSFER_REJECTED_CANDIDATE.sql` outside deployable migrations. Nothing in this work was applied to Production.

Ordered migrations:

1. `20261009000001_saved_place_source_owner_invariant.sql`: assert no historical mismatch, add `(id,user_id)` parent key and `(saved_place_id,user_id)` child FK with `ON UPDATE CASCADE ON DELETE CASCADE`.
2. `20261009000002_safe_onboarding_account_transfer_v2.sql`: additive begin/complete RPCs and cleanup retention; do not promote the unsafe Development V2 migration.
3. `20261009000003_legacy_transfer_source_preservation.sql`: retain the public V1 RPC contract and fix its unique/duplicate source handling.
4. `20261009000004_converted_source_write_guard.sql`: serialize source association creation against parent locks and reject new A links after conversion.
5. `20261009000005_converted_anonymous_save_write_guard.sql`: serialize A save creation against the onboarding session and reject new A saves after conversion.

V2 requires anonymous authentication and a 64-character random secret to begin. The secret is stored only as SHA-256 in the grant. Completion requires a non-anonymous destination and a pending, unexpired grant; a completed grant replays only to the same destination. The RPC locks the grant/session and relevant saves/sources, rejects active or unrelated dependent work and ambiguous metadata/reminder merges, then applies all changes in one transaction.

For a unique save, it updates the parent owner; PostgreSQL cascades every child owner in the same statement. Relationship IDs, save ID, source identities, and provenance fields persist. For a duplicate destination save, it retains A's save/link graph, preserves B's authored fields and existing source links, copies only missing source identities to B, and aborts if any copy is missing or a metadata/reminder conflict cannot be safely resolved. It remaps only eligible terminal job/task history and returns a stable result. The cleanup candidate function excludes A while retained relationships or work exist.

The FK makes a committed owner mismatch impossible for supported writers, including legacy and service-role writers. The later two guards address the separate *missing-at-destination* race on a retained duplicate A graph and on a newly created A save. Their lock order is exercised by real two-session tests. No recognition model, Railway code, or unrelated backend behavior was changed.

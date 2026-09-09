-- HISTORY MARKER ONLY. DO NOT ADD SCHEMA CHANGES HERE.
--
-- Development already records version 20260908000001 for the original
-- qualification_fresh migration, while current main did not contain that file.
-- Supabase migration reconciliation is version-based, so this inert marker
-- acknowledges the existing ledger row without replaying historical SQL or
-- falsely changing its status. The inspected intended object delta is encoded
-- only by the new forward migration:
--   20260909000001_canonical_development_recognition_baseline.sql
--
-- On an environment that does not already record this version, applying this
-- file intentionally makes no schema change.

select 1;

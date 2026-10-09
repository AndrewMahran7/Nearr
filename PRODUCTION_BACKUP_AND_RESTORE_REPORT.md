# Production backup and restore rehearsal — 2026-10-08

Status: **database logical backup restored successfully; release remains BLOCKED** by a pre-existing saved-place-source ownership mismatch and unproven transfer/security/client gates. No Production mutation was made.

## Source and scope

- Supabase Production project: `rlqvxdwtetxsqxhqztkw`.
- Managed backup inventory at audit: `pitr_enabled=false`, `walg_enabled=true`, `backups=null`; no managed restore point could be established. No plan/billing change was made.
- Official Supabase CLI `db dump` captured schema and then a single-snapshot data dump for `auth,public,storage` on 2026-10-08, approximately 23:31–23:34 UTC. The two dumps are not one shared schema/data snapshot; this task performed no schema migration during the interval, and both loaded together successfully. Concurrent external DDL was not independently excluded.
- Scope includes profiles, saves, saved-place sources, jobs/results/tasks, onboarding/transfer, notification tables, auth linkage, functions/policies, and storage *database metadata*. It does **not** contain storage object bytes or platform-managed infrastructure outside the three schemas. Storage metadata contained 1,491 rows. Media-object recovery requires a separate storage inventory/backup.

## Protected artifact

- Directory: `C:\Users\andre\AppData\Local\NearrBackups\2026-10-08-nearr-15-predeploy` (not in Git). ACL grants FullControl only to the current Windows account and SYSTEM.
- Primary archive: `nearr-prod-predeploy-strong.7z`, 6,076,113 bytes, SHA-256 `6680880694350352549680C513A548E1689CA3F079DF7C87FC3A860041591474` after the forensic re-extraction and re-archival. `7z t` passed again; the contained SQL hashes below are unchanged.
- Earlier redundant encrypted archive: `nearr-prod-predeploy.7z`, 5,979,905 bytes, SHA-256 `82360416AF09E770C0AACEC209E07FE8D95444DBB21E6B80B3442DDF4D77DD76`. It was overwritten with a verified strong-key encrypted copy before retention; it is **not** the initial weak-key archive.
- Both use 7-Zip encrypted-header AES-256 with a cryptographically random 48-byte passphrase. `archive-password.dpapi` holds the passphrase encrypted for this Windows user/machine. Do not commit, transmit, or print the archive/key. This machine-bound key and local-only placement limit disaster recovery if this computer/account is lost; arrange an approved off-device encrypted backup and key escrow before treating this as long-term protection.
- Original `schema.sql` SHA-256 `0A9C647194B6FA98225DF09FCB62930417BDCF817EFD6601CE28F1323FBC99E3`; `data.sql` SHA-256 `E08B2B7D1AB4450F3B21E86222808AEA1219EBB8C722AC71415123B6AFEE5BED`. Both are inside the encrypted archive. Temporary plaintext dump/extraction files were removed by 7-Zip `-sdel` after archive verification; local restore databases were dropped and the local PostgreSQL server stopped. This does not claim forensic secure erasure of free space.
- For the later read-only forensic pass, the archive was re-extracted, hashes matched, and the same schema/data were successfully restored again into an isolated UTF-8 PostgreSQL database. After the local-only RLS/repair/merge tests, that database was dropped, PostgreSQL stopped, and extracted plaintext files were re-archived with `-sdel`. The encrypted `ownership-anomaly-ids.dpapi` map contains exact internal IDs for a future reviewed repair; it is outside Git and accessible only to this Windows account.

## Rehearsal and verification

1. `7z t` passed. Decrypt/extract in the restricted directory reproduced both original file SHA-256 hashes exactly.
2. `schema.sql` loaded with `ON_ERROR_STOP=1` into an isolated local PostgreSQL 18 UTF-8 database after creating only local Supabase role stubs. `data.sql` then loaded with `ON_ERROR_STOP=1`. Both exited successfully. Earlier local attempts using the Windows-1252 cluster default failed on UTF-8 text and were discarded; the successful database explicitly used UTF-8.
3. Restored counts matched the read-only Production sample: `auth.users=105`, `profiles=105`, `saved_places=627`, `saved_place_sources=545`, `share_jobs=903`, `notification_events=337`, `storage.objects=1491`.
4. Referential checks: profiles without auth users `0`; saves without profiles `0`; sources without saves `0`; share-job/save owner mismatches `0`; notification/save owner mismatches `0`.
5. **Exception:** one `saved_place_sources.user_id` differs from its `saved_places.user_id`. A separate read-only Production query confirmed the same count of `1`; this is pre-existing, not a restore artifact. Both related auth users exist. No identifiers or user content were printed. The subsequent read-only forensic investigation classified it as a v1 transfer ownership artifact; see `OWNERSHIP_ANOMALY_FORENSICS.md`. The proposed repair remains unexecuted.

## Recovery procedure and limits

On this same Windows account/machine, recover the DPAPI-protected passphrase, verify the primary archive SHA-256 and `7z t`, extract into an access-restricted directory, create a fresh isolated UTF-8 PostgreSQL database with local role stubs (`supabase_admin`, `supabase_auth_admin`, `supabase_storage_admin`, `dashboard_user`, `anon`, `authenticated`, `service_role`), then run:

```powershell
$env:PGCLIENTENCODING = 'UTF8'
psql -h 127.0.0.1 -p <isolated-port> -U postgres -d <empty-utf8-db> -v ON_ERROR_STOP=1 -f <restricted-extract-dir>\schema.sql
psql -h 127.0.0.1 -p <isolated-port> -U postgres -d <empty-utf8-db> -v ON_ERROR_STOP=1 -f <restricted-extract-dir>\data.sql
```

Repeat the count and ownership checks above. Never print the decrypted passphrase; clear it from process memory after archive use. For an actual Production restore, use Supabase-supported recovery coordination; do **not** replay this dump over a live project without a reviewed incident plan. Storage object bytes and any writes after the snapshot are excluded. This rehearsal proves local database restoration, not a complete hosted-service disaster recovery or a clean Production data invariant.

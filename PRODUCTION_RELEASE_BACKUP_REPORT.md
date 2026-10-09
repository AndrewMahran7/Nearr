# Post-repair Production release backup — 2026-10-09

Status: **fresh encrypted logical backup and isolated restore PASS**. This is the required post-repair, pre-parity database snapshot; it does not authorize a Production migration by itself.

## Capture and protection

- Source: Supabase Production `rlqvxdwtetxsqxhqztkw`, after the single authorized source-owner repair and before any 1.5 schema/Edge parity change. Captured approximately 2026-10-09 19:28–19:31 UTC with the official Supabase CLI `db dump` for `auth,public,storage`: a schema dump followed by one data-only COPY snapshot. The two files are not one shared schema/data transaction; no schema change was made between them, and both restored together successfully.
- Scope includes auth users, profiles, saves and source links, share jobs/results/tasks, onboarding/grants, notifications, policies/functions, and storage *database metadata*. Storage object bytes, external services, and later writes are excluded. Managed backup inventory still showed `pitr_enabled=false`, `walg_enabled=true`, `backups=null`; this local logical backup is not a managed PITR point.
- Primary archive in the restricted local backup directory: `nearr-prod-postrepair-20261009.7z`, 5,967,297 bytes, SHA-256 `374F479210EB19313855C80C9DCE2DB87FBAF0943F35F8377A0DF9DF6D222476`. It has encrypted 7-Zip headers and AES-256 encryption with the previously verified random 48-byte passphrase, recovered via `archive-password.dpapi` for this Windows account/machine. `7z t` passed.
- Redundant verified archive: `nearr-prod-postrepair-restored-20261009.7z`, SHA-256 `9AD855FFF42B6C1FA3966A94FE395E8D5303A09FFEF7B8EB25A54DA2705D157F`. It was made from the extracted primary files with 7-Zip `-sdel` after the restore test; its integrity test passed. The restricted directory and extraction subdirectories grant access only to the current Windows account and SYSTEM. No plaintext `.sql` files remain there.
- Inner `schema.sql` SHA-256 `0A9C647194B6FA98225DF09FCB62930417BDCF817EFD6601CE28F1323FBC99E3` (identical to pre-repair schema); inner `data.sql` SHA-256 `D8562C3235FBB28BB84AD039382CE9DD29184B4DC587D0B807D5CA49A7C65C64`.

## Restore proof

The primary archive decrypted into an ACL-restricted subdirectory, reproduced both inner hashes, and restored with `ON_ERROR_STOP=1` into a fresh isolated PostgreSQL 18 UTF-8 database on local port 55458. Schema and data restores each exited 0. The data-only dump emitted the known circular-FK warning for `places`; the actual restore nevertheless completed without an error.

| Count | Restored | Fresh Production read |
|---|---:|---:|
| `auth.users` / `profiles` | 105 / 105 | 105 / 105 |
| `saved_places` / `saved_place_sources` | 627 / 545 | 627 / 545 |
| `share_jobs` / `notification_events` | 903 / 337 | 903 / 337 |
| `storage.objects` metadata | 1,491 | 1,491 |
| Source/save owner mismatches | **0** | **0** |

The local restored database `nearr_postrepair_20261009` was dropped after isolated V2 tests. The shared local PostgreSQL cluster was left running because it also hosts pre-existing rehearsal databases. The plaintext extracted SQL files were removed through encrypted re-archival and are recoverable from either archive. Neither archive/key has off-device escrow; losing this Windows account or machine could make both unusable. A full hosted recovery would require Supabase-supported coordination and a separate storage-object recovery plan, not direct replay over the live project.

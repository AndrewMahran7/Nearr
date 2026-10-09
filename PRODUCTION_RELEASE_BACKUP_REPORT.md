# Fresh Production logical backup — 2026-10-09 22:24 UTC

Status: **encrypted archive and isolated restore PASS; no Production deployment followed.**

- Project: `rlqvxdwtetxsqxhqztkw`; scopes: `auth`, `public`, and `storage` schema/data metadata. Storage object **bytes** are excluded.
- Archive outside Git: `C:\Users\andre\AppData\Local\NearrBackups\2026-10-08-nearr-15-predeploy\release-backup-20261009-2224\nearr-prod-release-20261009-2224.7z` (6,054,625 bytes).
- Archive SHA-256: `1ADB851412714336490DB98FE2CB74F4701FF0D272D249DDD8F843876776F1CB`.
- 7z AES-256 with encrypted headers. Passphrase is locally DPAPI-protected at the backup root; this is **not** an off-device recovery plan. The archive passed `7z t` and was extracted in a restricted local directory. Inner schema/data SHA-256 values matched originals: `0A9C647194B6FA98225DF09FCB62930417BDCF817EFD6601CE28F1323FBC99E3` / `3A524AC05359CA491B4F23F4FC89A2352BDD2E4DA194DBFDAAA58ACDDF80B783`.
- Restored from the encrypted archive with `ON_ERROR_STOP=1` into isolated local PostgreSQL 18 database `nearr_release_restore_20261009`, using a UTF-8 `template0` database. Schema and data restores passed.
- Restored users/profiles 105/105; saved places/source links 627/545; jobs/notification events 903/337; storage object metadata 1,491; ownership mismatches/orphans 0/0.

The four matching plaintext `schema.sql`/`data.sql` files in the ACL-restricted capture/extract directories remain because the execution policy blocked exact-path removal. Only SYSTEM and the local user have directory access. Do not claim plaintext cleanup completed. Remove those exact verified copies through an authorized mechanism; preserve the encrypted archive. Repeat a fresh backup immediately before any later Production mutation.

## Earlier post-repair snapshot (preserved)

The prior post-repair primary archive `nearr-prod-postrepair-20261009.7z` (captured approximately 19:28–19:31 UTC) remains in the same restricted backup root, SHA-256 `374F479210EB19313855C80C9DCE2DB87FBAF0943F35F8377A0DF9DF6D222476`; redundant verified archive SHA-256 `9AD855FFF42B6C1FA3966A94FE395E8D5303A09FFEF7B8EB25A54DA2705D157F`. Its restore passed with the same representative counts and zero mismatch. Its plaintext extraction files were removed after encrypted re-archival. Both archives depend on a passphrase protected on this Windows machine/account; neither has off-device escrow. The fresh and earlier logical dumps are not managed PITR points or storage-object-byte backups. The schema/data captures are not one shared transaction, although no schema change occurred between them and both restored together.

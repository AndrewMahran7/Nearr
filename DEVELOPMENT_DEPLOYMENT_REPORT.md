# Development deployment report

Date: 2026-09-15
Scope: Development only

## Pre-deployment baseline

| Surface | Verified state |
| --- | --- |
| Git / current Dev source | `497e4f49162ce45a40f351eb6e2f18b9b51a96fa` |
| EAS Development | group `d511f9b0-40bc-4630-ab17-4336932d0147`, runtime `1.4.55`, iOS `01a0a25a-4ad4-74a3-a205-77d0636272ac`, Android `01a0a25a-4ad4-7f65-a9f8-b7804a9ec561` |
| Supabase project | Nearr-Dev `qnfxnmvxpjzfydgudtvs`, `ACTIVE_HEALTHY` |
| Database | `20260910000001`-`000007` applied remotely; `20260914000002` pending after local reconciliation |
| Edge | `process-share-jobs` v140 ACTIVE; `process-share-link` v85 ACTIVE; `create-share-job` v73 ACTIVE; `monetization` v44 ACTIVE |
| Railway Dev worker | deployment `0b9776ae-d9df-4fad-8ff3-9e8b34153a93`, SUCCESS, image `sha256:8f776d128a29b778a928b361d2abb77da85763bc2c6c9e76239bf34bcc16dd3e` |
| Client suspension | `EXPO_PUBLIC_MONETIZATION_ENABLED=false`, `EXPO_PUBLIC_PREMIUM_REQUESTS_ENABLED=false`, `EXPO_PUBLIC_TOKEN_MONETIZATION_ENABLED=false` |
| Edge suspension | SHA-256 values independently match literal `false` for `TOKEN_MONETIZATION_ENABLED`, `PREMIUM_REQUESTS_ENABLED`, `MONETIZATION_DEV_MOCK_ENABLED` |

## Deployment results

Pending final validation and the shared-lane recheck. This section will be finalized with the exact database execution, Edge versions, Railway deployment/image/health, EAS group/update IDs, and post-deployment flag proof.

## Production baseline / no-touch proof

Production EAS remains group `f9a9846f-3643-4644-a05f-a59be8baa1da`, runtime `1.4.55`, commit `ded040465176a193bba8c6921b179b07ef6a9a64`. Production Edge baseline is `create-share-job` v45, `monetization` v19, `process-share-jobs` v123, and `process-share-link` v153, all ACTIVE. Production Railway's current successful image is deployment `6e78ebe9-58f7-4799-a90e-86238a1b14e9`, image `sha256:7c5c4e0c1d6b636cf4d6572b4535c7186cf17f666613e9e9233fc1a87587a571`. No Production mutation is authorized or performed by this branch.

# Physical QA runbook — Development only

Status before physical testing: implemented and automated validation required; not founder-approved.

## PowerShell: inspect and start over LAN

```powershell
Set-Location 'C:\Users\andre\Desktop\Nearr-worktrees\Nearr-worktrees\onboarding-auth-transitions-practice-quality'
git status --short
git rev-parse HEAD
git branch --show-current

# Load the existing local Development environment without printing values.
Get-Content .env.local | ForEach-Object {
  if ($_ -match '^\s*([^#][^=]*)=(.*)$') {
    [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2], 'Process')
  }
}
$required = 'EXPO_PUBLIC_SUPABASE_URL','EXPO_PUBLIC_SUPABASE_ANON_KEY'
$missing = $required | Where-Object { -not [Environment]::GetEnvironmentVariable($_, 'Process') }
if ($missing) { throw "Missing Development variables: $($missing -join ', ')" }

npx expo start --dev-client --lan --clear
```

Do not use `--tunnel` for this run. Keep the iPhone and computer on the same LAN and retain iOS Local Network permission for the Nearr development client.

## Diagnostics

```powershell
npm run test:onboarding-1259-regressions
npm run test:onboarding-phase2-auth-map-hardening
npm run test:auth-deeplink
npm run typecheck
```

In the app, open Settings → Development QA/diagnostics. Look for `[onboarding-transition]`, `practice_save_reconciled`, `auth_route_decision`, and suppressed `actual_navigation` entries. Do not copy callback URLs or credentials into a report.

## Scenario A — fresh Shops journey

Reset with a fresh anonymous QA user. Welcome → Shops → verify the vertical Old Towne shopping demo and matching place/card/copy → tap **Try with a real video** once → verify the exact Country Roads Antiques post opens → Share to Nearr → return → wait/review/save → verify exactly one completion naming the real saved place, then a useful map with normal filters.

## Scenario B — account transitions

First run tutorial-only backup; then separately run backup with a real anonymous save. Each run must show one Google account-selection interaction, one stable authenticated destination, preserved legitimate saves, no auth warning, no temporary Create your map flash, and no Mad Yolks/stale notification merely because the account loaded.

Also test **Already have an account? Sign in** from the first screen. It must not prepare an anonymous transfer and must route an established account directly to its normal map.

Record tap/link/background/display timestamps separately from submission/acceptance/claim/result/client-observation timestamps. Instagram display time is external and must not be reported as Nearr processing latency.

$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$out = Join-Path $taskRoot 'artifacts/global-release/final-production/android'
$build = Get-Content -Raw -LiteralPath (Join-Path $out 'standalone-build.json') | ConvertFrom-Json
if ($build.exitCode -ne 0) { throw 'Successful standalone build required' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($build.apk)
try {
  $configEntry = $archive.GetEntry('assets/app.config')
  $bundleEntry = $archive.GetEntry('assets/index.android.bundle')
  if (!$configEntry -or !$bundleEntry) { throw 'Embedded configuration and JS bundle required' }
  $reader = [System.IO.StreamReader]::new($configEntry.Open())
  try { $config = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
  if ($config.extra.appEnv -ne 'development' -or $config.extra.backendEnv -ne 'development' -or ([uri]$config.extra.supabaseUrl).Host -ne 'qnfxnmvxpjzfydgudtvs.supabase.co') { throw 'Unsafe APK environment' }
  $hash = [System.Security.Cryptography.SHA256]::Create()
  $stream = $bundleEntry.Open()
  try { $bundleHash = [Convert]::ToHexString($hash.ComputeHash($stream)).ToLowerInvariant() } finally { $stream.Dispose(); $hash.Dispose() }
  $apkHash = (Get-FileHash -LiteralPath $build.apk -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($apkHash -ne $build.sha256) { throw 'APK receipt mismatch' }
  $aapt = Join-Path $env:LOCALAPPDATA 'Android/Sdk/build-tools/34.0.0/aapt.exe'
  $badging = & $aapt dump badging $build.apk
  if ($LASTEXITCODE -ne 0) { throw 'aapt inspection failed' }
  $resources = & $aapt dump --values resources $build.apk
  if ($LASTEXITCODE -ne 0 -or !($resources | Select-String -SimpleMatch '1.7-onboarding-date-android-v2')) { throw 'Native runtime resource not found in APK' }
  $report = [ordered]@{
    inspectedAt = (Get-Date).ToUniversalTime().ToString('o')
    sourceSha = $build.sourceSha
    apkSha256 = $apkHash
    bundleBytes = $bundleEntry.Length
    embeddedBundleSha256 = $bundleHash
    appEnvironment = $config.extra.appEnv
    backendEnvironment = $config.extra.backendEnv
    backendHost = ([uri]$config.extra.supabaseUrl).Host
    runtime = $build.runtime
    constantsRootRuntime = $config.runtimeVersion
    constantsPlatformRuntime = $config.android.runtimeVersion
    nativeRuntimeResourceVerified = $true
    version = $config.version
    debuggable = [bool]($badging | Select-String '^application-debuggable')
    package = @($badging | Select-String '^package:|^native-code:|^launchable-activity:' | ForEach-Object { $_.Line })
    assetCount = @($archive.Entries | Where-Object FullName -Like 'assets/*').Count
    testOnlySigning = 'Android debug certificate, release variant; not Store signed'
    manifestAssets = @($archive.Entries | Where-Object FullName -Match 'app.manifest|app.config|index.android.bundle' | ForEach-Object FullName)
  }
  if ($report.debuggable) { throw 'Release-like APK must not be debuggable' }
  $json = $report | ConvertTo-Json -Depth 8
  [System.IO.File]::WriteAllText((Join-Path $out 'apk-inspection.json'), $json + "`n")
  $json
} finally { $archive.Dispose() }

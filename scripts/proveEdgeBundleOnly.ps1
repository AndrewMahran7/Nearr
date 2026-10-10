param(
  [Parameter(Mandatory=$true)][string]$SourceRoot,
  [Parameter(Mandatory=$true)][string]$ProjectRef,
  [string]$FunctionName = 'process-share-jobs'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http
$source = (Resolve-Path -LiteralPath $SourceRoot).Path
$entry = Join-Path $source "supabase/functions/$FunctionName/index.ts"
if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) { throw 'Function entry not found' }

$graphText = & deno info --no-config --sloppy-imports --json ([uri]$entry).AbsoluteUri
if ($LASTEXITCODE -ne 0) { throw 'Deno dependency graph failed' }
$graph = $graphText | ConvertFrom-Json
$files = @($graph.modules | Where-Object { $_.specifier -like 'file:*' } | ForEach-Object {
  ([uri]$_.specifier).LocalPath
} | Sort-Object -Unique)
if ($files.Count -lt 2) { throw 'Unexpectedly small local dependency graph' }

$prefix = $source.TrimEnd([char]'\', [char]'/') + [IO.Path]::DirectorySeparatorChar
foreach ($file in $files) {
  if (-not $file.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $file -PathType Leaf)) {
    throw "Unsafe or missing dependency: $file"
  }
}

$credentialSource = @'
using System;
using System.Runtime.InteropServices;
public class NearrSupabaseCredential {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct CREDENTIAL {
    public UInt32 Flags; public UInt32 Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize; public IntPtr CredentialBlob; public UInt32 Persist;
    public UInt32 AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("Advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true, EntryPoint="CredReadW")]
  public static extern bool CredRead(string target, UInt32 type, UInt32 reservedFlag, out IntPtr credentialPtr);
  [DllImport("Advapi32.dll", SetLastError=true)]
  public static extern void CredFree(IntPtr credentialPtr);
}
'@
Add-Type $credentialSource
$pointer = [IntPtr]::Zero
if (-not [NearrSupabaseCredential]::CredRead('Supabase CLI:supabase', 1, 0, [ref]$pointer)) {
  throw "Supabase CLI credential unavailable: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
}
try {
  $credential = [Runtime.InteropServices.Marshal]::PtrToStructure($pointer, [type][NearrSupabaseCredential+CREDENTIAL])
  $bytes = New-Object byte[] $credential.CredentialBlobSize
  [Runtime.InteropServices.Marshal]::Copy($credential.CredentialBlob, $bytes, 0, $bytes.Length)
  $token = [Text.Encoding]::UTF8.GetString($bytes)
  if (-not $token.StartsWith('sbp_')) { throw 'Unexpected Supabase credential format' }
} finally {
  [NearrSupabaseCredential]::CredFree($pointer)
}

$client = [Net.Http.HttpClient]::new()
$multipart = [Net.Http.MultipartFormDataContent]::new()
try {
  $client.DefaultRequestHeaders.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $token)
  $client.Timeout = [TimeSpan]::FromMinutes(5)
  $metadata = @{ entrypoint_path = "supabase/functions/$FunctionName/index.ts"; name = $FunctionName; verify_jwt = $false } | ConvertTo-Json -Compress
  $multipart.Add([Net.Http.StringContent]::new($metadata, [Text.Encoding]::UTF8), 'metadata')
  foreach ($file in $files) {
    $relative = $file.Substring($prefix.Length).Replace('\', '/')
    $content = [Net.Http.ByteArrayContent]::new([IO.File]::ReadAllBytes($file))
    $content.Headers.ContentType = [Net.Http.Headers.MediaTypeHeaderValue]::new('application/octet-stream')
    $multipart.Add($content, 'file', $relative)
  }
  $url = "https://api.supabase.com/v1/projects/$ProjectRef/functions/deploy?slug=$FunctionName&bundleOnly=1"
  $response = $client.PostAsync($url, $multipart).GetAwaiter().GetResult()
  $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
  if (-not $response.IsSuccessStatusCode) {
    # API errors do not contain credentials, but truncate to avoid accidental sensitive output.
    throw "Bundle-only request failed: HTTP $([int]$response.StatusCode): $($body.Substring(0, [Math]::Min(600, $body.Length)))"
  }
  $result = $body | ConvertFrom-Json
  [pscustomobject]@{
    bundle_only = $true
    project_ref = $ProjectRef
    function = $FunctionName
    local_file_count = $files.Count
    entry_sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $entry).Hash
    response = $result
  } | ConvertTo-Json -Depth 10
} finally {
  $multipart.Dispose()
  $client.Dispose()
  $token = $null
}

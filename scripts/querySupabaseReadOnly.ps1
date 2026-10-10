param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-z]{20}$')][string]$ProjectRef,
  [Parameter(Mandatory=$true)][string]$Sql
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http

$credentialSource = @'
using System;
using System.Runtime.InteropServices;
public class NearrReadOnlyCredential {
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
if (-not [NearrReadOnlyCredential]::CredRead('Supabase CLI:supabase', 1, 0, [ref]$pointer)) {
  throw "Supabase CLI credential unavailable: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
}
try {
  $credential = [Runtime.InteropServices.Marshal]::PtrToStructure($pointer, [type][NearrReadOnlyCredential+CREDENTIAL])
  $bytes = New-Object byte[] $credential.CredentialBlobSize
  [Runtime.InteropServices.Marshal]::Copy($credential.CredentialBlob, $bytes, 0, $bytes.Length)
  $token = [Text.Encoding]::UTF8.GetString($bytes)
  if (-not $token.StartsWith('sbp_')) { throw 'Unexpected credential format' }
} finally { [NearrReadOnlyCredential]::CredFree($pointer) }

$client = [Net.Http.HttpClient]::new()
try {
  $client.DefaultRequestHeaders.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $token)
  $body = @{ query = $Sql } | ConvertTo-Json -Compress
  $content = [Net.Http.StringContent]::new($body, [Text.Encoding]::UTF8, 'application/json')
  try {
    $response = $client.PostAsync("https://api.supabase.com/v1/projects/$ProjectRef/database/query/read-only", $content).GetAwaiter().GetResult()
    $result = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    if (-not $response.IsSuccessStatusCode) {
      throw "Read-only query failed: HTTP $([int]$response.StatusCode): $($result.Substring(0,[Math]::Min(600,$result.Length)))"
    }
    $result
  } finally { $content.Dispose() }
} finally {
  $client.Dispose()
  $token = $null
}

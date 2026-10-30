param([Parameter(Mandatory=$true)][string]$Directory,[Parameter(Mandatory=$true)][string]$File)
$ErrorActionPreference='Stop'
$taskCurrentSid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$taskDirectoryAcl=Get-Acl -LiteralPath $Directory
$taskFileAcl=Get-Acl -LiteralPath $File
if (-not $taskDirectoryAcl.AreAccessRulesProtected) { throw 'Private directory inheritance not protected' }
foreach ($taskAcl in @($taskDirectoryAcl,$taskFileAcl)) {
  $taskRules=@($taskAcl.Access)
  if ($taskRules.Count -ne 2) { throw 'Private credential ACL rule count mismatch' }
  foreach ($taskRule in $taskRules) {
    $taskSid=$taskRule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
    if ($taskRule.AccessControlType.ToString() -ne 'Allow' -or ($taskSid -ne $taskCurrentSid -and $taskSid -ne 'S-1-5-18') -or $taskRule.FileSystemRights.ToString() -ne 'FullControl') {
      throw 'Private credential ACL contains an unexpected principal or rights'
    }
  }
}
Write-Output 'Private ACL verified: current Windows user and SYSTEM only.'

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$taskProcesses = @(Get-Process -Name UV4 -ErrorAction SilentlyContinue | ForEach-Object {
  [PSCustomObject]@{pid=$_.Id; title=$_.MainWindowTitle; project=''}
})
# The window title normally contains the current project. Query WMI only as a fallback.
$taskMissing = @($taskProcesses | Where-Object { $_.title -notmatch '(?i)[a-z]:\\.*?\.uvprojx?' })
if ($taskMissing.Count -gt 0) {
  try {
    $taskCommands = @{}
    Get-CimInstance Win32_Process -Filter "Name='UV4.exe'" | ForEach-Object { $taskCommands[[int]$_.ProcessId] = $_.CommandLine }
    foreach ($taskProcess in $taskMissing) {
      if ($taskCommands[[int]$taskProcess.pid] -match '"([^"]+\.uvprojx?)"') { $taskProcess.project = $Matches[1] }
    }
  } catch { }
}
ConvertTo-Json -InputObject $taskProcesses -Compress

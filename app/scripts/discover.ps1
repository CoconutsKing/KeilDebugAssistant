$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$taskCommands = @{}
try { Get-CimInstance Win32_Process -Filter "Name='UV4.exe'" | ForEach-Object { $taskCommands[[int]$_.ProcessId] = $_.CommandLine } } catch { }
$taskProcesses = @(Get-Process -Name UV4 -ErrorAction SilentlyContinue | ForEach-Object {
  $taskTitle = $_.MainWindowTitle
  $taskProject = ''
  if ($taskCommands[[int]$_.Id] -match '"([^"]+\.uvprojx?)"') { $taskProject = $Matches[1] }
  [PSCustomObject]@{pid=$_.Id; title=$taskTitle; project=$taskProject}
})
ConvertTo-Json -InputObject $taskProcesses -Compress

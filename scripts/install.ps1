$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$bat = Join-Path $root 'scripts\start-arpos.bat'
if (-not (Test-Path $bat)) {
  $bat = Join-Path $root 'scripts\start-pos.bat'
}
if (-not (Test-Path $bat)) {
  throw 'start-arpos.bat tapılmadı.'
}
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  throw 'Node.js tapılmadı. Əvvəl nodejs.org quraşdırın.'
}

$run = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
New-ItemProperty -Path $run -Name 'ArposRestoran' -Value ('"' + $bat + '"') -PropertyType String -Force | Out-Null

$w = New-Object -ComObject WScript.Shell
$desk = [Environment]::GetFolderPath('Desktop')
$lnk = $w.CreateShortcut((Join-Path $desk 'Arpos Restoran.lnk'))
$lnk.TargetPath = $bat
$lnk.WorkingDirectory = $root.Path
$lnk.Description = 'Arpos Restoran (port 3004)'
$lnk.Save()

$startDir = Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs'
$startLnk = $w.CreateShortcut((Join-Path $startDir 'Arpos Restoran.lnk'))
$startLnk.TargetPath = $bat
$startLnk.WorkingDirectory = $root.Path
$startLnk.Save()

Write-Host 'Quraşdırıldı. İş masasında və avtobaşlatmada: Arpos Restoran'
Write-Host ('Qovluq: ' + $root.Path)
Write-Host 'Bir server: port 3004'

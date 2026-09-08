$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$exe = Join-Path $root 'ArposRestoran.exe'
if (-not (Test-Path $exe)) {
  $exe = Join-Path $root 'scripts\start-arpos.bat'
}
$w = New-Object -ComObject WScript.Shell
$desk = [Environment]::GetFolderPath('Desktop')
$lnk = $w.CreateShortcut((Join-Path $desk 'Arpos Restoran.lnk'))
$lnk.TargetPath = $exe
$lnk.WorkingDirectory = $root.Path
$lnk.Description = 'Arpos Restoran'
$lnk.Save()
$startDir = Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs'
$startLnk = $w.CreateShortcut((Join-Path $startDir 'Arpos Restoran.lnk'))
$startLnk.TargetPath = $exe
$startLnk.WorkingDirectory = $root.Path
$startLnk.Save()

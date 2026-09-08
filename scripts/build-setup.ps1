$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$dist = Join-Path $root 'dist'
$app = Join-Path $env:TEMP ('arpos-app-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $dist, $app | Out-Null

$skip = @('node_modules', 'data', 'keys', 'dist', '.git')
Get-ChildItem -Force $root | ForEach-Object {
  if ($skip -contains $_.Name) { return }
  Copy-Item -Recurse -Force $_.FullName (Join-Path $app $_.Name)
}
if (Test-Path (Join-Path $root 'node_modules')) {
  Copy-Item -Recurse -Force (Join-Path $root 'node_modules') (Join-Path $app 'node_modules')
}
New-Item -ItemType Directory -Force -Path (Join-Path $app 'data') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $app 'keys') | Out-Null

$zip = Join-Path $dist 'payload.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $app '*') -DestinationPath $zip
Remove-Item -Recurse -Force $app

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) {
  $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (-not (Test-Path $csc)) {
  throw 'C# kompilyator tapılmadı.'
}

$exe = Join-Path $dist 'ArposRestoran-Setup.exe'
$cs = Join-Path $root 'scripts\ArposSetup.cs'
& $csc /nologo /optimize /target:exe /out:$exe /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll /resource:$zip,payload.zip $cs
if (-not (Test-Path $exe)) {
  throw 'ArposRestoran-Setup.exe yaranmadı.'
}
Remove-Item $zip -Force -ErrorAction SilentlyContinue
Write-Host ('Hazır: ' + $exe)

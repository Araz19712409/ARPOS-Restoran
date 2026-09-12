$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$dist = Join-Path $root 'dist'
$cache = Join-Path $dist 'cache'
$app = Join-Path $env:TEMP ('arpos-app-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $dist, $cache, $app | Out-Null

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) {
  $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (-not (Test-Path $csc)) {
  throw 'C# kompilyator tapılmadı.'
}

$nodeExe = Join-Path $cache 'node.exe'
$nodeVer = 'v22.14.0'
$needNode = $true
if (Test-Path $nodeExe) {
  try {
    $have = (& $nodeExe -v).Trim()
    if ($have -eq $nodeVer) { $needNode = $false }
  } catch {
    $needNode = $true
  }
}
if ($needNode) {
  Write-Host 'Node.exe endirilir...'
  Invoke-WebRequest -Uri ('https://nodejs.org/dist/' + $nodeVer + '/win-x64/node.exe') -OutFile $nodeExe
}

$ver = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$verCs = Join-Path $root 'scripts\ArposVersion.cs'
@"
internal static class ArposVersion
{
    public const string Text = "$ver";
}
"@ | Set-Content -Path $verCs -Encoding ASCII

$ico = Join-Path $root 'scripts\arpos.ico'
if (-not (Test-Path $ico)) {
  throw 'scripts/arpos.ico tapılmadı.'
}

$launcher = Join-Path $app 'ArposRestoran.exe'
& $csc /nologo /optimize /target:winexe /win32icon:$ico /out:$launcher /r:System.Windows.Forms.dll /r:System.Drawing.dll (Join-Path $root 'scripts\ArposLauncher.cs'), $verCs
if (-not (Test-Path $launcher)) {
  throw 'ArposRestoran.exe yaranmadı.'
}

$skip = @('node_modules', 'data', 'keys', 'dist', '.git')
Get-ChildItem -Force $root | ForEach-Object {
  if ($skip -contains $_.Name) { return }
  Copy-Item -Recurse -Force $_.FullName (Join-Path $app $_.Name)
}
Remove-Item (Join-Path $app 'scripts\make-license.js') -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $app 'scripts\license-owner.js') -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $app 'scripts\arpos-icon.png') -Force -ErrorAction SilentlyContinue
Get-ChildItem $app -File | Where-Object { $_.Extension -match '\.(pdf|docx)$' } | Remove-Item -Force -ErrorAction SilentlyContinue
if (Test-Path (Join-Path $root 'node_modules')) {
  Copy-Item -Recurse -Force (Join-Path $root 'node_modules') (Join-Path $app 'node_modules')
}
New-Item -ItemType Directory -Force -Path (Join-Path $app 'data'), (Join-Path $app 'keys'), (Join-Path $app 'runtime') | Out-Null
Copy-Item -Force $nodeExe (Join-Path $app 'runtime\node.exe')

$zip = Join-Path $dist 'payload.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $app '*') -DestinationPath $zip
Remove-Item -Recurse -Force $app

$setup = Join-Path $dist 'ArposRestoran-Setup.exe'
$tmpExe = Join-Path $dist ('ArposRestoran-Setup-' + [Guid]::NewGuid().ToString('N').Substring(0, 6) + '.exe')
$cs = Join-Path $root 'scripts\ArposSetup.cs'
& $csc /nologo /optimize /target:winexe /win32icon:$ico /out:$tmpExe /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll /resource:$zip,payload.zip $cs, $verCs
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $tmpExe)) {
  throw 'ArposRestoran-Setup.exe yaranmadı.'
}
try {
  if (Test-Path $setup) { Remove-Item $setup -Force }
  Move-Item $tmpExe $setup -Force
} catch {
  $setup = Join-Path $dist 'ArposRestoran-Setup-yeni.exe'
  if (Test-Path $setup) { Remove-Item $setup -Force }
  Move-Item $tmpExe $setup -Force
}
Remove-Item $zip -Force -ErrorAction SilentlyContinue
Write-Host ('Hazır: ' + $setup)

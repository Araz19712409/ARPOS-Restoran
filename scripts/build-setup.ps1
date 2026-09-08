$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$dist = Join-Path $root 'dist'
$stage = Join-Path $dist 'stage'
$app = Join-Path $env:TEMP ('arpos-app-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $dist, $stage, $app | Out-Null

$skip = @('node_modules', 'data', 'keys', 'dist', '.git', 'agent-transcripts')
Get-ChildItem -Force $root | ForEach-Object {
  if ($skip -contains $_.Name) { return }
  Copy-Item -Recurse -Force $_.FullName (Join-Path $app $_.Name)
}
if (Test-Path (Join-Path $root 'node_modules')) {
  Copy-Item -Recurse -Force (Join-Path $root 'node_modules') (Join-Path $app 'node_modules')
}
New-Item -ItemType Directory -Force -Path (Join-Path $app 'data') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $app 'keys') | Out-Null

$zip = Join-Path $stage 'payload.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $app '*') -DestinationPath $zip
Copy-Item (Join-Path $root 'scripts\install-payload.bat') (Join-Path $stage 'install-payload.bat') -Force
Remove-Item -Recurse -Force $app

$exe = Join-Path $dist 'ArposRestoran-Setup.exe'
$sed = Join-Path $dist 'arpos.sed'
$stageUnix = ($stage -replace '\\', '\\')
@"
[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=1
HideExtractAnimation=0
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=
DisplayLicense=
FinishMessage=Arpos Restoran qurasdirildi. Lisensiya kodunu daxil edin.
TargetName=$exe
FriendlyName=Arpos Restoran
AppLaunched=cmd /c install-payload.bat
PostInstallCmd=<None>
AdminQuietInstCmd=
UserQuietInstCmd=
SourceFiles=SourceFiles
[Strings]
FILE0="install-payload.bat"
FILE1="payload.zip"
[SourceFiles]
SourceFiles0=$stage\
[SourceFiles0]
%FILE0%=
%FILE1%=
"@ | Set-Content -Path $sed -Encoding ASCII

$iex = Join-Path $env:SystemRoot 'System32\iexpress.exe'
if (-not (Test-Path $iex)) {
  throw 'iexpress.exe tapılmadı.'
}
& $iex /N /Q $sed
if (-not (Test-Path $exe)) {
  throw 'ArposRestoran-Setup.exe yaranmadı.'
}
Write-Host ('Hazır: ' + $exe)

$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$Version = $args | Where-Object { $_ -and $_ -ne '--' } | Select-Object -First 1
if (-not $Version) {
  throw 'Istifade: npm run bump -- x.y.z'
}
if ($Version -notmatch '^\d+\.\d+\.\d+$') {
  throw 'Versiya semver olmalidir (mes. 2.0.15).'
}

function Set-JsonVersion([string]$file) {
  $raw = Get-Content -Path $file -Raw -Encoding UTF8
  $updated = [regex]::Replace($raw, '"version"\s*:\s*"[^"]+"', ('"version": "' + $Version + '"'), 1)
  if ($file.EndsWith('package-lock.json')) {
    $updated = [regex]::Replace($updated, '"version"\s*:\s*"[^"]+"', ('"version": "' + $Version + '"'), 1)
  }
  [System.IO.File]::WriteAllText($file, $updated)
}

Set-JsonVersion (Join-Path $root 'package.json')
$lock = Join-Path $root 'package-lock.json'
if (Test-Path $lock) {
  Set-JsonVersion $lock
}

$verCs = Join-Path $root 'scripts\ArposVersion.cs'
@"
internal static class ArposVersion
{
    public const string Text = "$Version";
}
"@ | Set-Content -Path $verCs -Encoding ASCII

Set-Location $root
node -e "require('./version').ensureAll()"
if ($LASTEXITCODE -ne 0) {
  throw 'version.ensureAll ugursuz.'
}
Write-Host ('Versiya ' + $Version)

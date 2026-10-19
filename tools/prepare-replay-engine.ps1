param([string]$FfmpegPath = $env:NOLYS_FFMPEG)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$targetDirectory = Join-Path $projectRoot 'src-tauri/resources/replay'
$targetBinary = Join-Path $targetDirectory 'ffmpeg.exe'
if (-not $FfmpegPath) {
    if (Test-Path -LiteralPath $targetBinary) { $FfmpegPath = $targetBinary }
    else {
        $available = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
        if ($available) { $FfmpegPath = $available.Source }
    }
}
if (-not $FfmpegPath -or -not (Test-Path -LiteralPath $FfmpegPath -PathType Leaf)) {
    throw 'FFmpeg manque pour le module Replay. Définissez NOLYS_FFMPEG vers ffmpeg.exe, puis relancez npm run prepare:replay.'
}
$resolvedEngine = (Resolve-Path -LiteralPath $FfmpegPath).Path
$filterLines = & $resolvedEngine -hide_banner -filters 2>&1
if ($LASTEXITCODE -ne 0 -or -not ($filterLines -match '\bgfxcapture\b') -or -not ($filterLines -match '\bddagrab\b')) {
    throw 'Ce binaire doit inclure les filtres Windows gfxcapture et ddagrab.'
}
New-Item -ItemType Directory -Path $targetDirectory -Force | Out-Null
if ($resolvedEngine -ne $targetBinary) { Copy-Item -LiteralPath $resolvedEngine -Destination $targetBinary }
$distribution = Split-Path -Parent (Split-Path -Parent $resolvedEngine)
$distributionLicense = Join-Path $distribution 'LICENSE'
if (Test-Path -LiteralPath $distributionLicense) {
    Copy-Item -LiteralPath $distributionLicense -Destination (Join-Path $targetDirectory 'FFmpeg-LICENSE.txt')
}
$version = & $resolvedEngine -version 2>&1
[System.IO.File]::WriteAllLines((Join-Path $targetDirectory 'build-info.txt'), [string[]]$version, [System.Text.UTF8Encoding]::new($false))
$sha = [System.Security.Cryptography.SHA256]::Create()
$inputStream = [System.IO.File]::OpenRead($targetBinary)
try { $hash = [BitConverter]::ToString($sha.ComputeHash($inputStream)).Replace('-', '') }
finally { $inputStream.Dispose(); $sha.Dispose() }
[System.IO.File]::WriteAllText((Join-Path $targetDirectory 'ffmpeg.sha256'), $hash + "  ffmpeg.exe`n", [System.Text.UTF8Encoding]::new($false))
Write-Output "Moteur Replay préparé : $targetBinary"
Write-Output "SHA-256 : $hash"

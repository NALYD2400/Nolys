param([string]$AppRoot = (Split-Path $PSScriptRoot -Parent), [switch]$ModulesOnly)
$ErrorActionPreference = 'Stop'
$AppRoot = (Resolve-Path -LiteralPath $AppRoot).Path
Add-Type -AssemblyName System.Drawing

# L'outil officiel Tauri produit l'ICO multirésolution ; seuls ses exports Windows
# sont copiés dans le projet. Les sources haute résolution restent dans branding/.
if (!$ModulesOnly) {
    $staging = Join-Path $AppRoot ('.impeccable/runtime/brand-icons-' + [Guid]::NewGuid().ToString('N'))
    & node (Join-Path $AppRoot 'node_modules/@tauri-apps/cli/tauri.js') icon (Join-Path $AppRoot 'branding/icon-source.png') --output $staging
    if ($LASTEXITCODE -ne 0) { throw 'Export des icônes Tauri impossible.' }
    foreach ($name in @('32x32.png', '128x128.png', '128x128@2x.png', 'icon.png', 'icon.ico')) {
        Copy-Item -LiteralPath (Join-Path $staging $name) -Destination (Join-Path $AppRoot "src-tauri/icons/$name")
    }
}

function Export-Png([string]$Source, [string]$Destination, [int]$Size) {
    $image = [System.Drawing.Image]::FromFile($Source)
    try {
        $bitmap = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        try {
            $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
            try {
                $graphics.Clear([System.Drawing.Color]::Transparent)
                $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                $graphics.DrawImage($image, 0, 0, $Size, $Size)
            } finally { $graphics.Dispose() }
            $bitmap.Save($Destination, [System.Drawing.Imaging.ImageFormat]::Png)
        } finally { $bitmap.Dispose() }
    } finally { $image.Dispose() }
}

if (!$ModulesOnly) {
    $source = Join-Path $AppRoot 'branding/icon-source.png'
    Export-Png $source (Join-Path $AppRoot 'src-tauri/icons/64x64.png') 64
    Copy-Item -LiteralPath (Join-Path $AppRoot 'src-tauri/icons/128x128@2x.png') -Destination (Join-Path $AppRoot 'src/public/assets/app-logo.png')
}
foreach ($name in @('music', 'replay', 'files', 'timer', 'mic')) {
    Export-Png (Join-Path $AppRoot "branding/module-sources/$name.png") (Join-Path $AppRoot "src/public/assets/modules/$name.png") 128
}
$neutralSources = Join-Path $AppRoot 'branding/module-sources/neutral'
if (Test-Path -LiteralPath $neutralSources) {
    $neutralExports = Join-Path $AppRoot 'src/public/assets/modules/neutral'
    New-Item -ItemType Directory -Path $neutralExports -Force | Out-Null
    Get-ChildItem -LiteralPath $neutralSources -Filter '*.png' | ForEach-Object {
        Export-Png $_.FullName (Join-Path $neutralExports $_.Name) 128
    }
}
if (!$ModulesOnly) { & (Join-Path $PSScriptRoot 'update-brand-assets.ps1') -AppRoot $AppRoot }
Write-Output 'Exports de marque terminés.'

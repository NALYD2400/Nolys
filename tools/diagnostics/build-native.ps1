param([string]$Name = 'nolys-diagnostic')
$ErrorActionPreference = 'Stop'
if ($Name -notmatch '^[a-z0-9-]+$') { throw 'Nom de diagnostic invalide.' }
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$runtime = Join-Path $workspace '.impeccable/runtime'
[IO.Directory]::CreateDirectory($runtime) | Out-Null
$output = Join-Path $runtime ($Name + '.exe')
Push-Location $workspace
try {
    & npm run build:ui
    if ($LASTEXITCODE -ne 0) { throw 'Échec de compilation du frontend.' }
    # Le profil debug est obligatoire : lui seul accepte NOLYS_DEV_DATA_DIR.
    & cargo rustc --locked --manifest-path src-tauri/Cargo.toml --features tauri/custom-protocol --bin liquid-dynamic-island -- -o $output
    if ($LASTEXITCODE -ne 0) { throw 'Échec de compilation du diagnostic.' }
    @{ profile = 'debug'; isolatedData = $true; customProtocol = $true; sha256 = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant(); builtAt = [DateTime]::UtcNow.ToString('o') } |
        ConvertTo-Json | Set-Content -LiteralPath ($output + '.json') -Encoding utf8
    Write-Output $output
} finally { Pop-Location }

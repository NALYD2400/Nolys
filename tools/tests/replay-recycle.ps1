# Opt-in native test: only a uniquely named file created here is recycled, then restored.
$ErrorActionPreference = 'Stop'
$fixtureName = 'Nolys-Recycle-Fixture-' + [Guid]::NewGuid().ToString('N') + '.mp4'
$fixturePath = Join-Path ([IO.Path]::GetTempPath()) $fixtureName
$expected = 'Nolys owned recycle roundtrip fixture'
[IO.File]::WriteAllText($fixturePath, $expected)
$previous = $env:NOLYS_RECYCLE_FIXTURE
Push-Location (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
try {
    $env:NOLYS_RECYCLE_FIXTURE = $fixturePath
    & cargo test --manifest-path src-tauri/Cargo.toml --lib replay::recycle::tests::native_recycle_owned_fixture -- --ignored --exact --nocapture
    if ($LASTEXITCODE -ne 0) { throw 'Native recycle test failed.' }
    $shell = New-Object -ComObject Shell.Application
    $recycleBin = $shell.Namespace(10)
    $stem = [IO.Path]::GetFileNameWithoutExtension($fixtureName)
    $item = @($recycleBin.Items()) | Where-Object { $_.Name -eq $fixtureName -or $_.Name -eq $stem } | Select-Object -First 1
    if ($null -eq $item) { throw 'The owned fixture was not found in the Windows recycle bin.' }
    $item.InvokeVerb('undelete')
    $deadline = [DateTime]::UtcNow.AddSeconds(8)
    while (-not [IO.File]::Exists($fixturePath) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
    if (-not [IO.File]::Exists($fixturePath) -or [IO.File]::ReadAllText($fixturePath) -ne $expected) { throw 'The owned fixture was not restored intact.' }
    # Remove only the restored throwaway file created at the beginning of this test.
    Remove-Item -LiteralPath $fixturePath
    Write-Output 'Windows recycle test passed: owned fixture found in the recycle bin and restored intact.'
} finally {
    $env:NOLYS_RECYCLE_FIXTURE = $previous
    Pop-Location
}

param(
    [ValidateSet('Desktop', 'Window')][string]$Source = 'Desktop',
    [ValidateSet('h264', 'hevc')][string]$Codec = 'h264',
    [int]$Fps = 60,
    [ValidateRange(5,600)][int]$Seconds = 5,
    [switch]$SystemAudio,
    [switch]$Microphone,
    [switch]$MixAudio
)
# Opt-in integration test. Captures to temporary files; does not use personal settings.
$ErrorActionPreference = 'Stop'
$names = @('NOLYS_REPLAY_TEST_AUDIO','NOLYS_REPLAY_TEST_MIC','NOLYS_REPLAY_TEST_FPS','NOLYS_REPLAY_TEST_CODEC','NOLYS_REPLAY_TEST_WINDOW','NOLYS_REPLAY_TEST_MIX','NOLYS_REPLAY_TEST_SECONDS')
$previous = @{}
foreach ($name in $names) { $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
$fixtureProcess = $null
$code = 1
Push-Location (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
try {
    $env:NOLYS_REPLAY_TEST_AUDIO = if ($SystemAudio) { '1' } else { $null }
    $env:NOLYS_REPLAY_TEST_MIC = if ($Microphone) { '1' } else { $null }
    $env:NOLYS_REPLAY_TEST_MIX = if ($MixAudio) { '1' } else { $null }
    $env:NOLYS_REPLAY_TEST_FPS = [string]$Fps
    $env:NOLYS_REPLAY_TEST_SECONDS = [string]$Seconds
    $env:NOLYS_REPLAY_TEST_CODEC = $Codec
    $env:NOLYS_REPLAY_TEST_WINDOW = $null
    if ($Source -eq 'Window') {
        $fixtureScript = Join-Path $PSScriptRoot 'replay-window.fixture.ps1'
        $fixtureProcess = Start-Process -FilePath powershell.exe -ArgumentList @('-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',('"' + $fixtureScript + '"')) -WindowStyle Hidden -PassThru
        $env:NOLYS_REPLAY_TEST_WINDOW = 'Nolys Replay Fixture'
        Start-Sleep -Milliseconds 1200
    }
    & cargo test --manifest-path src-tauri/Cargo.toml --lib replay::engine::tests::native_replay_and_recording -- --ignored --exact --nocapture
    $code = $LASTEXITCODE
} finally {
    if ($fixtureProcess -and -not $fixtureProcess.HasExited) { Stop-Process -Id $fixtureProcess.Id -ErrorAction SilentlyContinue }
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
    Pop-Location
}
exit $code

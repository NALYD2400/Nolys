param([Parameter(Mandatory)][int]$DiagnosticRootProcessId, [int]$IntervalMs = 2000)
$ErrorActionPreference = 'Stop'
while (Get-Process -Id $DiagnosticRootProcessId -ErrorAction SilentlyContinue) {
    $tree = @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId)
    $ownedIds = [Collections.Generic.HashSet[int]]::new()
    [void]$ownedIds.Add($DiagnosticRootProcessId)
    do {
        $changed = $false
        foreach ($item in $tree) {
            if ($ownedIds.Contains([int]$item.ParentProcessId) -and $ownedIds.Add([int]$item.ProcessId)) { $changed = $true }
        }
    } while ($changed)
    $processes = @(foreach ($ownedId in $ownedIds) {
        $process = Get-Process -Id $ownedId -ErrorAction SilentlyContinue
        if ($process) {
            # Un processus WebView peut se terminer entre Get-Process et ses propriétés.
            # Ne pas interrompre une heure de collecte pour cette course normale.
            try {
                $started = $process.StartTime
                if ($null -ne $started -and -not $process.HasExited) {
                    @{ id = $ownedId; started = $started.ToUniversalTime().ToString('o'); cpuSeconds = $process.TotalProcessorTime.TotalSeconds;
                       privateBytes = $process.PrivateMemorySize64; workingSetBytes = $process.WorkingSet64; handles = $process.HandleCount }
                }
            } catch { }
        }
    })
    $gpuAvailable = $true; $gpu3d = 0.0
    try {
        foreach ($engine in (Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine)) {
            if ($engine.Name -match 'pid_(\d+)_.*engtype_3D' -and $ownedIds.Contains([int]$Matches[1])) { $gpu3d += [double]$engine.UtilizationPercentage }
        }
    } catch { $gpuAvailable = $false }
    @{ time = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); processes = $processes; gpuAvailable = $gpuAvailable; gpu3dEnginePercentSum = $gpu3d } |
        ConvertTo-Json -Depth 4 -Compress
    Start-Sleep -Milliseconds $IntervalMs
}

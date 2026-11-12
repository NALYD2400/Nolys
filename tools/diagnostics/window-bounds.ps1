param([Parameter(Mandatory)][int]$DiagnosticRootProcessId)
$ErrorActionPreference = 'Stop'
$process = Get-Process -Id $DiagnosticRootProcessId
if (-not $process.Path.Contains('\.impeccable\runtime\')) { throw 'Processus de diagnostic local requis.' }
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class DiagnosticWindowBounds {
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
}
'@
[void][DiagnosticWindowBounds]::SetThreadDpiAwarenessContext([IntPtr](-4))
$bounds = [DiagnosticWindowBounds+Rect]::new()
if ($process.MainWindowHandle -eq 0 -or -not [DiagnosticWindowBounds]::GetWindowRect($process.MainWindowHandle, [ref]$bounds)) { throw 'Fenêtre de diagnostic absente.' }
@{ x = $bounds.Left; y = $bounds.Top; width = $bounds.Right - $bounds.Left; height = $bounds.Bottom - $bounds.Top } | ConvertTo-Json -Compress

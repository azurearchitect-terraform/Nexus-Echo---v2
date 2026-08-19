# Nexus Echo development process cleanup for Windows.
$ErrorActionPreference = 'SilentlyContinue'
$repoPath = [Regex]::Escape((Resolve-Path $PSScriptRoot).Path)
$processNames = @('node.exe', 'cargo.exe', 'rustc.exe', 'nexus-echo.exe')

Write-Host 'Stopping Nexus Echo development processes...'

$processIds = Get-CimInstance Win32_Process |
    Where-Object {
        $_.Name -in $processNames -and (
            $_.Name -eq 'nexus-echo.exe' -or
            ($_.CommandLine -and (
                $_.CommandLine -match $repoPath -or
                $_.CommandLine -match '@nexus/desktop.+tauri dev'
            ))
        )
    } |
    Select-Object -ExpandProperty ProcessId -Unique

$listenerIds = Get-NetTCPConnection -LocalPort 1420 -State Listen |
    Select-Object -ExpandProperty OwningProcess -Unique

@($processIds) + @($listenerIds) |
    Where-Object { $_ } |
    Sort-Object -Unique |
    ForEach-Object {
        & taskkill.exe /PID $_ /T /F 2>$null | Out-Null
    }

$remaining = Get-NetTCPConnection -LocalPort 1420 -State Listen
if ($remaining) {
    Write-Error 'Port 1420 is still in use. Close the owning process and retry.'
    exit 1
}

Write-Host 'Development processes stopped. You can now run: pnpm dev'

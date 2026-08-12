# Nexus Echo Dev Kill Script
# Run this whenever the dev server gets stuck or before restarting
Write-Host "🔴 Killing all Nexus Echo dev processes..." -ForegroundColor Red

Stop-Process -Name "nexus-echo" -Force -ErrorAction SilentlyContinue
Stop-Process -Name "cargo"      -Force -ErrorAction SilentlyContinue

Start-Sleep -Milliseconds 500

$remaining = Get-Process -Name "nexus-echo","cargo" -ErrorAction SilentlyContinue
if ($remaining) {
    Write-Host "⚠️  Some processes still running: $($remaining.Name -join ', ')" -ForegroundColor Yellow
} else {
    Write-Host "✅ All clear! You can now run: npm run tauri dev" -ForegroundColor Green
}

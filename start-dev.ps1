Set-Location $PSScriptRoot

$port = 5173
$listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($listeners) {
  Write-Host "Stopping existing service on port $port..."
  $listeners | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
    if ($_ -and $_ -ne $PID) {
      Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
    }
  }
  Start-Sleep -Seconds 1
}

Write-Host "Installing dependencies..."
npm install
if ($LASTEXITCODE -ne 0) {
  Read-Host "Install failed. Press Enter to exit"
  exit $LASTEXITCODE
}

Write-Host "Starting Vite dev server..."
npm run dev -- --host 127.0.0.1 --port 5173

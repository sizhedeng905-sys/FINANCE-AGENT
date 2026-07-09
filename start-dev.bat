@echo off
cd /d %~dp0
echo Stopping existing service on port 5173...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$listeners = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue; if ($listeners) { $listeners | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { if ($_ -and $_ -ne $PID) { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }; Start-Sleep -Seconds 1 }"
echo Installing dependencies...
npm install
if errorlevel 1 pause & exit /b 1
echo Starting Vite dev server...
npm run dev -- --host 127.0.0.1 --port 5173
pause

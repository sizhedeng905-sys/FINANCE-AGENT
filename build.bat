@echo off
cd /d %~dp0
echo Installing dependencies...
npm install
if errorlevel 1 pause & exit /b 1
echo Building production package...
npm run build
pause

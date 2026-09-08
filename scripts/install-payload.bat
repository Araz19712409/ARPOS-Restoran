@echo off
setlocal
set DEST=%LOCALAPPDATA%\ArposRestoran
if not exist "%DEST%" mkdir "%DEST%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Force -Path '%~dp0payload.zip' -DestinationPath '%DEST%'"
if errorlevel 1 exit /b 1
powershell -NoProfile -ExecutionPolicy Bypass -File "%DEST%\scripts\install.ps1"
start "" "%DEST%\scripts\start-arpos.bat"
echo Arpos Restoran qurasdirildi.
exit /b 0

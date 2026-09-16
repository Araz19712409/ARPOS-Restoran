@echo off
cd /d "%~dp0\.."
if exist "ArposRestoran.exe" (
  start "" "ArposRestoran.exe"
  exit /b 0
)
if exist "runtime\node.exe" (
  start "" /min "runtime\node.exe" server.js
) else (
  start "" /min node server.js
)
rem Brauzeri login-da avtomatik acma ? donmanin bir sebebini azalt
exit /b 0

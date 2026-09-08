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
start "" http://127.0.0.1:3004/orders.html

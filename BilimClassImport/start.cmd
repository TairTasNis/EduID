@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js 20+ is required. https://nodejs.org/
  goto done
)
node importer.mjs %*
:done
set "result=%errorlevel%"
echo.
pause
exit /b %result%

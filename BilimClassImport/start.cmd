@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js 20+ is required. https://nodejs.org/
  goto done
)
if not exist "node_modules\playwright-core\package.json" (
  call npm.cmd ci --ignore-scripts --no-audit --no-fund
  if errorlevel 1 goto done
)
node importer.mjs %*
:done
set "result=%errorlevel%"
echo.
pause
exit /b %result%

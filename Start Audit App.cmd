@echo off
rem Runs the Marketing Audit app and starts it again if it ever stops. Close this window to stop the app.
rem Production mode (next build + next start). If a build fails, it runs next dev instead.
title Marketing Audit (keep this window open)
cd /d "%~dp0"
if not exist ".data" mkdir ".data"
if not exist "node_modules" call npm install --no-audit --no-fund
:loop
cls
echo.
echo   Marketing Audit is running on http://127.0.0.1:3130
echo.
echo   Keep this window open (you can minimise it).
echo   Close it only when you want to stop the app.
echo   Each start builds the app first (about a minute).
echo.
echo   Log: %~dp0.data\server.log
set NEXT_DIST_DIR=.next-prod
echo [%date% %time%] build>> ".data\server.log"
call npm run build >> ".data\server.log" 2>&1
if errorlevel 1 goto dev
start "" "http://127.0.0.1:3130"
echo [%date% %time%] server start (production)>> ".data\server.log"
call npm run start >> ".data\server.log" 2>&1
goto stopped
:dev
echo [%date% %time%] build failed, server start (dev)>> ".data\server.log"
set NEXT_DIST_DIR=
call npm run dev >> ".data\server.log" 2>&1
:stopped
echo [%date% %time%] server stopped, restarting>> ".data\server.log"
echo   The server stopped. Starting it again in 3 seconds...
timeout /t 3 /nobreak >nul
goto loop

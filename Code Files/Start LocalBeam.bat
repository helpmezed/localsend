@echo off
title LocalBeam Launcher

:: ── Check Node.js is installed ──────────────────────────────────────────────
where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo  Node.js is not installed.
    echo  Download it from: https://nodejs.org
    echo.
    pause
    start https://nodejs.org
    exit /b 1
)

:: ── Move to the app directory ────────────────────────────────────────────────
cd /d "%~dp0"

:: ── Install dependencies if node_modules is missing ─────────────────────────
if not exist "node_modules\" (
    echo  Installing dependencies, please wait...
    call npm install --silent
    if errorlevel 1 (
        echo.
        echo  npm install failed. Check your internet connection.
        pause
        exit /b 1
    )
)

:: ── Launch ───────────────────────────────────────────────────────────────────
start "" npx electron .
exit

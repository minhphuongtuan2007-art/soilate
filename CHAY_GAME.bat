@echo off
title Xon Multiplayer Game Server
color 0A
cd /d "%~dp0"

echo ========================================================
echo           XON MULTIPLAYER GAME SERVER
echo ========================================================
echo.
echo [*] Starting server at http://localhost:8000 ...
python server.py
if errorlevel 1 (
    echo.
    echo [!] Server stopped with error code %ERRORLEVEL%.
    pause
)

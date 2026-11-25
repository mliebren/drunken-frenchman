@echo off
REM Windows launcher
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel%==0 ( node server.js %1 & goto :eof )
where python >nul 2>nul
if %errorlevel%==0 ( python serve.py %1 & goto :eof )
echo Install Node.js (https://nodejs.org) or Python 3 to run the game.
pause

@echo off
REM Drunken Frenchman - Windows launcher. Double-click this file.
REM It looks for Node.js or Python to host the game and, if neither is installed,
REM simply opens the game straight from the folder.
cd /d "%~dp0"
title Drunken Frenchman
set PORT=8765

where node >nul 2>nul
if %errorlevel%==0 (
  node server.js %PORT%
  goto :done
)

REM "py" is the Python launcher installed by python.org's installer
py -3 -c "import sys" >nul 2>nul
if %errorlevel%==0 (
  py -3 serve.py %PORT%
  goto :done
)

REM plain "python" (the Microsoft Store placeholder fails this check, which is what we want)
python -c "import sys" >nul 2>nul
if %errorlevel%==0 (
  python serve.py %PORT%
  goto :done
)

echo.
echo   Node.js and Python were not found, so the game will open straight from the folder.
echo   (Installing Node.js from https://nodejs.org is optional; the game plays the same.)
start "" "%~dp0public\index.html"

:done
echo.
pause

@echo off
rem Class Connect - serveur de notifications. Laisse cette fenetre ouverte (tu peux la reduire).
title Class Connect - notifications
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [X] Node.js n'est pas installe. Installe la version LTS depuis https://nodejs.org puis relance ce fichier.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installation des modules, patiente une minute...
  call npm install --omit=dev --no-fund --no-audit
)

:boucle
node push-server.mjs
echo.
echo Le serveur s'est arrete. Redemarrage dans 10 secondes (ferme la fenetre pour l'arreter)...
timeout /t 10 /nobreak >nul
goto boucle

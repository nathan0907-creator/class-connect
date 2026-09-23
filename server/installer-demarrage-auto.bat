@echo off
rem Lance automatiquement le serveur de notifications a chaque demarrage de Windows (dans une fenetre reduite).
set "DIR=%~dp0"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LINK=%STARTUP%\class-connect-notifications.bat"

> "%LINK%" (
  echo @echo off
  echo start "Class Connect - notifications" /min "%DIR%demarrer.bat"
)

echo.
echo [OK] Le serveur demarrera tout seul a chaque allumage du PC.
echo      Pour annuler : supprime le fichier
echo      "%LINK%"
echo.
echo Lancement maintenant...
start "Class Connect - notifications" /min "%DIR%demarrer.bat"
pause

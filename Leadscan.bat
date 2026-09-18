@echo off
setlocal
title Leadscan
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo  O Node.js nao esta instalado. Rode o "Instalar" primeiro.
  echo.
  pause
  exit /b 1
)

rem The build output is what the server actually serves, so a folder that has
rem never been installed is sent back to the installer rather than failing
rem later with a blank page.
if not exist "dist\api\server.js" goto not_installed
if not exist "web\dist\index.html" goto not_installed

echo.
echo  Abrindo o Leadscan...
echo.
echo  Deixe esta janela aberta enquanto estiver usando.
echo  Para fechar o programa, feche esta janela.
echo.

rem Give the server a moment to bind the port before the browser asks for it,
rem so the first page load is not a connection error the operator has to retry.
start "" /b cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:3000"

node dist\api\server.js

echo.
echo  O Leadscan foi encerrado.
pause
exit /b 0

:not_installed
echo.
echo  O Leadscan ainda nao foi preparado neste computador.
echo  Clique em "Instalar" uma vez e depois abra este atalho de novo.
echo.
pause
exit /b 1

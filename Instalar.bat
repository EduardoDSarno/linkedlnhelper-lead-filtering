@echo off
setlocal
title Leadscan - Instalacao
cd /d "%~dp0"

echo.
echo  ===============================================
echo   Leadscan - instalacao (so precisa rodar 1 vez)
echo  ===============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  [X] O Node.js nao esta instalado.
  echo.
  echo      1. Abra https://nodejs.org
  echo      2. Baixe a versao "LTS" e instale clicando em Avancar ate o fim
  echo      3. Feche esta janela e rode o Instalar novamente
  echo.
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%v in ('node -v') do set NODE_MAJOR=%%v
set NODE_MAJOR=%NODE_MAJOR:v=%
if %NODE_MAJOR% LSS 22 (
  echo  [X] Seu Node.js e muito antigo ^(versao %NODE_MAJOR%^). O Leadscan precisa da 22 ou maior.
  echo      Baixe a versao "LTS" em https://nodejs.org e instale por cima.
  echo.
  pause
  exit /b 1
)

echo  [1/3] Instalando componentes do servidor...
call npm install --no-audit --no-fund
if errorlevel 1 goto failed

echo  [2/3] Instalando componentes da tela...
call npm --prefix web install --no-audit --no-fund
if errorlevel 1 goto failed

echo  [3/3] Preparando o aplicativo...
call npm run build:app
if errorlevel 1 goto failed

call :make_shortcut

echo.
echo  ===============================================
echo   Pronto! Um atalho "Leadscan" foi criado
echo   na sua Area de Trabalho.
echo.
echo   E so clicar nele para abrir o programa.
echo  ===============================================
echo.
pause
exit /b 0

:failed
echo.
echo  [X] Alguma etapa falhou. Tire um print desta janela e mande para quem te passou o programa.
echo.
pause
exit /b 1

rem Creates the Desktop shortcut through PowerShell, so the operator never has
rem to find this folder again after the first run.
:make_shortcut
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s=(New-Object -ComObject WScript.Shell);" ^
  "$lnk=$s.CreateShortcut([Environment]::GetFolderPath('Desktop')+'\Leadscan.lnk');" ^
  "$lnk.TargetPath='%~dp0Leadscan.bat';" ^
  "$lnk.WorkingDirectory='%~dp0';" ^
  "$lnk.IconLocation='%SystemRoot%\System32\shell32.dll,13';" ^
  "$lnk.Description='Abrir o Leadscan';" ^
  "$lnk.Save()" >nul 2>nul
exit /b 0

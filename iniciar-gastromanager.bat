@echo off
:: GastroManager - inicio automático. scripts\windows\instalar.ps1 lo registra como tarea de Windows que corre
:: AL ENCENDER LA PC (cuenta SYSTEM), sin que nadie inicie sesión: si se corta la luz, el sistema vuelve solo.
:: %1 (opcional) = ruta a pm2.cmd: la cuenta SYSTEM no tiene en el PATH lo instalado con npm -g.
:: PM2_HOME lo fija el instalador para toda la máquina (el pm2 del arranque y el del administrador son el mismo).
:: Funciona desde la carpeta donde esté instalado.
cd /d "%~dp0"

:: Esperar 10 segundos para que la red esté lista
timeout /t 10 /nobreak >nul

:: pm2: el que indica la tarea; si no, el del PATH; si no, el de nvm4w (instalación original)
set "PM2=pm2"
if not "%~1"=="" (
  set PM2="%~1"
) else (
  where pm2 >nul 2>nul || set "PM2=C:\nvm4w\nodejs\node.exe C:\nvm4w\nodejs\node_modules\pm2\bin\pm2"
)

:: Levantar con PM2: lo guardado y, si no estaba, arrancarlo (si ya corre, pm2 no lo duplica)
call %PM2% resurrect
call %PM2% start ecosystem.config.js --env production
call %PM2% save

exit 0

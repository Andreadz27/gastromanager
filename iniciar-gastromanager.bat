@echo off
:: GastroManager - inicio automático (lo registra scripts\windows\instalar.ps1 al iniciar sesión)
:: Funciona desde la carpeta donde esté instalado.
cd /d "%~dp0"

:: Esperar 10 segundos para que la red esté lista
timeout /t 10 /nobreak >nul

:: pm2 del PATH; si no está, el de nvm4w (instalación original)
set "PM2=pm2"
where pm2 >nul 2>nul || set "PM2=C:\nvm4w\nodejs\node.exe C:\nvm4w\nodejs\node_modules\pm2\bin\pm2"

:: Levantar con PM2: lo guardado y, si no estaba, arrancarlo (si ya corre, pm2 no lo duplica)
call %PM2% resurrect
call %PM2% start ecosystem.config.js --env production

exit 0

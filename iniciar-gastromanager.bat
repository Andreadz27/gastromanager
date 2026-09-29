@echo off
:: GastroManager - Script de inicio automático
:: Este script arranca PM2 con el servidor al iniciar Windows

cd /d "C:\Users\Administrador\Documents\Sistema de gestión gastronomico"

:: Esperar 10 segundos para que la red esté lista
timeout /t 10 /nobreak >nul

:: Levantar con PM2
C:\nvm4w\nodejs\node.exe "C:\nvm4w\nodejs\node_modules\pm2\bin\pm2" resurrect

:: Si no había estado guardado, arrancarlo directamente
C:\nvm4w\nodejs\node.exe "C:\nvm4w\nodejs\node_modules\pm2\bin\pm2" start ecosystem.config.js --env production

exit 0

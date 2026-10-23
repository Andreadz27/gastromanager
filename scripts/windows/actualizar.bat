@echo off
:: Actualiza Morfi a la última versión probada (con copia previa y vuelta atrás automática).
cd /d "%~dp0..\.."
call npm run actualizar
pause

@echo off
:: Antes de llamarse Morfi, el sistema arrancaba con este archivo y las PC ya instaladas lo tienen registrado
:: (tarea de Windows o inicio de sesion). Se deja para que sigan arrancando: llama al de ahora.
call "%~dp0iniciar-morfi.bat" %*

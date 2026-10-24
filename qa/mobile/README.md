# Pruebas en el celular con Maestro

Morfi es una web: en el celular se usa desde Chrome (mozo, carta del QR, pago desde la mesa). Estos flujos manejan
Chrome en un Android de verdad o en un emulador, tocando la pantalla como una persona.

| Flujo | Caso |
|---|---|
| `flujos/01-carta-qr.yaml` | CP-MOB-01 · carta del QR, filtro por categoría |
| `flujos/02-mozo-ingresa.yaml` | CP-MOB-02 · el mozo ingresa y ve sus mesas |
| `flujos/03-login-incorrecto.yaml` | CP-MOB-03 · contraseña incorrecta |
| `flujos/comunes/abrir-chrome.yaml` | Chrome limpio, sin pantallas de bienvenida (lo usan todos) |

## En GitHub

Actions → **QA móvil** → *Run workflow*. Levanta un emulador Android 14, el servidor de prueba y corre los flujos.
Resultado y capturas: artefacto **reporte-maestro**. También corre los lunes y cuando cambian estos archivos.

## En la PC (con Maestro Studio para ver y grabar flujos)

1. Instalar Maestro: https://docs.maestro.dev (en Windows, con WSL o Maestro Studio) y Android Studio con un emulador.
2. Servidor de prueba en el puerto 3000: `PORT=3000 node qa/servidor.js` (PowerShell: `$env:PORT=3000; node qa/servidor.js`).
3. Con el emulador abierto: `maestro test qa/mobile`. Para grabar o ajustar un flujo: `maestro studio`.

**Con un celular real** por USB (depuración USB activada), en el mismo WiFi que la PC: cambiar `BASE_URL` por la
IP de la PC, por ejemplo `maestro test -e BASE_URL=http://192.168.0.10:3000 qa/mobile`.

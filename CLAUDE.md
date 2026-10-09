# GastroManager — reglas para trabajar en este proyecto

- Cada bug arreglado lleva su test de regresión (en el test del módulo o en `test/regresiones.test.js`).
- No se mergea con el CI en rojo. Antes de commitear: `npm run check` (lint + nombres + tests).
- Nunca trabajar directo en `main`: rama nueva y pull request.
- No tocar `data/` (base real del local), producción ni variables de entorno reales. Para probar: `npm run demo`
  o `npm test` (usan carpetas temporales). Usuario de prueba: `npm run usuario:prueba`.
- Migraciones solo en `src/migraciones.js`, siempre aditivas (columnas con `DEFAULT`, `IF NOT EXISTS`).
- Nada de llamadas HTTP dentro de `transaccion()`.
- Ruta nueva: `autenticar` + `requiere(permiso)`; si es de administrador, decidir si se bloquea en la demo (`src/demo.js`).
- El precio de un pedido sale siempre de la base (`resolverItems`), nunca del navegador.
- Antes de una versión grande: `npm run prueba:fuego` (cada cambio a propósito tiene que hacer fallar un test).
- Si un test nuevo destapa un bug que cambia lo que ve el usuario, anotarlo y preguntar antes de arreglarlo.
- Partes frágiles y qué las rompe: `docs/MAPA-DE-RIESGOS.md`.

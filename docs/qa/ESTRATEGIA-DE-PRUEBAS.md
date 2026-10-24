# Estrategia de pruebas de Morfi

Qué se prueba, con qué herramienta, cuándo corre y cuándo una versión está lista para instalarse en un local.
Complementa a `docs/MAPA-DE-RIESGOS.md` (qué partes se rompen más fácil y qué las protege).

## Qué se cuida primero

Morfi corre en el mostrador de un restaurante en pleno servicio. El orden de prioridad sale de lo que más le
cuesta al local si falla:

1. **Cobrar y la caja** (plata): cobro doble, vuelto mal, caja que no cuadra, factura que no sale.
2. **Tomar pedidos y que lleguen a cocina**: si no llegan, el servicio se frena.
3. **Accesos y permisos**: un mozo no cobra, un cajero no ve costos, un cliente del QR no ve nada interno.
4. **Lo que el cliente ve** (carta del QR, pedido y pago desde la mesa): es la cara del local.
5. **Gestión** (stock, reportes, ganancias, contabilidad): importa, pero un error ahí no frena el servicio.

## Las capas

| Capa | Herramienta | Dónde | Casos | Corre |
|---|---|---|---|---|
| API, servicios, migraciones, seguridad | `node:test` | `test/*.test.js` | 235 | `npm test` · CI en cada push (Linux y Windows) |
| Navegador, flujos del equipo de desarrollo | Playwright (`playwright-core`) | `test/e2e/` | 22 | `npm run test:e2e` · CI en cada push |
| **Casos de prueba de QA, E2E** | **Playwright Test** | `qa/e2e/` | 22 (18 casos + 4 defectos) | `npm run qa:e2e` · workflow **QA** en cada PR |
| **API, contrato y validaciones** | **Postman + Newman** | `qa/api/` | 40 pedidos, 130 verificaciones | `npm run qa:api` · workflow **QA** |
| **Celular real o emulado** | **Maestro** | `qa/mobile/` | 3 flujos | workflow **QA móvil** (a mano, lunes y al cambiar flujos) |
| **Reporte** | **Mochawesome** | `qa/reportes/` | junta E2E y API | `npm run qa:reporte` · artefacto `reporte-qa` |
| Mutaciones (¿los tests detectan roturas?) | script propio | `scripts/prueba-de-fuego.js` | 24 mutaciones | A mano antes de una versión grande |

`test/` son las pruebas que el desarrollo escribe junto con cada cambio. `qa/` sigue los **casos de prueba**
documentados (`CASOS-DE-PRUEBA.md`), cada uno con su ID, para que cualquiera pueda ver qué está cubierto, y suma
API desde afuera (Postman, como la usaría una integración) y el celular de verdad (Maestro).

## Etiquetas

| Etiqueta | Para qué | Cómo correr solo eso |
|---|---|---|
| `@humo` | Lo mínimo para saber que la versión anda (2 minutos). Antes de instalar en un local. | `npm run qa:humo` |
| `@regresion` | Todo lo que ya funcionaba y no puede volver a romperse | `npm run qa:e2e -- --grep @regresion` |
| `@seguridad` | Permisos, sesión, datos que no se deben ver | `npm run qa:e2e -- --grep @seguridad` |
| `@celular` | Pantallas que se usan en el celular (proyecto "celular": Pixel 7 emulado) | `npm run qa:e2e -- --project celular` |
| `@defecto` | Defectos conocidos abiertos (`DEFECTOS-CONOCIDOS.md`) | `npm run qa:e2e -- --grep @defecto` |

## Datos y ambiente

- Cada corrida levanta Morfi sobre **una base nueva en una carpeta temporal** (`qa/servidor.js`) y la borra al
  terminar. Nunca se prueba contra la base de un local.
- Usuarios y productos de prueba: `qa/datos.js`, una sola fuente para Playwright, Postman y Maestro.
- Navegador: Edge en Windows, Chrome en Linux (el que ya está instalado; no se descarga otro).
- Zona horaria del navegador: Argentina, como en el local (los pedidos "de hoy" dependen de eso).
- Para usar Postman o Maestro a mano: `node qa/servidor.js` deja un servidor de prueba corriendo
  (`PORT=3000 node qa/servidor.js` para un puerto fijo).

## Criterios

**Para fusionar un PR:** CI y QA en verde. Si se tocó una parte de riesgo ALTO del mapa de riesgos, un test nuevo
que hubiera fallado sin el cambio.

**Para instalar una versión en un local:**
- `@humo` en verde sobre la versión exacta que se instala.
- Ningún defecto abierto de severidad crítica o alta.
- Si se tocó cobro, caja o facturación: QA móvil en verde y una venta real de prueba en el local (cobrar,
  anular y cerrar la caja), fuera del horario de servicio.

**Lo que no se automatiza** (se prueba a mano en el local: casos CP-MAN de `CASOS-DE-PRUEBA.md`):
impresora térmica física, factura real en ARCA producción, pago real en Mercado Pago, WhatsApp Business real y el
lector de código de barras.

## Defectos

1. Se reporta con la plantilla **Defecto** de GitHub Issues: pasos, esperado, obtenido, severidad.
2. Se agrega a `DEFECTOS-CONOCIDOS.md` con su ID (`DEF-NNN`) y un caso en `qa/e2e/specs/05-defectos.spec.js` con
   `test.fail()` que describe el comportamiento correcto.
3. Al arreglarlo, ese caso empieza a pasar y Playwright avisa: se quita el `test.fail()`, el caso queda como
   regresión y el defecto pasa a **Cerrados**.

## Reportes

`npm run qa` corre E2E, API y arma el reporte. En `qa/reportes/salida/`:

- `mochawesome/index.html`: E2E y API en un solo reporte, con los casos por ID, etiquetas y, si algo falla, la
  captura y el video.
- `playwright/index.html`: reporte de Playwright con la **traza** de cada falla (paso a paso, red y consola):
  `npx playwright show-report qa/reportes/salida/playwright`.

En GitHub: workflow **QA** → la corrida → artefacto **reporte-qa**.

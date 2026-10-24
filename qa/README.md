# QA de Morfi

Suite de pruebas que sigue los casos documentados en [`docs/qa/CASOS-DE-PRUEBA.md`](../docs/qa/CASOS-DE-PRUEBA.md).
Estrategia completa: [`docs/qa/ESTRATEGIA-DE-PRUEBAS.md`](../docs/qa/ESTRATEGIA-DE-PRUEBAS.md).

| Qué | Herramienta | Carpeta | Comando |
|---|---|---|---|
| Diseño de casos de prueba | Markdown con IDs (CP-…) | `docs/qa/CASOS-DE-PRUEBA.md` | |
| E2E en escritorio y celular emulado | Playwright Test | `e2e/` | `npm run qa:e2e` (`npm run qa:humo`: solo lo mínimo) |
| API: contrato, validaciones y permisos | Postman + Newman | `api/` | `npm run qa:api` |
| Celular (Android con Chrome) | Maestro | `mobile/` | ver [`mobile/README.md`](mobile/README.md) |
| Integración continua | GitHub Actions | `.github/workflows/qa.yml`, `qa-movil.yml` | en cada PR |
| Reporte | Mochawesome (+ reporte HTML de Playwright) | `reportes/` | `npm run qa:reporte` |
| Defectos conocidos, automatizados | Playwright (`test.fail()` mientras están abiertos) | `e2e/specs/05-defectos.spec.js` | `npm run qa:e2e -- --grep @defecto` |

Primera vez en una PC: `npx playwright install ffmpeg` (para el video de los casos que fallan; el navegador es el Edge o Chrome instalado).

Todo junto: **`npm run qa`** → abre `qa/reportes/salida/mochawesome/index.html`.

## Cómo está armado

```
qa/
├── datos.js                   usuarios y productos de prueba (una sola fuente para las tres herramientas)
├── servidor.js                Morfi sobre una base nueva temporal; `node qa/servidor.js` deja uno corriendo
├── playwright.config.js       proyectos "escritorio" y "celular" (Pixel 7), trazas, video y reportes
├── e2e/
│   ├── fixtures.js            baseURL, API con sesión por rol y falla ante cualquier error de JavaScript
│   ├── paginas/               page objects: login, POS, caja, cocina, carta
│   └── specs/                 01-acceso · 02-venta · 03-carta-celular · 04-ganancias · 05-defectos
├── api/
│   ├── morfi.postman_collection.json      importable en Postman
│   ├── morfi-local.postman_environment.json
│   └── correr.js              Newman contra un servidor nuevo + parte del reporte
├── mobile/                    flujos de Maestro (Android + Chrome)
└── reportes/                  adaptadores a Mochawesome (Playwright y Newman) y generador del HTML
```

## Postman a mano

1. `node qa/servidor.js` (anota la dirección que muestra) o `npm start` con una base de prueba.
2. Postman → Import → `qa/api/morfi.postman_collection.json` y `qa/api/morfi-local.postman_environment.json`.
3. En el ambiente, `base_url` = la dirección del paso 1.
4. **Run collection**, en orden: cada carpeta usa lo que deja la anterior (tokens, pedido, caja).

Si se cambia la colección en Postman, exportarla (Collection v2.1) encima del archivo y correr `npm run qa:api`.

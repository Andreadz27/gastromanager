// Suite de QA en Playwright: casos de prueba de docs/qa/CASOS-DE-PRUEBA.md, por etiqueta.
// npm run qa:e2e            todo
// npm run qa:e2e -- --grep @humo     solo la prueba de humo (2 minutos)
// Reportes en qa/reportes/salida/: HTML de Playwright (con trazas) y Mochawesome.
'use strict';
const { defineConfig, devices } = require('@playwright/test');
const path = require('path');

const CANAL = process.env.GM_E2E_NAVEGADOR || (process.platform === 'win32' ? 'msedge' : 'chrome');
const navegador = process.env.GM_E2E_EJECUTABLE
  ? { launchOptions: { executablePath: process.env.GM_E2E_EJECUTABLE } }
  : { channel: CANAL };
const SALIDA = path.join(__dirname, 'reportes', 'salida');

module.exports = defineConfig({
  testDir: path.join(__dirname, 'e2e', 'specs'),
  globalSetup: require.resolve('./e2e/preparar.js'),
  outputDir: path.join(SALIDA, 'evidencias'),
  // Un solo servidor y una sola caja para todos: los casos corren de a uno, en orden
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 8_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(SALIDA, 'playwright'), open: 'never' }],
    ['json', { outputFile: path.join(SALIDA, 'playwright.json') }],
    [require.resolve('./reportes/mochawesome-playwright.js'), { salida: path.join(SALIDA, 'mochawesome-e2e.json') }]
  ],
  use: {
    ...navegador,
    locale: 'es-AR',
    // La zona del negocio, como en un local real (ver docs/MAPA-DE-RIESGOS.md)
    timezoneId: process.env.ZONA_HORARIA || 'America/Argentina/Buenos_Aires',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  projects: [
    { name: 'escritorio', use: { viewport: { width: 1366, height: 800 } }, grepInvert: /@celular/ },
    // Celular emulado (pantalla, toque y user agent de Android), con el mismo navegador instalado
    { name: 'celular', use: { ...devices['Pixel 7'], ...navegador, defaultBrowserType: 'chromium' }, grep: /@celular/ }
  ]
});

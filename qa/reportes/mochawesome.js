// Arma reportes en el formato JSON de Mochawesome y los junta en un solo HTML.
// Playwright y Newman no hablan Mochawesome: cada uno deja su parte (mochawesome-*.json) con estas funciones
// y `npm run qa:reporte` las junta en qa/reportes/salida/mochawesome/index.html.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SALIDA = path.join(__dirname, 'salida');

const velocidad = ms => (ms > 3000 ? 'slow' : ms > 1000 ? 'medium' : 'fast');

// estado: 'passed' | 'failed' | 'pending'. contexto: lista de { title, value } (texto o ruta de imagen)
function prueba({ titulo, tituloCompleto, duracion = 0, estado, error, contexto, codigo = '' }, padre) {
  return {
    title: titulo,
    fullTitle: tituloCompleto || titulo,
    timedOut: false,
    duration: Math.round(duracion),
    state: estado === 'pending' ? null : estado,
    speed: estado === 'pending' ? null : velocidad(duracion),
    pass: estado === 'passed',
    fail: estado === 'failed',
    pending: estado === 'pending',
    context: contexto && contexto.length ? JSON.stringify(contexto) : null,
    code: codigo,
    err: error ? { message: error.mensaje || String(error), estack: error.pila || '', diff: null } : {},
    uuid: crypto.randomUUID(),
    parentUUID: padre,
    isHook: false,
    skipped: false
  };
}

function suite(titulo, archivo = '') {
  const s = {
    uuid: crypto.randomUUID(), title: titulo, fullFile: archivo, file: archivo,
    beforeHooks: [], afterHooks: [], tests: [], suites: [],
    passes: [], failures: [], pending: [], skipped: [], duration: 0,
    root: false, rootEmpty: false, _timeout: 0
  };
  s.agregar = datos => {
    const t = prueba(datos, s.uuid);
    s.tests.push(t);
    s.duration += t.duration;
    (t.pass ? s.passes : t.fail ? s.failures : s.pending).push(t.uuid);
    return t;
  };
  s.subsuite = (t, a) => { const h = suite(t, a || archivo); s.suites.push(h); return h; };
  return s;
}

// Recorre suites y sub-suites
function* todas(s) {
  yield s;
  for (const h of s.suites) yield* todas(h);
}

function limpiar(s) {
  delete s.agregar; delete s.subsuite;
  s.suites.forEach(limpiar);
  return s;
}

function informe(suites, { inicio, fin }) {
  const raiz = suite('');
  raiz.root = true;
  raiz.suites = suites.map(limpiar);
  raiz.rootEmpty = true;
  delete raiz.agregar; delete raiz.subsuite;
  const tests = [...todas(raiz)].flatMap(s => s.tests);
  const n = estado => tests.filter(t => t[estado]).length;
  const total = tests.length;
  return {
    stats: {
      suites: [...todas(raiz)].length - 1,
      tests: total, passes: n('pass'), pending: n('pending'), failures: n('fail'),
      start: new Date(inicio).toISOString(), end: new Date(fin).toISOString(),
      duration: Math.round(fin - inicio), testsRegistered: total,
      passPercent: total ? Math.round(n('pass') / (total - n('pending') || 1) * 1000) / 10 : 0,
      pendingPercent: total ? Math.round(n('pending') / total * 1000) / 10 : 0,
      other: 0, hasOther: false, skipped: 0, hasSkipped: false
    },
    results: [raiz],
    meta: { mocha: { version: '-' }, mochawesome: { options: {}, version: '7' }, marge: { options: {}, version: '6' } }
  };
}

function guardarParte(archivo, datos) {
  fs.mkdirSync(path.dirname(archivo), { recursive: true });
  fs.writeFileSync(archivo, JSON.stringify(datos, null, 2));
}

// Junta todas las partes en un solo informe (una suite raíz por herramienta) y genera el HTML
// Primero E2E y después API; la duración es la suma de las corridas (no el tiempo entre una y otra)
const PARTES = ['mochawesome-e2e.json', 'mochawesome-api.json'];

async function generarHtml(partes = PARTES.map(f => path.join(SALIDA, f)).filter(f => fs.existsSync(f))) {
  if (!partes.length) throw new Error('No hay resultados para el reporte: corré antes npm run qa:e2e o npm run qa:api');
  const leidas = partes.map(p => JSON.parse(fs.readFileSync(p, 'utf8')));
  const suites = leidas.flatMap(d => d.results[0].suites);
  const inicio = Math.min(...leidas.map(d => Date.parse(d.stats.start)));
  const duracion = leidas.reduce((t, d) => t + d.stats.duration, 0);
  const datos = informe(suites, { inicio, fin: inicio + duracion });
  const marge = require('mochawesome-report-generator');
  const [html] = await marge.create(datos, {
    reportDir: path.join(SALIDA, 'mochawesome'), reportFilename: 'index', reportTitle: 'Morfi · Reporte de pruebas',
    reportPageTitle: 'Morfi · Reporte de pruebas', inline: true, charts: true, code: false, showSkipped: true, overwrite: true, timestamp: false
  });
  return { html, stats: datos.stats };
}

module.exports = { suite, informe, guardarParte, generarHtml, SALIDA };

if (require.main === module) {
  generarHtml().then(({ html, stats }) => {
    console.log(`Reporte Mochawesome: ${html}`);
    console.log(`${stats.tests} casos · ${stats.passes} bien · ${stats.failures} con error · ${stats.pending} omitidos`);
  }).catch(e => { console.error(e.message); process.exit(1); });
}

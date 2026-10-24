// Corre la colección de Postman con Newman contra un servidor de prueba nuevo (o contra MORFI_QA_URL)
// y deja el resultado para el reporte Mochawesome (qa/reportes/salida/mochawesome-api.json).
// npm run qa:api
'use strict';
const path = require('path');
const newman = require('newman');
const { levantar } = require('../servidor');
const { suite, informe, guardarParte, SALIDA } = require('../reportes/mochawesome');

const correrNewman = opciones => new Promise((ok, mal) => newman.run(opciones, (e, resumen) => e ? mal(e) : ok(resumen)));

// Una suite por carpeta de la colección y un caso por pedido, con cada pm.test en el contexto
function aMochawesome(resumen, inicio) {
  const raiz = suite('API Postman · Newman', 'qa/api/morfi.postman_collection.json');
  const carpetas = new Map();
  for (const ej of resumen.run.executions) {
    const nombreCarpeta = ej.item.parent() && ej.item.parent().name || 'Colección';
    if (!carpetas.has(nombreCarpeta)) carpetas.set(nombreCarpeta, raiz.subsuite(nombreCarpeta));
    const destino = carpetas.get(nombreCarpeta);
    const req = ej.request;
    const contexto = [
      { title: 'Pedido', value: `${req.method} ${req.url.getPath()}` },
      { title: 'Respuesta', value: ej.response ? `${ej.response.code} ${ej.response.status} · ${ej.response.responseTime} ms` : 'sin respuesta' }
    ];
    if (ej.requestError) {
      destino.agregar({ titulo: `${ej.item.name} · sin respuesta`, estado: 'failed', contexto, error: { mensaje: ej.requestError.message } });
      continue;
    }
    const verificaciones = ej.assertions || [];
    const fallas = verificaciones.filter(a => a.error);
    contexto.push({ title: 'Verificaciones', value: verificaciones.map(a => `${a.error ? '✘' : '✔'} ${a.assertion}`).join('\n') });
    destino.agregar({
      titulo: ej.item.name,
      duracion: ej.response ? ej.response.responseTime : 0,
      estado: fallas.length ? 'failed' : 'passed',
      contexto,
      error: fallas.length ? { mensaje: fallas.map(a => `${a.assertion}: ${a.error.message}`).join('\n') } : null
    });
  }
  return informe([raiz], { inicio, fin: Date.now() });
}

(async () => {
  const s = process.env.MORFI_QA_URL ? null : await levantar();
  const base = process.env.MORFI_QA_URL || s.base;
  const inicio = Date.now();
  try {
    const resumen = await correrNewman({
      collection: require('./morfi.postman_collection.json'),
      environment: require('./morfi-local.postman_environment.json'),
      envVar: [{ key: 'base_url', value: base }],
      reporters: ['cli'],
      reporter: { cli: { noSummary: false } }
    });
    guardarParte(path.join(SALIDA, 'mochawesome-api.json'), aMochawesome(resumen, inicio));
    const fallas = resumen.run.failures.length;
    console.log(fallas ? `\n${fallas} verificaciones fallaron` : '\nAPI: todas las verificaciones pasaron');
    process.exitCode = fallas ? 1 : 0;
  } finally {
    if (s) await s.cerrar();
  }
})().catch(e => { console.error(e); process.exit(1); });

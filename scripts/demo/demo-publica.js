// Demo pública para internet (Render u otro hosting): genera La Buena Mesa, la sirve en PORT en modo
// demo (GM_DEMO=1: usuarios, impresoras, integraciones y copias bloqueados) y cada
// GM_DEMO_REINICIO_HORAS horas (6 por defecto) la regenera para borrar lo que hayan cargado los visitantes.
// La nueva base se genera en otra carpeta mientras la anterior sigue atendiendo: el corte dura un par de segundos.
//
// Uso: npm run demo:publica   (no toca data/)
'use strict';
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RAIZ = path.join(__dirname, '..', '..');
const BASE = process.env.GM_DEMO_DIR || path.join(os.tmpdir(), 'gastromanager-demo-publica');
const HORAS = Number(process.env.GM_DEMO_REINICIO_HORAS) || 6;
const PUERTO = process.env.PORT || '3100';

let servidor = null;
let cambiando = false;
let turno = 0;

function generar() {
  const destino = path.join(BASE, `datos-${turno++ % 2}`); // nunca la carpeta que está en uso
  console.log(`[demo] Generando datos en ${destino}...`);
  // El generador usa su propio servidor temporal, sin modo demo (crea usuarios por la API)
  const env = { ...process.env };
  delete env.GM_DEMO;
  execFileSync(process.execPath, [path.join(__dirname, 'generar-datos.js'), destino], { env, stdio: 'inherit' });
  return destino;
}

function levantar(datos) {
  const proc = spawn(process.execPath, [path.join(RAIZ, 'server.js')], {
    env: { ...process.env, GM_DATA_DIR: datos, PORT: PUERTO, GM_DEMO: '1', GM_DEMO_REINICIO_HORAS: String(HORAS), NODE_ENV: 'demo', SECRET_KEY: '' },
    stdio: 'inherit'
  });
  proc.on('exit', code => {
    if (proc !== servidor || cambiando) return;
    // Caída inesperada: se vuelve a levantar con los mismos datos
    console.error(`[demo] El servidor terminó (código ${code}); se reinicia en 3 s`);
    setTimeout(() => { servidor = levantar(datos); }, 3000);
  });
  return proc;
}

const terminar = proc => new Promise(r => {
  if (!proc || proc.exitCode !== null) return r();
  proc.once('exit', r);
  proc.kill();
});

async function reiniciar() {
  const datos = generar();
  cambiando = true;
  await terminar(servidor);
  servidor = levantar(datos);
  cambiando = false;
  console.log(`[demo] Demo lista en el puerto ${PUERTO}. Próximo reinicio de datos en ${HORAS} h.`);
}

fs.mkdirSync(BASE, { recursive: true });
reiniciar().catch(e => { console.error('[demo] No se pudo iniciar la demo:', e.message); process.exit(1); });
setInterval(() => reiniciar().catch(e => console.error('[demo] Falló el reinicio de datos (sigue la demo anterior):', e.message)),
  HORAS * 3600 * 1000);
for (const senal of ['SIGINT', 'SIGTERM']) {
  process.on(senal, async () => { cambiando = true; await terminar(servidor); process.exit(0); });
}

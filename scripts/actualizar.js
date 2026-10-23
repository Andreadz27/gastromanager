// Actualiza GastroManager a la última versión de la rama main (la que pasó el CI).
// 1. Si no hay versión nueva, no hace nada.
// 2. Copia de seguridad de la base ANTES de tocar nada.
// 3. Baja el código nuevo (git, solo avance rápido: nunca pisa cambios locales).
// 4. Si cambiaron las dependencias, detiene el servidor (en Windows no se puede reemplazar un .node en uso)
//    y las instala. Reinicia con pm2 y comprueba /api/salud.
// 5. Si algo falla después de bajar el código (npm, pm2 o la versión nueva no arranca), vuelve sola a la
//    anterior, con sus dependencias, y la reinicia.
//
// Uso:  npm run actualizar                 (en la carpeta de la instalación)
//       node scripts/actualizar.js --solo-revisar   (dice si hay versión nueva, no cambia nada)
// Opciones para pruebas: --sin-npm, --sin-reiniciar, --rama <nombre>, --simular-falla-npm
// Deja registro en logs/actualizaciones.log
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const args = process.argv.slice(2);
const opcion = n => args.includes(`--${n}`);
const RAMA = args.includes('--rama') ? args[args.indexOf('--rama') + 1] : 'main';
const ES_WIN = process.platform === 'win32';
const LOG = path.join(RAIZ, 'logs', 'actualizaciones.log');

function log(msg) {
  const linea = `${new Date().toISOString()} ${msg}`;
  console.log(msg);
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    // El registro no crece sin límite: pasado 1 MB se queda con la segunda mitad
    if (fs.existsSync(LOG) && fs.statSync(LOG).size > 1024 * 1024) {
      const texto = fs.readFileSync(LOG, 'utf8');
      fs.writeFileSync(LOG, texto.slice(texto.indexOf('\n', texto.length / 2) + 1));
    }
    fs.appendFileSync(LOG, linea + '\n');
  } catch (e) {}
}
const correr = (cmd, a, extra = {}) => execFileSync(cmd, a, { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: ES_WIN, ...extra }).trim();
const git = (...a) => correr('git', a);
const esperar = ms => new Promise(r => setTimeout(r, ms));

async function saludOk(intentos = 30) {
  require('../src/env');
  const puerto = process.env.PORT || 3000;
  for (let i = 0; i < intentos; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${puerto}/api/salud`, { signal: AbortSignal.timeout(3000) });
      const j = await r.json();
      if (j && j.base === 'ok') return true; // 503 por copia vieja no impide usar el sistema
    } catch (e) {}
    await esperar(2000);
  }
  return false;
}

let fallaSimulada = opcion('simular-falla-npm'); // tests: el primer npm ci falla (solo el de la versión nueva)
function instalarDependencias() {
  if (fallaSimulada) { fallaSimulada = false; throw new Error('npm ci falló (simulado)'); }
  if (opcion('sin-npm')) return;
  // Con el servidor corriendo, Windows no deja reemplazar node_sqlite3.node y npm ci falla a la mitad
  if (!opcion('sin-reiniciar')) {
    log('Deteniendo el servidor para instalar dependencias...');
    try { correr('pm2', ['stop', 'gastromanager']); } catch (e) { log('pm2 stop: ' + e.message); }
  }
  log('Instalando dependencias...');
  correr('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], { timeout: 15 * 60000 });
}
function reiniciar() {
  if (opcion('sin-reiniciar')) return;
  log('Reiniciando el servidor...');
  // restart también levanta un proceso detenido
  correr('pm2', ['restart', 'gastromanager', '--update-env']);
}

async function main() {
  if (git('status', '--porcelain', '--untracked-files=no')) {
    throw new Error('Hay archivos del sistema modificados a mano en esta instalación. No se actualiza para no pisarlos.');
  }
  git('fetch', '--quiet', 'origin', RAMA);
  const actual = git('rev-parse', 'HEAD');
  const nueva = git('rev-parse', `origin/${RAMA}`);
  if (actual === nueva) { log(`Ya está en la última versión (${actual.slice(0, 7)}).`); return 'al-dia'; }
  const cambios = git('log', '--oneline', `${actual}..${nueva}`);
  log(`Versión nueva disponible: ${actual.slice(0, 7)} -> ${nueva.slice(0, 7)}\n${cambios}`);
  if (opcion('solo-revisar')) return 'disponible';

  // 1. Copia de seguridad antes de cambiar nada
  const { crearBackup } = require('../src/servicios/backups');
  const copia = await crearBackup();
  log(`Copia de seguridad previa: ${copia ? copia.nombre : '(sin base todavía)'}`);

  // 2. Código nuevo (solo avance rápido)
  const cambiaronDeps = git('diff', '--name-only', actual, nueva).split('\n').some(f => f === 'package-lock.json');
  git('merge', '--ff-only', '--quiet', nueva);

  // 3. Dependencias, reinicio y comprobación. Cualquier falla acá vuelve a la versión anterior:
  //    antes, si npm o pm2 fallaban, quedaba el código nuevo con dependencias a medio instalar.
  try {
    if (cambiaronDeps) instalarDependencias();
    reiniciar();
    if (!opcion('sin-reiniciar') && !(await saludOk())) throw new Error('la versión nueva no respondió');
    log(`Actualizado a ${nueva.slice(0, 7)}.`);
    return 'actualizado';
  } catch (e) {
    log(`Falló la actualización (${e.message}). Volviendo a la versión anterior...`);
  }
  git('reset', '--hard', '--quiet', actual);
  try {
    if (cambiaronDeps) instalarDependencias();
    reiniciar();
  } catch (e) {
    log('Error al volver a la versión anterior: ' + e.message);
  }
  const volvio = opcion('sin-reiniciar') || await saludOk();
  log(volvio
    ? `Se volvió a la versión anterior (${actual.slice(0, 7)}). Avisar a soporte.`
    : `ATENCIÓN: tampoco arranca la versión anterior. Restaurar la copia ${copia && copia.nombre} (ver README) y avisar a soporte.`);
  return 'revertido';
}

main().then(r => process.exit(r === 'revertido' ? 2 : 0), e => { log('No se pudo actualizar: ' + e.message); process.exit(1); });

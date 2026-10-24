// Actualiza Morfi a la última versión de la rama main (la que pasó el CI).
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
// En Windows va por la consola (pm2 y npm son .cmd): un argumento con espacios se parte en dos si no va entre comillas
// ("Sistema de gestión gastronomico" dejó al local sin servidor el 2026-10-24)
const comillas = a => ES_WIN && /\s/.test(a) ? `"${a}"` : a;
const correr = (cmd, a, extra = {}) => execFileSync(cmd, a.map(comillas), { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: ES_WIN, ...extra }).trim();
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
    detener();
  }
  log('Instalando dependencias...');
  correr('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], { timeout: 15 * 60000 });
}

// El proceso se llama "morfi"; antes del cambio de nombre, "gastromanager". Se manejan los dos: si quedara uno de
// cada versión, serían dos servidores peleando por el mismo puerto.
const PROCESOS = ['morfi', 'gastromanager'];
function detener() {
  for (const p of PROCESOS) { try { correr('pm2', ['stop', p]); } catch (e) { /* no existe con ese nombre */ } }
}
// Se borran los dos y se levanta el de ecosystem.config.js (el nombre de la versión que quedó instalada)
function reiniciar() {
  if (opcion('sin-reiniciar')) return;
  log('Reiniciando el servidor...');
  for (const p of PROCESOS) { try { correr('pm2', ['delete', p]); } catch (e) { /* no existe con ese nombre */ } }
  correr('pm2', ['start', path.join(RAIZ, 'ecosystem.config.js'), '--env', 'production', '--update-env']);
  try { correr('pm2', ['save']); } catch (e) { log('pm2 save: ' + e.message); }
}

// Volver a una versión de antes del cambio de nombre: esa versión busca data/gastromanager.db. Si la base ya se
// llama morfi.db, crearía una vacía (el local sin carta ni ventas): se le devuelve el nombre viejo, con su -wal y -shm.
function devolverNombreBase() {
  // Las versiones de Morfi abren la base con rutaBase() (src/archivo-base.js); las anteriores, con el nombre fijo
  if (fs.readFileSync(path.join(RAIZ, 'src', 'db.js'), 'utf8').includes('rutaBase(')) return;
  const { DATA_DIR } = require('../src/config');
  const nueva = path.join(DATA_DIR, 'morfi.db');
  const vieja = path.join(DATA_DIR, 'gastromanager.db');
  if (!fs.existsSync(nueva) || fs.existsSync(vieja)) return;
  if (!opcion('sin-reiniciar')) detener();
  for (const sufijo of ['-wal', '-shm', '']) if (fs.existsSync(nueva + sufijo)) fs.renameSync(nueva + sufijo, vieja + sufijo);
  log('La versión anterior usa data/gastromanager.db: se le devolvió ese nombre a la base.');
}

// La copia se hace en otro proceso: si este cargara sqlite3, Windows no deja borrar node_sqlite3.node y npm ci
// falla con EPERM (pasó en la PC del local al actualizar el 2026-10-24).
function crearCopiaAparte() {
  const codigo = "require('./src/servicios/backups').crearBackup()" +
    '.then(c => console.log(JSON.stringify(c || null)), e => { console.error(e.message); process.exit(1); })';
  const salida = execFileSync(process.execPath, ['-e', codigo], { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(salida.trim().split('\n').pop());
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
  const copia = crearCopiaAparte();
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
    devolverNombreBase();
    if (cambiaronDeps) instalarDependencias();
    reiniciar();
  } catch (e) {
    log('Error al volver a la versión anterior: ' + e.message);
  }
  const volvio = opcion('sin-reiniciar') || await saludOk();
  log(volvio
    ? `Se volvió a la versión anterior (${actual.slice(0, 7)}). Avisar a soporte.`
    : `ATENCIÓN: tampoco arranca la versión anterior. Restaurar la copia ${copia && copia.nombre} (npm run restaurar, ver docs/INSTALACION.md) y avisar a soporte.`);
  return 'revertido';
}

main().then(r => process.exit(r === 'revertido' ? 2 : 0), e => { log('No se pudo actualizar: ' + e.message); process.exit(1); });

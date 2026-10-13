// Actualiza GastroManager a la última versión de la rama main (la que pasó el CI).
// 1. Si no hay versión nueva, no hace nada.
// 2. Copia de seguridad de la base ANTES de tocar nada.
// 3. Baja el código nuevo (git, solo avance rápido: nunca pisa cambios locales).
// 4. Instala dependencias si cambiaron, reinicia con pm2 y comprueba /api/salud.
// 5. Si la versión nueva no arranca, vuelve sola a la anterior y la reinicia.
//
// Uso:  npm run actualizar                 (en la carpeta de la instalación)
//       node scripts/actualizar.js --solo-revisar   (dice si hay versión nueva, no cambia nada)
// Opciones para pruebas: --sin-npm, --sin-reiniciar, --rama <nombre>
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
  try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, linea + '\n'); } catch (e) {}
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

function instalarDependencias() {
  if (opcion('sin-npm')) return;
  log('Instalando dependencias...');
  correr('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund']);
}
function reiniciar() {
  if (opcion('sin-reiniciar')) return;
  log('Reiniciando el servidor...');
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
  if (cambiaronDeps) instalarDependencias();
  reiniciar();

  // 3. Comprobar que arrancó; si no, volver a la versión anterior
  if (opcion('sin-reiniciar') || await saludOk()) { log(`Actualizado a ${nueva.slice(0, 7)}.`); return 'actualizado'; }
  log('La versión nueva no respondió. Volviendo a la versión anterior...');
  git('reset', '--hard', '--quiet', actual);
  if (cambiaronDeps) instalarDependencias();
  reiniciar();
  const volvio = await saludOk();
  log(volvio
    ? `Se volvió a la versión anterior (${actual.slice(0, 7)}). Avisar a soporte.`
    : `ATENCIÓN: tampoco arranca la versión anterior. Restaurar la copia ${copia && copia.nombre} (ver README) y avisar a soporte.`);
  return 'revertido';
}

main().then(r => process.exit(r === 'revertido' ? 2 : 0), e => { log('No se pudo actualizar: ' + e.message); process.exit(1); });

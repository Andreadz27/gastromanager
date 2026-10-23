// Restaura una copia de seguridad (local o de la nube) sobre la base del sistema.
// 1. Se niega si el servidor está corriendo (hay que detenerlo: pm2 stop morfi).
// 2. Baja la copia de la nube y la descifra (BACKUP_CLAVE), si es de la nube.
// 3. Comprueba que la copia es una base de Morfi sana (integrity_check) ANTES de tocar nada.
// 4. Guarda la base actual en data/backups/antes-de-restaurar_... y recién ahí la reemplaza.
//
// Uso (en la carpeta de la instalación):
//   npm run restaurar -- --listar                 copias locales y de la nube
//   npm run restaurar -- <copia.db>               una copia local (nombre en data/backups o ruta)
//   npm run restaurar -- --nube <nombre>          una copia de la nube (sirve para armar el local en otra PC)
//   npm run restaurar -- --nube --ultima          la copia más nueva de la nube (PC de reemplazo: instalar.ps1 -RestaurarDeLaNube)
// Después: pm2 start morfi
'use strict';
require('../src/env');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3');
const { DATA_DIR, PORT } = require('../src/config');
const { rutaBase } = require('../src/archivo-base');
const { DIR_BACKUPS, listarBackups } = require('../src/servicios/backups');
const { configNube, claveCopias, descifrarCopia, bajarCopiaNube, listarCopiasNube } = require('../src/servicios/copia-nube');

const BASE = rutaBase(DATA_DIR);
const args = process.argv.slice(2);

const abrir = archivo => new sqlite3.Database(archivo, sqlite3.OPEN_READWRITE);
const consulta = (db, sql, p = []) => new Promise((ok, mal) => db.all(sql, p, (e, r) => e ? mal(e) : ok(r)));
const cerrar = db => new Promise(r => db.close(r));

async function servidorCorriendo() {
  try {
    await fetch(`http://127.0.0.1:${PORT}/api/salud`, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch (e) {
    return false;
  }
}

// La copia tiene que abrir, pasar integrity_check y tener las tablas del sistema
async function verificarCopia(archivo) {
  let db;
  try {
    db = abrir(archivo);
    const [{ integrity_check: estado }] = await consulta(db, 'PRAGMA integrity_check');
    if (estado !== 'ok') throw new Error(`la copia está dañada (${estado})`);
    const tablas = (await consulta(db, "SELECT name FROM sqlite_master WHERE type = 'table'")).map(t => t.name);
    for (const t of ['usuarios', 'pedidos', 'productos']) if (!tablas.includes(t)) throw new Error(`no es una base de Morfi (falta la tabla ${t})`);
    const [{ n }] = await consulta(db, 'SELECT COUNT(*) AS n FROM pedidos');
    return { pedidos: n };
  } catch (e) {
    throw new Error(e.message.startsWith('SQLITE_') ? 'el archivo no es una base de datos válida' : e.message);
  } finally {
    if (db) await cerrar(db);
  }
}

// Copia consistente de la base actual (incluye lo que esté en el WAL)
async function resguardarActual() {
  if (!fs.existsSync(BASE)) return null;
  fs.mkdirSync(DIR_BACKUPS, { recursive: true });
  const destino = path.join(DIR_BACKUPS, `antes-de-restaurar_${new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '')}.db`);
  const db = abrir(BASE);
  try { await consulta(db, 'VACUUM INTO ?', [destino]); } finally { await cerrar(db); }
  return destino;
}

async function listar() {
  console.log('Copias en esta PC (data/backups):');
  const locales = listarBackups();
  if (!locales.length) console.log('  (ninguna)');
  for (const c of locales) console.log(`  ${c.nombre}  ${(c.tamano / 1024).toFixed(0)} KB`);
  const cfg = configNube();
  if (!cfg) { console.log('\nCopia en la nube: no configurada en el .env.'); return; }
  console.log(`\nCopias en la nube (${cfg.bucket}/${cfg.prefijo || ''}):`);
  const remotas = await listarCopiasNube(cfg);
  if (!remotas.length) console.log('  (ninguna)');
  for (const c of remotas) console.log(`  ${c.nombre}  ${(c.tamano / 1024).toFixed(0)} KB  ${c.fecha}`);
}

async function restaurar() {
  const desdeNube = args.includes('--nube');
  const ultima = args.includes('--ultima');
  let nombre = ultima ? null : desdeNube ? args[args.indexOf('--nube') + 1] : args.find(a => !a.startsWith('--'));
  if (!nombre && !(ultima && desdeNube)) throw new Error('Indicá qué copia restaurar (npm run restaurar -- --listar para verlas).');
  if (await servidorCorriendo()) throw new Error('El servidor está corriendo. Detenelo primero: pm2 stop morfi');

  // La copia a restaurar queda primero en un archivo temporal: la base no se toca hasta verificarla
  const temporal = path.join(os.tmpdir(), `gm-restaurar-${process.pid}.db`);
  try {
    if (desdeNube) {
      const cfg = configNube();
      if (!cfg) throw new Error('La copia en la nube no está configurada en el .env (BACKUP_S3_*).');
      if (ultima) {
        const [masNueva] = await listarCopiasNube(cfg);
        if (!masNueva) throw new Error(`No hay copias en la nube (${cfg.bucket}/${cfg.prefijo || ''}).`);
        nombre = masNueva.nombre;
        console.log(`Copia más nueva de la nube: ${nombre} (${masNueva.fecha})`);
      }
      console.log(`Bajando ${nombre} de la nube...`);
      fs.writeFileSync(temporal, descifrarCopia(await bajarCopiaNube(cfg, nombre), claveCopias()));
    } else {
      const origen = fs.existsSync(nombre) ? nombre : path.join(DIR_BACKUPS, path.basename(nombre));
      if (!fs.existsSync(origen)) throw new Error(`No existe la copia ${nombre}`);
      fs.writeFileSync(temporal, descifrarCopia(fs.readFileSync(origen), claveCopias()));
    }
    const { pedidos } = await verificarCopia(temporal);
    console.log(`Copia verificada: ${pedidos} pedidos.`);

    const resguardo = await resguardarActual();
    if (resguardo) console.log(`Base actual guardada en ${path.relative(process.cwd(), resguardo)}`);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    for (const extra of ['-wal', '-shm']) fs.rmSync(BASE + extra, { force: true });
    fs.copyFileSync(temporal, BASE);
    console.log('Copia restaurada. Ahora: pm2 start morfi');
  } finally {
    fs.rmSync(temporal, { force: true });
  }
}

(args.includes('--listar') ? listar() : restaurar())
  .then(() => process.exit(0), e => { console.error('No se pudo restaurar: ' + e.message); process.exit(1); });

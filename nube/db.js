'use strict';
// Morfi Nube: base de datos (SQLite). Cuentas (un dueño o empresa), sus locales, los usuarios del panel
// y las ventas que manda cada local. No se guardan datos personales de los clientes: solo productos e importes.
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

const DIR = process.env.NUBE_DATOS || path.join(__dirname, 'datos');
fs.mkdirSync(DIR, { recursive: true });
const db = new sqlite3.Database(path.join(DIR, 'nube.db'));
db.configure('busyTimeout', 10000);

const run = (sql, p = []) => new Promise((ok, mal) => db.run(sql, p, function (e) { e ? mal(e) : ok({ id: this.lastID, changes: this.changes }); }));
const get = (sql, p = []) => new Promise((ok, mal) => db.get(sql, p, (e, r) => e ? mal(e) : ok(r)));
const all = (sql, p = []) => new Promise((ok, mal) => db.all(sql, p, (e, r) => e ? mal(e) : ok(r)));

// Varias escrituras como una sola (una tanda de ventas entra entera o no entra)
let cola = Promise.resolve();
function transaccion(fn) {
  const r = cola.then(async () => {
    await run('BEGIN IMMEDIATE');
    try { const v = await fn(); await run('COMMIT'); return v; } catch (e) { await run('ROLLBACK').catch(() => {}); throw e; }
  });
  cola = r.catch(() => {});
  return r;
}

const listo = (async () => {
  await run('PRAGMA journal_mode = WAL');
  await run(`CREATE TABLE IF NOT EXISTS cuentas (
    id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL, creado_en TEXT DEFAULT CURRENT_TIMESTAMP)`);
  // rol: duenio (ve los locales de su cuenta) o soporte (ve todos, para atender a los clientes)
  await run(`CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT, cuenta_id INTEGER, nombre TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL, rol TEXT NOT NULL DEFAULT 'duenio', creado_en TEXT DEFAULT CURRENT_TIMESTAMP)`);
  // token_hash: el local manda el token (lo tiene en su .env); acá solo se guarda su hash
  await run(`CREATE TABLE IF NOT EXISTS locales (
    id INTEGER PRIMARY KEY AUTOINCREMENT, cuenta_id INTEGER NOT NULL, nombre TEXT NOT NULL, cliente TEXT NOT NULL UNIQUE,
    token_hash TEXT NOT NULL UNIQUE, ultima_sync TEXT, estado TEXT DEFAULT '{}', creado_en TEXT DEFAULT CURRENT_TIMESTAMP)`);
  // fecha: el día del negocio en el local (AAAA-MM-DD), así no depende de la zona horaria del servidor
  await run(`CREATE TABLE IF NOT EXISTS ventas (
    local_id INTEGER NOT NULL, pedido_id INTEGER NOT NULL, numero TEXT, fecha TEXT NOT NULL, hora TEXT, estado TEXT NOT NULL,
    tipo TEXT, metodo TEXT, total REAL DEFAULT 0, propina REAL DEFAULT 0, descuento REAL DEFAULT 0,
    recibido_en TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (local_id, pedido_id))`);
  await run('CREATE INDEX IF NOT EXISTS idx_ventas_fecha ON ventas(fecha, local_id)');
  await run(`CREATE TABLE IF NOT EXISTS ventas_items (
    local_id INTEGER NOT NULL, pedido_id INTEGER NOT NULL, producto TEXT NOT NULL, cantidad REAL NOT NULL, subtotal REAL NOT NULL)`);
  await run('CREATE INDEX IF NOT EXISTS idx_items_pedido ON ventas_items(local_id, pedido_id)');
})();

const cerrar = () => new Promise(r => db.close(r));

module.exports = { db, run, get, all, transaccion, listo, cerrar, DIR };

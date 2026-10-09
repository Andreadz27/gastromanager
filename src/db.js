'use strict';
// Conexiones SQLite, helpers run/get/all y transacciones
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { AsyncLocalStorage } = require('async_hooks');
const { DATA_DIR } = require('./config');

// Contexto de la transacción en curso (ver transaccion()): conexión y eventos pendientes
const txContexto = new AsyncLocalStorage();

// Emisor de eventos en tiempo real; lo registra realtime.js al iniciar Socket.IO
let emisor = () => {};
const setEmisor = fn => { emisor = fn; };

// Base de datos
const dbPath = path.join(DATA_DIR, 'gastromanager.db');
const db = new sqlite3.Database(dbPath);
db.configure('busyTimeout', 10000);
// WAL: las lecturas no se bloquean mientras hay una escritura en curso
// Las transacciones (dbTx) esperan a que termine: SQLite no cambia a WAL con otra transacción abierta
const listo = new Promise(resolve => db.run('PRAGMA journal_mode = WAL', err => {
  if (err) console.error('[db] No se pudo activar WAL:', err.message);
  resolve();
}));
// Activar claves foráneas
db.run('PRAGMA foreign_keys = ON');

// Conexión exclusiva para transacciones. SQLite no permite transacciones
// independientes sobre una misma conexión compartida por pedidos concurrentes.
const dbTx = new sqlite3.Database(dbPath);
dbTx.configure('busyTimeout', 10000);
dbTx.run('PRAGMA foreign_keys = ON');

// ============ Utilidades ============
// run/get/all usan la conexión de la transacción en curso, si la hay
const conexion = () => { const ctx = txContexto.getStore(); return ctx ? ctx.db : db; };

const run = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    conexion().run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
};

const get = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    conexion().get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const all = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    conexion().all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

// Ejecuta fn de forma atómica: o se guarda todo o nada. Las transacciones se
// ejecutan de a una (cola). No hacer llamadas HTTP externas dentro de fn.
let colaTx = listo;
function transaccion(fn) {
  if (txContexto.getStore()) return fn(); // ya estamos dentro de una transacción
  const ejecutar = () => {
    const ctx = { db: dbTx, eventos: [] };
    return txContexto.run(ctx, async () => {
      await run('BEGIN IMMEDIATE');
      let resultado;
      try {
        resultado = await fn();
        await run('COMMIT');
      } catch (err) {
        await run('ROLLBACK').catch(() => {});
        throw err;
      }
      for (const [evento, data] of ctx.eventos) {
        try { emisor(evento, data); } catch (e) {}
      }
      return resultado;
    });
  };
  const p = colaTx.then(ejecutar, ejecutar);
  colaTx = p.catch(() => {});
  return p;
}

module.exports = { db, dbTx, txContexto, run, get, all, transaccion, setEmisor };

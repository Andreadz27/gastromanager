// corregir-carta-demo.js — Repara la carta de demostración "La Buena Mesa".
//
// demo_seed.js enviaba { precio, categoria, stock } pero la API espera
// { precio_venta, categoria_id, stock_actual }: los productos quedaron en $0, sin
// categoría y sin stock. Además, editar un producto lo dejaba con activo = NULL
// (desaparecía del POS). Este script:
//   1. hace una copia de seguridad en data/backups/
//   2. crea las categorías que falten
//   3. completa precio, categoría y stock de los productos de la carta que sigan en $0
//   4. reactiva los productos de la carta ocultos por activo = NULL
//   5. desactiva (activo = 0) los demás productos con activo = NULL
// Es idempotente: no modifica productos que ya tengan precio.
//
// Uso: node scripts/corregir-carta-demo.js   (el servidor puede estar andando)

const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3');
const { PRODUCTOS } = require('./seed-data');

const DB = path.join(__dirname, '..', 'data', 'gastromanager.db');
const db = new sqlite3.Database(DB);
db.configure('busyTimeout', 10000);
const run = (sql, p = []) => new Promise((ok, mal) => db.run(sql, p, function (e) { e ? mal(e) : ok(this); }));
const get = (sql, p = []) => new Promise((ok, mal) => db.get(sql, p, (e, r) => e ? mal(e) : ok(r)));

// Categoría de seed-data.js → categoría del sistema
const CATEGORIAS = {
  Entradas: 'Entradas',
  Principales: 'Platos Principales',
  Ensaladas: 'Ensaladas',
  Postres: 'Postres',
  Bebidas: 'Bebidas',
  Guarniciones: 'Guarniciones'
};
const ALCOHOL = /vino|cerveza/i;

async function idCategoria(nombre) {
  const existente = await get('SELECT id FROM categorias WHERE nombre = ?', [nombre]);
  if (existente) return existente.id;
  const { m } = await get('SELECT COALESCE(MAX(orden), 0) AS m FROM categorias');
  const r = await run('INSERT INTO categorias (nombre, orden) VALUES (?, ?)', [nombre, m + 1]);
  console.log(`  categoría creada: ${nombre}`);
  return r.lastID;
}

(async () => {
  // 1. Copia de seguridad
  const dir = path.join(__dirname, '..', 'data', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const destino = path.join(dir, `antes-corregir-carta_${Date.now()}.db`);
  await run('VACUUM INTO ?', [destino]);
  console.log('Copia de seguridad:', destino);

  await run('BEGIN IMMEDIATE');
  try {
    let corregidos = 0, reactivados = 0;
    for (const p of PRODUCTOS) {
      const nombreCat = ALCOHOL.test(p.nombre) ? 'Bebidas Alcohólicas' : (CATEGORIAS[p.categoria] || p.categoria);
      const catId = await idCategoria(nombreCat);
      const prod = await get(
        'SELECT id, activo FROM productos WHERE nombre = ? AND (activo = 1 OR activo IS NULL) AND precio_venta = 0 ORDER BY id DESC LIMIT 1',
        [p.nombre]);
      if (!prod) continue;
      await run(
        `UPDATE productos SET precio_venta = ?, categoria_id = ?, descripcion = ?, tracking_stock = 1,
           stock_actual = ?, stock_minimo = ?, activo = 1 WHERE id = ?`,
        [p.precio, catId, p.descripcion || '', p.stock, Math.ceil(p.stock * 0.2), prod.id]);
      corregidos++;
      if (prod.activo === null) { reactivados++; console.log(`  reactivado: ${p.nombre}`); }
    }
    const { changes: desactivados } = await run('UPDATE productos SET activo = 0, stock_actual = COALESCE(stock_actual, 0) WHERE activo IS NULL');
    await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (NULL, ?, ?)',
      ['corregir_carta', `Carta demo: ${corregidos} productos con precio/categoría/stock, ${reactivados} reactivados, ${desactivados} desactivados`]);
    await run('COMMIT');
    console.log(`Listo: ${corregidos} productos corregidos, ${reactivados} reactivados, ${desactivados} productos viejos desactivados.`);
  } catch (e) {
    await run('ROLLBACK').catch(() => {});
    console.error('Error, no se modificó nada:', e.message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
})();

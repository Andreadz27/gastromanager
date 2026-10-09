'use strict';
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const { run, get, all, transaccion } = require('./db');

// ============ Migraciones de esquema (se ejecutan al iniciar) ============
async function agregarColumna(tabla, columna, definicion) {
  const cols = await all(`PRAGMA table_info(${tabla})`);
  if (!cols.some(c => c.name === columna)) {
    await run(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${definicion}`);
  }
}

async function migrarEsquema() {
  // Config de integraciones (MP, AFIP, Tienda Nube) como clave/valor JSON
  await run(`CREATE TABLE IF NOT EXISTS integraciones_config (
    clave TEXT PRIMARY KEY,
    valor TEXT NOT NULL DEFAULT '{}',
    actualizado_en TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`CREATE TABLE IF NOT EXISTS comprobantes_afip (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pedido_id INTEGER, tipo_comprobante INTEGER, tipo_comprobante_nombre TEXT,
    punto_venta INTEGER, numero_comprobante INTEGER,
    cae TEXT, cae_vencimiento TEXT, fecha_comprobante TEXT, total REAL,
    creado_en TEXT DEFAULT (datetime('now','localtime'))
  )`);
  await agregarColumna('pedidos', 'origen', "TEXT DEFAULT ''");
  await agregarColumna('pedidos', 'metodo_pago', "TEXT DEFAULT ''");
  await agregarColumna('pedidos', 'mp_payment_id', "TEXT DEFAULT ''");
  // Arqueo de caja
  await agregarColumna('caja', 'monto_esperado', 'REAL');
  await agregarColumna('caja', 'diferencia', 'REAL');
  await agregarColumna('caja', 'resumen', 'TEXT');
  await agregarColumna('caja', 'observaciones_cierre', "TEXT DEFAULT ''");
  await run('CREATE INDEX IF NOT EXISTS idx_caja_estado ON caja(estado)');
  // Roles: el antiguo "vendedor" pasa a "cajero" (mismos permisos)
  await run("UPDATE usuarios SET rol = 'cajero' WHERE rol = 'vendedor'");

  // Impresoras térmicas (comandas por estación y tickets) y registro de impresiones
  await run(`CREATE TABLE IF NOT EXISTS impresoras (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    tipo TEXT NOT NULL DEFAULT 'red',
    destino TEXT NOT NULL,
    ancho INTEGER NOT NULL DEFAULT 80,
    imprime_comandas INTEGER NOT NULL DEFAULT 1,
    imprime_tickets INTEGER NOT NULL DEFAULT 0,
    categorias TEXT NOT NULL DEFAULT '[]',
    copias INTEGER NOT NULL DEFAULT 1,
    activa INTEGER NOT NULL DEFAULT 1,
    creado_en TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`CREATE TABLE IF NOT EXISTS impresiones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    impresora_id INTEGER,
    impresora_nombre TEXT,
    tipo TEXT,
    pedido_id INTEGER,
    estado TEXT,
    error TEXT,
    fecha TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await agregarColumna('productos', 'tn_product_id', 'INTEGER');
  await agregarColumna('productos', 'tn_variant_id', 'INTEGER');

  // Contraseñas por defecto: obligar a cambiarlas en el próximo ingreso
  const colPassNueva = !(await all('PRAGMA table_info(usuarios)')).some(c => c.name === 'debe_cambiar_password');
  await agregarColumna('usuarios', 'debe_cambiar_password', 'INTEGER DEFAULT 0');
  if (colPassNueva) {
    for (const u of await all('SELECT id, password FROM usuarios')) {
      const pass = String(u.password || '');
      const esDefecto = pass.startsWith('$2')
        ? (await bcrypt.compare('admin123', pass)) || (await bcrypt.compare('123456', pass))
        : ['admin123', '123456'].includes(pass);
      if (esDefecto) await run('UPDATE usuarios SET debe_cambiar_password = 1 WHERE id = ?', [u.id]);
    }
  }

  // Numeración secuencial de pedidos
  await run(`CREATE TABLE IF NOT EXISTS secuencias (nombre TEXT PRIMARY KEY, valor INTEGER NOT NULL)`);
  await run(`INSERT OR IGNORE INTO secuencias (nombre, valor)
             SELECT 'pedido', COALESCE(MAX(id), 0) FROM pedidos`);
  // Corregir duplicados heredados del generador anterior (basado en hora) y garantizar unicidad
  await run(`UPDATE pedidos SET numero_pedido = numero_pedido || '-' || id
             WHERE id NOT IN (SELECT MIN(id) FROM pedidos GROUP BY numero_pedido)`);
  await run('CREATE UNIQUE INDEX IF NOT EXISTS idx_pedidos_numero ON pedidos(numero_pedido)');
  await run('CREATE INDEX IF NOT EXISTS idx_pedidos_mp_payment ON pedidos(mp_payment_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_comprobantes_pedido ON comprobantes_afip(pedido_id)');

  // Contabilidad: gastos y compras con su comprobante (cuentas a pagar e IVA compras)
  await run(`CREATE TABLE IF NOT EXISTS gastos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT NOT NULL,
    categoria TEXT NOT NULL,
    proveedor_id INTEGER,
    descripcion TEXT NOT NULL DEFAULT '',
    tipo_comprobante TEXT NOT NULL DEFAULT 'sin_comprobante',
    numero_comprobante TEXT NOT NULL DEFAULT '',
    neto REAL NOT NULL DEFAULT 0,
    iva REAL NOT NULL DEFAULT 0,
    otros_impuestos REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    estado TEXT NOT NULL DEFAULT 'pendiente',
    vencimiento TEXT,
    fecha_pago TEXT,
    metodo_pago TEXT NOT NULL DEFAULT '',
    caja_movimiento_id INTEGER,
    usuario_id INTEGER,
    anulado INTEGER NOT NULL DEFAULT 0,
    creado_en TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (proveedor_id) REFERENCES proveedores(id),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
  )`);
  await run('CREATE INDEX IF NOT EXISTS idx_gastos_fecha ON gastos(fecha)');
  await run('CREATE INDEX IF NOT EXISTS idx_gastos_estado ON gastos(estado, anulado)');
}

// ============ Migración segura (lo que usa server.js) ============
// 1. Si este archivo cambió desde la última vez (hay migraciones nuevas) y la base ya tenía datos,
//    se hace una copia de seguridad ANTES de migrar: esa copia es la marcha atrás.
// 2. Todas las migraciones corren en UNA transacción: si una falla, la base queda como estaba.
// Restaurar a mano: detener el servidor y reemplazar data/gastromanager.db por la copia (ver README).
const HUELLA_MIGRACIONES = crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex').slice(0, 16);

async function migrarConRespaldo({ respaldar } = {}) {
  const tieneDatos = !!(await get("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'usuarios'"));
  const meta = await get("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'meta'");
  const huella = meta ? (await get("SELECT valor FROM meta WHERE clave = 'huella_migraciones'")) : null;
  let respaldo = null;
  if (tieneDatos && (!huella || huella.valor !== HUELLA_MIGRACIONES) && respaldar) {
    respaldo = await respaldar();
    console.log(`[migraciones] Copia previa a migrar: ${respaldo && respaldo.nombre}`);
  }
  await transaccion(async () => {
    await migrarEsquema();
    await run('CREATE TABLE IF NOT EXISTS meta (clave TEXT PRIMARY KEY, valor TEXT NOT NULL)');
    await run("INSERT INTO meta (clave, valor) VALUES ('huella_migraciones', ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor",
      [HUELLA_MIGRACIONES]);
  });
  return { respaldo };
}

module.exports = { migrarEsquema, migrarConRespaldo, HUELLA_MIGRACIONES };

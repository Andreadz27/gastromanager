'use strict';
const bcrypt = require('bcryptjs');
const { run, all } = require('./db');

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
}

module.exports = { migrarEsquema };

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
  // Receptor e importes de cada comprobante, y la factura que anula cada nota de crédito
  await agregarColumna('comprobantes_afip', 'imp_neto', 'REAL');
  await agregarColumna('comprobantes_afip', 'imp_iva', 'REAL');
  await agregarColumna('comprobantes_afip', 'cuit_receptor', "TEXT DEFAULT ''");
  await agregarColumna('comprobantes_afip', 'razon_social_receptor', "TEXT DEFAULT ''");
  await agregarColumna('comprobantes_afip', 'condicion_iva_receptor', 'INTEGER');
  await agregarColumna('comprobantes_afip', 'comprobante_asociado_id', 'INTEGER');
  await agregarColumna('comprobantes_afip', 'motivo', "TEXT DEFAULT ''");
  // homologacion | produccion ('' = anterior a guardarlo): las facturas de prueba no tienen validez fiscal
  await agregarColumna('comprobantes_afip', 'modo', "TEXT DEFAULT ''");
  await run('CREATE INDEX IF NOT EXISTS idx_comprobantes_asociado ON comprobantes_afip(comprobante_asociado_id)');
  // Facturas en espera: sin conexión con ARCA el cobro sigue y la factura se emite sola cuando vuelve internet.
  // estado: pendiente | emitida | error (ARCA la rechazó: la revisa una persona). numero_intentado: ver comprobanteYaEmitido
  await run(`CREATE TABLE IF NOT EXISTS facturas_pendientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pedido_id INTEGER NOT NULL,
    tipo_comprobante INTEGER NOT NULL,
    cuit_receptor TEXT DEFAULT '',
    condicion_iva_receptor INTEGER,
    razon_social_receptor TEXT DEFAULT '',
    estado TEXT DEFAULT 'pendiente',
    intentos INTEGER DEFAULT 0,
    numero_intentado INTEGER,
    ultimo_error TEXT DEFAULT '',
    comprobante_id INTEGER,
    creado_en TEXT DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await run('CREATE INDEX IF NOT EXISTS idx_facturas_pendientes ON facturas_pendientes(estado, pedido_id)');
  // WhatsApp Business: mensajes enviados (con su estado) y recibidos
  await run(`CREATE TABLE IF NOT EXISTS whatsapp_mensajes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telefono TEXT NOT NULL, plantilla TEXT NOT NULL DEFAULT '', motivo TEXT NOT NULL DEFAULT '',
    referencia INTEGER, parametros TEXT NOT NULL DEFAULT '[]',
    estado TEXT NOT NULL DEFAULT 'enviando', wa_message_id TEXT NOT NULL DEFAULT '', error TEXT,
    creado_en TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await run('CREATE INDEX IF NOT EXISTS idx_wa_mensajes_motivo ON whatsapp_mensajes(motivo, referencia)');
  await run('CREATE INDEX IF NOT EXISTS idx_wa_mensajes_wa_id ON whatsapp_mensajes(wa_message_id)');
  await run(`CREATE TABLE IF NOT EXISTS whatsapp_entrantes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wa_message_id TEXT NOT NULL UNIQUE, telefono TEXT NOT NULL DEFAULT '', nombre TEXT NOT NULL DEFAULT '',
    texto TEXT NOT NULL DEFAULT '', leido INTEGER NOT NULL DEFAULT 0,
    creado_en TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await agregarColumna('pedidos', 'origen', "TEXT DEFAULT ''");
  await agregarColumna('pedidos', 'metodo_pago', "TEXT DEFAULT ''");
  await agregarColumna('pedidos', 'mp_payment_id', "TEXT DEFAULT ''");
  // Cocina: cuándo se marcó listo (sale de la pantalla de cocina; vuelve si se agregan ítems)
  await agregarColumna('pedidos', 'listo_en', 'TEXT');
  // Control de caja: PIN de autorización de encargados y arqueo ciego (apagados por defecto)
  await agregarColumna('usuarios', 'pin_hash', "TEXT DEFAULT ''");
  await agregarColumna('configuracion', 'pin_autorizacion', 'INTEGER DEFAULT 0');
  await agregarColumna('configuracion', 'arqueo_ciego', 'INTEGER DEFAULT 0');
  // Cobro en la mesa: los mozos pueden cobrar y facturar sus mesas (apagado por defecto)
  await agregarColumna('configuracion', 'mozo_cobra_mesa', 'INTEGER DEFAULT 0');
  // Pedido desde el QR de la mesa: confirmar (el mozo revisa), directo (va a cocina) o solo_carta (no se pide)
  await agregarColumna('configuracion', 'qr_mesa_modo', "TEXT DEFAULT 'confirmar'");
  // Clave del QR de cada mesa: con el número de mesa solo, cualquiera podría pedir a nombre de otra
  await agregarColumna('mesas', 'qr_token', 'TEXT');
  await run('CREATE UNIQUE INDEX IF NOT EXISTS idx_mesas_qr_token ON mesas(qr_token)');
  for (const m of await all('SELECT id FROM mesas WHERE qr_token IS NULL'))
    await run('UPDATE mesas SET qr_token = ? WHERE id = ?', [crypto.randomBytes(12).toString('hex'), m.id]);
  // Lo que piden los clientes desde la mesa (pedido, llamar al mozo, la cuenta) hasta que el mozo lo resuelve
  await run(`CREATE TABLE IF NOT EXISTS solicitudes_mesa (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mesa_id INTEGER NOT NULL,
    tipo TEXT NOT NULL,
    items TEXT DEFAULT '[]',
    notas TEXT DEFAULT '',
    cliente TEXT DEFAULT '',
    estado TEXT DEFAULT 'pendiente',
    motivo TEXT DEFAULT '',
    pedido_id INTEGER,
    usuario_id INTEGER,
    creado_en TEXT DEFAULT CURRENT_TIMESTAMP,
    resuelto_en TEXT
  )`);
  await run('CREATE INDEX IF NOT EXISTS idx_solicitudes_mesa ON solicitudes_mesa(estado, mesa_id)');
  // Pago desde la mesa con Mercado Pago: cada link que abre un cliente (toda la cuenta o su parte, con su propina)
  await run(`CREATE TABLE IF NOT EXISTS pagos_mesa (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pedido_id INTEGER NOT NULL,
    mesa_id INTEGER NOT NULL,
    monto REAL NOT NULL,
    propina REAL DEFAULT 0,
    partes INTEGER DEFAULT 1,
    estado TEXT DEFAULT 'pendiente',
    preferencia_id TEXT DEFAULT '',
    payment_id TEXT DEFAULT '',
    telefono TEXT DEFAULT '',
    comprobante_enviado INTEGER DEFAULT 0,
    creado_en TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await run('CREATE INDEX IF NOT EXISTS idx_pagos_mesa_pedido ON pagos_mesa(pedido_id)');
  // Personal: fichadas (entrada y salida, horas en UTC como CURRENT_TIMESTAMP), turnos planificados y repartos de propinas
  await run(`CREATE TABLE IF NOT EXISTS fichajes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL,
    entrada TEXT NOT NULL,
    salida TEXT,
    corregido_por INTEGER,
    motivo_correccion TEXT DEFAULT '',
    creado_en TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await run('CREATE INDEX IF NOT EXISTS idx_fichajes_usuario ON fichajes(usuario_id, entrada)');
  // Una sola fichada abierta por persona (dos toques seguidos en "Fichar" no abren dos)
  await run('CREATE UNIQUE INDEX IF NOT EXISTS idx_fichajes_abierto ON fichajes(usuario_id) WHERE salida IS NULL');
  // fecha AAAA-MM-DD y horas HH:MM del negocio; si fin < inicio el turno termina al día siguiente
  await run(`CREATE TABLE IF NOT EXISTS turnos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL,
    fecha TEXT NOT NULL,
    inicio TEXT NOT NULL,
    fin TEXT NOT NULL,
    puesto TEXT DEFAULT '',
    notas TEXT DEFAULT '',
    creado_por INTEGER,
    creado_en TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await run('CREATE INDEX IF NOT EXISTS idx_turnos_fecha ON turnos(fecha, usuario_id)');
  // detalle: [{ usuario_id, nombre, horas, monto }]. estado: pendiente | pagado | anulado
  await run(`CREATE TABLE IF NOT EXISTS repartos_propinas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    desde TEXT NOT NULL,
    hasta TEXT NOT NULL,
    total REAL NOT NULL,
    metodo TEXT NOT NULL,
    detalle TEXT NOT NULL DEFAULT '[]',
    estado TEXT DEFAULT 'pendiente',
    medio_pago TEXT DEFAULT '',
    caja_movimiento_id INTEGER,
    pagado_en TEXT,
    creado_por INTEGER,
    creado_en TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  // ---- Fidelización: puntos, cupones y gift cards ----
  // El pedido guarda su cliente y los descuentos de fidelización aparte del descuento manual
  await agregarColumna('pedidos', 'cliente_id', 'INTEGER');
  await agregarColumna('pedidos', 'puntos_canjeados', 'INTEGER DEFAULT 0');
  await agregarColumna('pedidos', 'descuento_puntos', 'REAL DEFAULT 0');
  await agregarColumna('pedidos', 'cupon_id', 'INTEGER');
  await agregarColumna('pedidos', 'descuento_cupon', 'REAL DEFAULT 0');
  // Morfi Nube: estado con el que el pedido se mandó a la nube (si cambia, por ej. se cancela, se vuelve a mandar)
  await agregarColumna('pedidos', 'sincronizado_nube', 'TEXT');
  // Pedido online que entró por Morfi Nube: su id allá (traerlo dos veces no lo duplica)
  await agregarColumna('pedidos', 'nube_pedido_id', 'INTEGER');
  await run('CREATE UNIQUE INDEX IF NOT EXISTS idx_pedidos_nube ON pedidos(nube_pedido_id) WHERE nube_pedido_id IS NOT NULL');
  // Puntos: 1 punto cada $puntos_cada consumidos; cada punto vale $puntos_valor al canjear (desde puntos_minimo)
  await agregarColumna('configuracion', 'puntos_activo', 'INTEGER DEFAULT 0');
  await agregarColumna('configuracion', 'puntos_cada', 'REAL DEFAULT 1000');
  await agregarColumna('configuracion', 'puntos_valor', 'REAL DEFAULT 10');
  await agregarColumna('configuracion', 'puntos_minimo', 'INTEGER DEFAULT 50');
  // clientes.puntos es el saldo; cada cambio queda en puntos_movimientos (gana, canje, devolucion, ajuste)
  await run(`CREATE TABLE IF NOT EXISTS puntos_movimientos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id INTEGER NOT NULL,
    pedido_id INTEGER,
    puntos INTEGER NOT NULL,
    tipo TEXT NOT NULL,
    detalle TEXT DEFAULT '',
    usuario_id INTEGER,
    creado_en TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await run('CREATE INDEX IF NOT EXISTS idx_puntos_cliente ON puntos_movimientos(cliente_id)');
  // Saldo inicial: los puntos que ya tenían los clientes (cargados a mano antes) quedan como ajuste
  if (!(await get('SELECT 1 AS x FROM puntos_movimientos LIMIT 1')))
    await run(`INSERT INTO puntos_movimientos (cliente_id, puntos, tipo, detalle)
      SELECT id, puntos, 'ajuste', 'Saldo anterior a fidelización' FROM clientes WHERE COALESCE(puntos, 0) != 0`);
  await run(`CREATE TABLE IF NOT EXISTS cupones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo TEXT NOT NULL UNIQUE,
    descripcion TEXT DEFAULT '',
    tipo TEXT NOT NULL DEFAULT 'porcentaje',
    valor REAL NOT NULL,
    minimo REAL DEFAULT 0,
    desde TEXT,
    hasta TEXT,
    usos_max INTEGER,
    usos_por_cliente INTEGER,
    activo INTEGER DEFAULT 1,
    creado_en TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  // Un uso por pedido (se borra si el pedido se cancela o se saca el cupón)
  await run(`CREATE TABLE IF NOT EXISTS cupon_usos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cupon_id INTEGER NOT NULL,
    pedido_id INTEGER NOT NULL UNIQUE,
    cliente_id INTEGER,
    descuento REAL NOT NULL,
    creado_en TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  // Gift card: se cobra al venderla (queda como deuda con el cliente) y se usa como medio de pago
  await run(`CREATE TABLE IF NOT EXISTS gift_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo TEXT NOT NULL UNIQUE,
    monto REAL NOT NULL,
    saldo REAL NOT NULL,
    vence TEXT,
    comprador TEXT DEFAULT '',
    destinatario TEXT DEFAULT '',
    medio_cobro TEXT NOT NULL,
    caja_movimiento_id INTEGER,
    estado TEXT DEFAULT 'activa',
    usuario_id INTEGER,
    fecha TEXT NOT NULL,
    creado_en TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`CREATE TABLE IF NOT EXISTS gift_card_movimientos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gift_card_id INTEGER NOT NULL,
    pedido_id INTEGER,
    monto REAL NOT NULL,
    tipo TEXT NOT NULL,
    usuario_id INTEGER,
    creado_en TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
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
// Restaurar: npm run restaurar (ver docs/INSTALACION.md).
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

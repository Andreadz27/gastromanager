// =============================================
// GASTROMANAGER - Inicialización de Base de Datos
// Crea todas las tablas y datos iniciales
// =============================================

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Asegurar carpeta data (GM_DATA_DIR permite usar otra carpeta, por ejemplo en los tests)
const dataDir = process.env.GM_DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new sqlite3.Database(path.join(dataDir, 'gastromanager.db'));

db.serialize(() => {
  // ============ TABLAS BASE ============

  // Usuarios del sistema
  db.run(`CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    rol TEXT NOT NULL DEFAULT 'vendedor',
    activo INTEGER DEFAULT 1,
    creado_en TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  // Configuración del negocio
  db.run(`CREATE TABLE IF NOT EXISTS configuracion (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    nombre_negocio TEXT NOT NULL DEFAULT 'Mi Restaurante',
    direccion TEXT DEFAULT '',
    telefono TEXT DEFAULT '',
    email TEXT DEFAULT '',
    cuit TEXT DEFAULT '',
    tasa_iva INTEGER DEFAULT 21,
    moneda TEXT DEFAULT 'ARS',
    logo BLOB,
    impresora_nombre TEXT DEFAULT '',
    activar_impresion INTEGER DEFAULT 1,
    tipo_negocio TEXT DEFAULT 'restaurante_mediano',
    modulos_activos TEXT DEFAULT '["pos","mesas","pedidos","delivery","cocina","productos","stock","proveedores","clientes","caja","reportes"]',
    terminologia TEXT DEFAULT '{}',
    setup_completado INTEGER DEFAULT 0
  )`);

  // Migraciones seguras para bases de datos existentes (ignoran error si la columna ya existe)
  db.run(`ALTER TABLE configuracion ADD COLUMN tipo_negocio TEXT DEFAULT 'restaurante_mediano'`, () => {});
  db.run(`ALTER TABLE configuracion ADD COLUMN modulos_activos TEXT DEFAULT '["pos","mesas","pedidos","delivery","cocina","productos","stock","proveedores","clientes","caja","reportes"]'`, () => {});
  db.run(`ALTER TABLE configuracion ADD COLUMN terminologia TEXT DEFAULT '{}'`, () => {});
  db.run(`ALTER TABLE configuracion ADD COLUMN setup_completado INTEGER DEFAULT 0`, () => {});
  db.run(`ALTER TABLE pedidos ADD COLUMN origen TEXT DEFAULT ''`, () => {});

  // Categorías de productos
  db.run(`CREATE TABLE IF NOT EXISTS categorias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL UNIQUE,
    descripcion TEXT DEFAULT '',
    color TEXT DEFAULT '#4CAF50',
    orden INTEGER DEFAULT 0,
    activo INTEGER DEFAULT 1
  )`);

  // Productos / Platos
  db.run(`CREATE TABLE IF NOT EXISTS productos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    descripcion TEXT DEFAULT '',
    categoria_id INTEGER,
    precio_venta REAL DEFAULT 0,
    costo REAL DEFAULT 0,
    es_plato INTEGER DEFAULT 0,
    tracking_stock INTEGER DEFAULT 0,
    stock_actual REAL DEFAULT 0,
    stock_minimo REAL DEFAULT 0,
    unidad TEXT DEFAULT 'unidad',
    es_combo INTEGER DEFAULT 0,
    activo INTEGER DEFAULT 1,
    creado_en TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (categoria_id) REFERENCES categorias(id)
  )`);

  // Recetas (ingredientes de un plato)
  db.run(`CREATE TABLE IF NOT EXISTS recetas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plato_id INTEGER NOT NULL,
    ingrediente_id INTEGER NOT NULL,
    cantidad REAL DEFAULT 0,
    unidad TEXT DEFAULT 'unidad',
    FOREIGN KEY (plato_id) REFERENCES productos(id),
    FOREIGN KEY (ingrediente_id) REFERENCES productos(id)
  )`);

  // Mesas / Salón
  db.run(`CREATE TABLE IF NOT EXISTS mesas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL UNIQUE,
    capacidad INTEGER DEFAULT 4,
    estado TEXT DEFAULT 'libre',
    sector TEXT DEFAULT 'principal',
    orden INTEGER DEFAULT 0
  )`);

  // Pedidos / Comandas
  db.run(`CREATE TABLE IF NOT EXISTS pedidos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero_pedido TEXT NOT NULL,
    tipo TEXT DEFAULT 'salon',
    mesa_id INTEGER,
    cliente TEXT DEFAULT '',
    estado TEXT DEFAULT 'abierto',
    subtotal REAL DEFAULT 0,
    descuento REAL DEFAULT 0,
    total REAL DEFAULT 0,
    propina REAL DEFAULT 0,
    usuario_id INTEGER,
    notas TEXT DEFAULT '',
    creado_en TEXT DEFAULT CURRENT_TIMESTAMP,
    cerrado_en TEXT,
    FOREIGN KEY (mesa_id) REFERENCES mesas(id),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
  )`);

  // Items del pedido
  db.run(`CREATE TABLE IF NOT EXISTS pedido_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pedido_id INTEGER NOT NULL,
    producto_id INTEGER,
    nombre_producto TEXT NOT NULL,
    cantidad REAL DEFAULT 1,
    precio_unitario REAL DEFAULT 0,
    subtotal REAL DEFAULT 0,
    es_comanda INTEGER DEFAULT 1,
    estado TEXT DEFAULT 'pendiente',
    notas TEXT DEFAULT '',
    FOREIGN KEY (pedido_id) REFERENCES pedidos(id),
    FOREIGN KEY (producto_id) REFERENCES productos(id)
  )`);

  // Pagos
  db.run(`CREATE TABLE IF NOT EXISTS pagos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pedido_id INTEGER NOT NULL,
    metodo TEXT NOT NULL,
    monto REAL DEFAULT 0,
    fecha TEXT DEFAULT CURRENT_TIMESTAMP,
    referencia TEXT DEFAULT '',
    FOREIGN KEY (pedido_id) REFERENCES pedidos(id)
  )`);

  console.log('✅ Tablas base creadas.');

  // Caja (aperturas y cierres)
  db.run(`CREATE TABLE IF NOT EXISTS caja (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha_apertura TEXT DEFAULT CURRENT_TIMESTAMP,
    fecha_cierre TEXT,
    monto_inicial REAL DEFAULT 0,
    monto_final_real REAL DEFAULT 0,
    usuario_id INTEGER,
    estado TEXT DEFAULT 'abierta',
    observaciones TEXT DEFAULT '',
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
  )`);

  // Movimientos de caja (ingresos/egresos)
  db.run(`CREATE TABLE IF NOT EXISTS movimientos_caja (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    caja_id INTEGER,
    tipo TEXT,
    concepto TEXT DEFAULT '',
    monto REAL DEFAULT 0,
    fecha TEXT DEFAULT CURRENT_TIMESTAMP,
    usuario_id INTEGER,
    FOREIGN KEY (caja_id) REFERENCES caja(id),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
  )`);

  // Proveedores
  db.run(`CREATE TABLE IF NOT EXISTS proveedores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    cuit TEXT DEFAULT '',
    telefono TEXT DEFAULT '',
    email TEXT DEFAULT '',
    direccion TEXT DEFAULT '',
    notas TEXT DEFAULT '',
    activo INTEGER DEFAULT 1
  )`);

  // Órdenes de compra
  db.run(`CREATE TABLE IF NOT EXISTS ordenes_compra (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    proveedor_id INTEGER,
    numero TEXT NOT NULL,
    fecha TEXT DEFAULT CURRENT_TIMESTAMP,
    estado TEXT DEFAULT 'pendiente',
    total REAL DEFAULT 0,
    notas TEXT DEFAULT '',
    FOREIGN KEY (proveedor_id) REFERENCES proveedores(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS orden_compra_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    orden_id INTEGER NOT NULL,
    producto_id INTEGER,
    cantidad REAL DEFAULT 0,
    costo_unitario REAL DEFAULT 0,
    subtotal REAL DEFAULT 0,
    FOREIGN KEY (orden_id) REFERENCES ordenes_compra(id),
    FOREIGN KEY (producto_id) REFERENCES productos(id)
  )`);

  // Movimientos de stock
  db.run(`CREATE TABLE IF NOT EXISTS movimientos_stock (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    producto_id INTEGER NOT NULL,
    tipo TEXT,
    cantidad REAL DEFAULT 0,
    motivo TEXT DEFAULT '',
    fecha TEXT DEFAULT CURRENT_TIMESTAMP,
    usuario_id INTEGER,
    FOREIGN KEY (producto_id) REFERENCES productos(id),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
  )`);

  // Clientes
  db.run(`CREATE TABLE IF NOT EXISTS clientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    telefono TEXT DEFAULT '',
    email TEXT DEFAULT '',
    direccion TEXT DEFAULT '',
    puntos INTEGER DEFAULT 0,
    notas TEXT DEFAULT '',
    creado_en TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  console.log('✅ Tablas de gestión creadas.');

  // Pedidos delivery / take away
  db.run(`CREATE TABLE IF NOT EXISTS entregas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pedido_id INTEGER NOT NULL,
    tipo TEXT DEFAULT 'delivery',
    cliente_id INTEGER,
    direccion TEXT DEFAULT '',
    telefono TEXT DEFAULT '',
    costo_envio REAL DEFAULT 0,
    estado TEXT DEFAULT 'pendiente',
    cadete TEXT DEFAULT '',
    plataforma TEXT DEFAULT '',
    codigo_externo TEXT DEFAULT '',
    FOREIGN KEY (pedido_id) REFERENCES pedidos(id),
    FOREIGN KEY (cliente_id) REFERENCES clientes(id)
  )`);

  // Plataformas de delivery (PedidosYa, Rappi, Uber Eats, etc.)
  db.run(`CREATE TABLE IF NOT EXISTS plataformas_delivery (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL UNIQUE,
    color TEXT DEFAULT '#6A0DAD',
    icono TEXT DEFAULT 'motorcycle',
    activa INTEGER DEFAULT 0,
    comision REAL DEFAULT 0,
    referencia TEXT DEFAULT '',
    config TEXT DEFAULT '',
    creado_en TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  // ===== Migración segura: columnas nuevas de entregas (BD existentes) =====
  // Se agregan las columnas ignorando el error si ya existen (SQLITE_ERROR 1 'duplicate column')
  db.run(`ALTER TABLE entregas ADD COLUMN plataforma TEXT DEFAULT ''`, () => {});
  db.run(`ALTER TABLE entregas ADD COLUMN codigo_externo TEXT DEFAULT ''`, () => {});

  // Registro de auditoría
  db.run(`CREATE TABLE IF NOT EXISTS auditoria (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER,
    accion TEXT NOT NULL,
    detalle TEXT DEFAULT '',
    fecha TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
  )`);

  // Reservas de mesas
  db.run(`CREATE TABLE IF NOT EXISTS reservas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mesa_id INTEGER,
    cliente TEXT NOT NULL,
    telefono TEXT DEFAULT '',
    fecha TEXT NOT NULL,
    hora TEXT NOT NULL,
    personas INTEGER DEFAULT 2,
    notas TEXT DEFAULT '',
    estado TEXT DEFAULT 'confirmada',
    usuario_id INTEGER,
    creado_en TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (mesa_id) REFERENCES mesas(id),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
  )`);

  // Promociones / descuentos programables
  db.run(`CREATE TABLE IF NOT EXISTS promociones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    tipo TEXT DEFAULT 'porcentaje',
    valor REAL DEFAULT 0,
    descripcion TEXT DEFAULT '',
    activo INTEGER DEFAULT 1,
    creado_en TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  console.log('✅ Tablas de entregas, auditoría, reservas y promociones creadas.');

  // ============ DATOS INICIALES ============

  // Usuario administrador por defecto
  db.run(`INSERT OR IGNORE INTO usuarios (nombre, email, password, rol) 
          VALUES ('Administrador', 'admin@gastromanager.com', 'admin123', 'admin')`);

  // Configuración por defecto
  db.run(`INSERT OR IGNORE INTO configuracion (id, nombre_negocio) VALUES (1, 'Mi Restaurante')`);

  // Categorías iniciales
  const categorias = [
    ['Entradas', 'Aperitivos y entradas', '#FF9800', 1],
    ['Platos Principales', 'Platos principales', '#4CAF50', 2],
    ['Bebidas', 'Bebidas sin alcohol', '#2196F3', 3],
    ['Postres', 'Postres y dulces', '#9C27B0', 4],
    ['Bebidas Alcohólicas', 'Bebidas con alcohol', '#F44336', 5],
    ['Delivery', 'Productos para entrega', '#673AB7', 6]
  ];

  const stmtCat = db.prepare('INSERT OR IGNORE INTO categorias (nombre, descripcion, color, orden) VALUES (?, ?, ?, ?)');
  categorias.forEach(c => stmtCat.run(c[0], c[1], c[2], c[3]));
  stmtCat.finalize();

  console.log('✅ Categorías iniciales creadas.');

  // Productos iniciales de ejemplo (solo si no existen: productos.nombre no es UNIQUE
  // y con INSERT OR IGNORE cada ejecución duplicaba la carta)
  const stmtProd = db.prepare(`INSERT INTO productos
    (nombre, descripcion, categoria_id, precio_venta, costo, es_plato, tracking_stock, stock_actual, stock_minimo, unidad)
    SELECT ?1, ?2, (SELECT id FROM categorias WHERE nombre = ?3), ?4, ?5, ?6, ?7, ?8, ?9, ?10
    WHERE NOT EXISTS (SELECT 1 FROM productos WHERE nombre = ?1)`);

  const productos = [
    ['Ensalada César', 'Lechuga, pollo, croutons, aderezo César', 'Entradas', 4500, 1800, 1, 1, 20, 5, 'plato'],
    ['Milanesa con papas', 'Milanesa de carne con papas fritas', 'Platos Principales', 6500, 2800, 1, 1, 15, 5, 'plato'],
    ['Pizza Margarita', 'Pizza con salsa, mozzarella y albahaca', 'Platos Principales', 7200, 3000, 1, 1, 12, 4, 'unidad'],
    ['Hamburguesa Clásica', 'Carne, lechuga, tomate, cheddar', 'Platos Principales', 5800, 2400, 1, 1, 18, 6, 'unidad'],
    ['Coca-Cola 500ml', 'Gaseosa 500ml', 'Bebidas', 1500, 800, 0, 1, 100, 20, 'botella'],
    ['Agua Mineral 500ml', 'Agua sin gas', 'Bebidas', 1200, 600, 0, 1, 100, 20, 'botella'],
    ['Flan con crema', 'Flan casero con crema y dulce de leche', 'Postres', 2500, 1000, 1, 1, 10, 3, 'postre'],
    ['Cerveza Artesanal IPA', 'Cerveza artesanal 500ml', 'Bebidas Alcohólicas', 3000, 1500, 0, 1, 50, 10, 'botella'],
    ['Vino Tinto Malbec', 'Botella 750ml', 'Bebidas Alcohólicas', 12000, 6000, 0, 1, 20, 5, 'botella'],
    ['Café Expresso', 'Café expresso', 'Bebidas', 1000, 300, 0, 1, 200, 50, 'taza'],
    ['Papas Fritas', 'Porción de papas fritas', 'Entradas', 3200, 1200, 1, 1, 30, 8, 'porcion'],
    ['Bondiola de cerdo', 'Bondiola con guarnición', 'Platos Principales', 7800, 3200, 1, 1, 10, 3, 'plato']
  ];

  productos.forEach(p => stmtProd.run(p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9]));
  stmtProd.finalize();

  console.log('✅ Productos iniciales creados.');

  // Mesas iniciales
  const stmtMesa = db.prepare('INSERT OR IGNORE INTO mesas (nombre, capacidad, sector, orden) VALUES (?, ?, ?, ?)');
  for (let i = 1; i <= 10; i++) {
    const sector = i <= 5 ? 'Salón Principal' : (i <= 8 ? 'Terraza' : 'VIP');
    stmtMesa.run(`Mesa ${i}`, 4, sector, i);
  }
  stmtMesa.finalize();

  // ============ ÍNDICES PARA PERFORMANCE ============
  const indices = [
    'CREATE INDEX IF NOT EXISTS idx_pedidos_fecha ON pedidos(creado_en)',
    'CREATE INDEX IF NOT EXISTS idx_pedidos_estado ON pedidos(estado)',
    'CREATE INDEX IF NOT EXISTS idx_pedidos_mesa ON pedidos(mesa_id)',
    'CREATE INDEX IF NOT EXISTS idx_pedidos_usuario ON pedidos(usuario_id)',
    'CREATE INDEX IF NOT EXISTS idx_pedido_items_pedido ON pedido_items(pedido_id)',
    'CREATE INDEX IF NOT EXISTS idx_pedido_items_producto ON pedido_items(producto_id)',
    'CREATE INDEX IF NOT EXISTS idx_pagos_pedido ON pagos(pedido_id)',
    'CREATE INDEX IF NOT EXISTS idx_pagos_fecha ON pagos(fecha)',
    'CREATE INDEX IF NOT EXISTS idx_entregas_pedido ON entregas(pedido_id)',
    'CREATE INDEX IF NOT EXISTS idx_entregas_codigo_externo ON entregas(codigo_externo, plataforma)',
    'CREATE INDEX IF NOT EXISTS idx_entregas_estado ON entregas(estado)',
    'CREATE INDEX IF NOT EXISTS idx_movimientos_stock_producto ON movimientos_stock(producto_id)',
    'CREATE INDEX IF NOT EXISTS idx_movimientos_stock_fecha ON movimientos_stock(fecha)',
    'CREATE INDEX IF NOT EXISTS idx_movimientos_caja_caja ON movimientos_caja(caja_id)',
    'CREATE INDEX IF NOT EXISTS idx_auditoria_usuario ON auditoria(usuario_id)',
    'CREATE INDEX IF NOT EXISTS idx_auditoria_fecha ON auditoria(fecha)',
    'CREATE INDEX IF NOT EXISTS idx_productos_categoria ON productos(categoria_id)',
    'CREATE INDEX IF NOT EXISTS idx_reservas_mesa_fecha ON reservas(mesa_id, fecha)',
    'CREATE INDEX IF NOT EXISTS idx_recetas_plato ON recetas(plato_id)',
    'CREATE INDEX IF NOT EXISTS idx_recetas_ingrediente ON recetas(ingrediente_id)',
    'CREATE INDEX IF NOT EXISTS idx_ordenes_compra_proveedor ON ordenes_compra(proveedor_id)',
    'CREATE INDEX IF NOT EXISTS idx_orden_compra_items_orden ON orden_compra_items(orden_id)'
  ];
  indices.forEach(sql => db.run(sql));
  console.log('✅ Índices de performance creados.');

  // Datos de ejemplo: solo si la tabla está vacía (sin UNIQUE, INSERT OR IGNORE los duplicaba)
  // (la unión va en una subconsulta: un WHERE suelto solo filtraría el último SELECT)
  const siVacia = (tabla, columnas, filas) => db.run(
    `INSERT INTO ${tabla} (${columnas}) SELECT * FROM (${filas}) WHERE NOT EXISTS (SELECT 1 FROM ${tabla})`);

  // Proveedores de ejemplo
  siVacia('proveedores', 'nombre, cuit, telefono, email', `
    SELECT 'Distribuidora Central', '30-12345678-9', '011-1234-5678', 'ventas@central.com.ar'
    UNION ALL SELECT 'Carnes del Norte', '27-87654321-4', '011-8765-4321', 'carnes@norte.com.ar'
    UNION ALL SELECT 'Bebidas del Sur', '33-11111111-2', '011-1111-2222', 'info@bebidasdelsur.com.ar'`);

  // Plataformas de delivery (PedidosYa, Rappi, Uber Eats)
  siVacia('plataformas_delivery', 'nombre, color, icono, activa, comision, referencia', `
    SELECT 'PedidosYa', '#FBBF24', 'utensils', 0, 25, ''
    UNION ALL SELECT 'Rappi', '#00BFB3', 'motorcycle', 0, 30, ''
    UNION ALL SELECT 'Uber Eats', '#06C167', 'carrot', 0, 30, ''`);

  siVacia('promociones', 'nombre, tipo, valor, descripcion', `
    SELECT '2x1 en postres', 'porcentaje', 50, '50% de descuento en el segundo postre'
    UNION ALL SELECT 'Combo hamburguesa + gaseosa', 'monto', 1000, 'Descuento de $1000 en el combo'
    UNION ALL SELECT 'Efectivo', 'porcentaje', 10, '10% de descuento pagando en efectivo'`);

  console.log('✅ Mesas, proveedores y promociones creados.');
  console.log('');
  console.log('🎉 BASE DE DATOS INICIALIZADA CON ÉXITO');
  console.log('   Archivo: data/gastromanager.db');
  console.log('');
  console.log('👤 Usuario por defecto:');
  console.log('   Email: admin@gastromanager.com');
  console.log('   Password: admin123');
});

// Cerrar la conexión
db.close((err) => {
  if (err) {
    console.error('❌ Error al cerrar la base de datos:', err.message);
  } else {
    console.log('✅ Base de datos inicializada y cerrada correctamente.');
  }
});

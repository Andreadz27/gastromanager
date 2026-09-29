// =============================================
// GASTROMANAGER - Servidor Principal
// API REST para el sistema de gestión gastronómica
// =============================================

const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');
const { AsyncLocalStorage } = require('async_hooks');
const Afip = require('@afipsdk/afip.js');

// Contexto de la transacción en curso (ver transaccion()): conexión y eventos pendientes
const txContexto = new AsyncLocalStorage();

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;
// Clave para firmar sesiones: SECRET_KEY del entorno o, si no está, una clave
// aleatoria propia de esta instalación guardada en data/.secret_key.
function cargarSecretKey() {
  if (process.env.SECRET_KEY) return process.env.SECRET_KEY;
  const archivo = path.join(__dirname, 'data', '.secret_key');
  try {
    const guardada = fs.readFileSync(archivo, 'utf8').trim();
    if (guardada.length >= 32) return guardada;
  } catch (e) { /* no existe todavía */ }
  const nueva = crypto.randomBytes(48).toString('hex');
  fs.mkdirSync(path.dirname(archivo), { recursive: true });
  fs.writeFileSync(archivo, nueva, { mode: 0o600 });
  return nueva;
}
const SECRET_KEY = cargarSecretKey();

// Orígenes permitidos (CORS HTTP y Socket.IO). Por defecto, cualquiera.
const allowedOrigins = (process.env.CORS_ORIGINS || '*').split(',').map(s => s.trim());
const origenPermitido = origin => !origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin);

// Clientes conectados por Socket.IO (realtime). Solo usuarios con sesión válida:
// los eventos incluyen datos de clientes (nombre, teléfono).
const io = new Server(server, {
  cors: { origin: (origin, cb) => cb(null, origenPermitido(origin)) }
});
io.use(async (socket, next) => {
  try {
    const usuario = await usuarioDesdeToken(socket.handshake.auth && socket.handshake.auth.token);
    if (usuario.cp) return next(new Error('Debe cambiar la contraseña'));
    socket.usuario = usuario;
    next();
  } catch (e) {
    next(new Error('No autorizado'));
  }
});
// Dentro de una transacción los eventos se encolan y se emiten recién después del COMMIT
// (si hay ROLLBACK se descartan), así los clientes nunca ven datos a medio guardar.
const emitEvento = (evento, data) => {
  const ctx = txContexto.getStore();
  if (ctx) { ctx.eventos.push([evento, data]); return; }
  try { io.emit(evento, data); } catch (e) {}
};
io.on('connection', socket => {
  socket.emit('realtime:connected', { at: new Date().toISOString() });
});

// ------ Middlewares de seguridad ------
app.use(helmet({
  crossOriginResourcePolicy:  { policy: 'cross-origin' },
  crossOriginOpenerPolicy:    false, // requiere HTTPS, causa warnings en red local
  originAgentCluster:         false, // idem
  // CSP: solo recursos propios + Font Awesome (cdnjs) + imágenes QR (api.qrserver.com).
  // 'unsafe-inline' en scripts sigue siendo necesario por los onclick="" del HTML;
  // igual bloquea scripts de otros dominios, plugins, <base> y embeber la app en otros sitios.
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc:      ["'self'", "'unsafe-inline'"],
      scriptSrcAttr:  ["'unsafe-inline'"],
      styleSrc:       ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'],
      fontSrc:        ["'self'", 'data:', 'https://cdnjs.cloudflare.com'],
      imgSrc:         ["'self'", 'data:', 'blob:', 'https://api.qrserver.com'],
      connectSrc:     ["'self'"],
      workerSrc:      ["'self'"],
      manifestSrc:    ["'self'"],
      objectSrc:      ["'none'"],
      baseUri:        ["'self'"],
      formAction:     ["'self'"],
      frameAncestors: ["'self'"]
      // Sin upgrade-insecure-requests: en la red local el sistema se usa por HTTP
    }
  }
}));
app.use(cors({
  origin: (origin, cb) => {
    if (origenPermitido(origin)) return cb(null, true);
    return cb(new Error('Origen no permitido por CORS'));
  }
}));
// Detrás de un proxy/túnel (nginx, cloudflared) la IP real llega en X-Forwarded-For.
// Por defecto solo se confía en un proxy en la misma máquina.
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback');
app.use(express.json({ limit: '2mb' }));
// JSON mal formado: 400 en lugar de un error sin manejar
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido' });
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Petición demasiado grande' });
  next(err);
});

// Rate limiting: protege login y endpoints sensibles de fuerza bruta
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10,                  // intentos fallidos por IP
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Intenta de nuevo en unos minutos.' }
});
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones. Intenta más tarde.' }
});

app.use(express.static(path.join(__dirname, 'public')));

// Apply API rate limiter to all /api routes
app.use('/api/', apiLimiter);

// Base de datos
const dbPath = path.join(__dirname, 'data', 'gastromanager.db');
const db = new sqlite3.Database(dbPath);
db.configure('busyTimeout', 10000);
// WAL: las lecturas no se bloquean mientras hay una escritura en curso
db.run('PRAGMA journal_mode = WAL');
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
let colaTx = Promise.resolve();
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
        try { io.emit(evento, data); } catch (e) {}
      }
      return resultado;
    });
  };
  const p = colaTx.then(ejecutar, ejecutar);
  colaTx = p.catch(() => {});
  return p;
}

// ============ Zona horaria del negocio ============
// SQLite guarda las fechas en UTC (CURRENT_TIMESTAMP). Los reportes por día se calculan
// en la hora local del negocio: sin esto, lo vendido después de las 21 hs en Argentina
// (UTC-3) se contaba en el día siguiente.
const ZONA_HORARIA = process.env.ZONA_HORARIA || 'America/Argentina/Buenos_Aires';

// Diferencia en minutos entre la hora local del negocio y UTC (ej.: -180)
function offsetZonaMin(fecha = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: ZONA_HORARIA, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(fecha).map(x => [x.type, x.value]));
  const comoUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((comoUTC - Math.floor(fecha.getTime() / 1000) * 1000) / 60000);
}

// Modificador SQLite UTC → hora local: date(p.cerrado_en, ${LOCAL()})
const LOCAL = () => `'${offsetZonaMin()} minutes'`;

// Fecha local del negocio (AAAA-MM-DD), opcionalmente N días atrás
const fechaLocal = (diasAtras = 0) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_HORARIA }).format(new Date(Date.now() - diasAtras * 86400000));

// Error de validación con código HTTP (se responde tal cual y revierte la transacción)
const errorHttp = (status, mensaje) => Object.assign(new Error(mensaje), { status });

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

// Generar número de pedido: secuencial y atómico (P-AAAAMMDD-00001)
async function generarNumeroPedido() {
  const row = await get("UPDATE secuencias SET valor = valor + 1 WHERE nombre = 'pedido' RETURNING valor");
  const fecha = new Date();
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, '0');
  const d = String(fecha.getDate()).padStart(2, '0');
  return `P-${y}${m}${d}-${String(row.valor).padStart(5, '0')}`;
}

// Slug seguro para nombres de plataforma (usado en URLs de webhook)
function slugificar(nombre) {
  return String(nombre || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

// Parsear la columna config de una plataforma (JSON libre)
function parseCfgPlataforma(p) {
  let cfg = {};
  try { cfg = JSON.parse(p.config || '{}'); } catch (e) { cfg = {}; }
  return cfg;
}

// Error inesperado: se registra en el log y al cliente no se le muestran detalles internos
function errorInterno(res, err) {
  // Errores de validación creados con errorHttp(): se muestran al usuario
  if (err && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ error: err.message });
  }
  if (err && err.code === 'SQLITE_CONSTRAINT') {
    return res.status(409).json({ error: 'Ya existe un registro con esos datos o faltan datos obligatorios' });
  }
  console.error(`[${new Date().toISOString()}] ${res.req.method} ${res.req.originalUrl}:`, err);
  res.status(500).json({ error: 'Error interno del servidor' });
}

// ============ AUTENTICACION ============
// Verifica el token y que el usuario siga activo. El rol se toma de la base,
// así desactivar a un usuario o cambiarle el rol tiene efecto inmediato.
async function usuarioDesdeToken(token) {
  const decoded = jwt.verify(String(token || ''), SECRET_KEY);
  const u = await get('SELECT id, nombre, email, rol, debe_cambiar_password FROM usuarios WHERE id = ? AND activo = 1', [decoded.id]);
  if (!u) throw new Error('Usuario inactivo');
  return { id: u.id, nombre: u.nombre, email: u.email, rol: u.rol, ...(u.debe_cambiar_password ? { cp: 1 } : {}) };
}

async function autenticar(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  try {
    req.usuario = await usuarioDesdeToken(token);
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
  // Con contraseña pendiente de cambio solo se puede consultar la sesión y cambiarla
  if (req.usuario.cp && !['/api/auth/me', '/api/auth/password'].includes(req.path)) {
    return res.status(403).json({ error: 'Tenés que cambiar la contraseña para continuar', cambiar_password: true });
  }
  next();
}

const firmarToken = usuario => jwt.sign(
  { id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol,
    ...(usuario.debe_cambiar_password ? { cp: 1 } : {}) },
  SECRET_KEY,
  { expiresIn: '12h' }
);

function esAdmin(req, res, next) {
  if (req.usuario?.rol !== 'admin') {
    return res.status(403).json({ error: 'Acceso restringido a administradores' });
  }
  next();
}

// ============ AUTENTICACION - RUTAS ============

app.post('/api/auth/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    const usuario = await get('SELECT * FROM usuarios WHERE email = ? AND activo = 1', [email]);
    if (!usuario) {
      return res.status(400).json({ error: 'Credenciales incorrectas' });
    }

    // Comparación segura de contraseñas (soporta hash bcrypt y legacy plain text)
    let passwordValido = false;
    if (usuario.password && usuario.password.startsWith('$2')) {
      // Hash bcrypt
      passwordValido = await bcrypt.compare(String(password || ''), usuario.password);
    } else {
      // Legacy: texto plano (migración temporal)
      passwordValido = (String(password || '') === String(usuario.password || ''));
      if (passwordValido) {
        // Auto-migrar a hash bcrypt
        const hash = await bcrypt.hash(String(password), 10);
        await run('UPDATE usuarios SET password = ? WHERE id = ?', [hash, usuario.id]);
      }
    }

    if (!passwordValido) {
      return res.status(400).json({ error: 'Credenciales incorrectas' });
    }

    const token = firmarToken(usuario);
    await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, ?, ?)',
      [usuario.id, 'login', 'Inicio de sesión']);
    res.json({ token, usuario: {
      id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol,
      debe_cambiar_password: usuario.debe_cambiar_password ? 1 : 0
    } });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.get('/api/auth/me', autenticar, async (req, res) => {
  try {
    const usuario = await get('SELECT id, nombre, email, rol, activo, debe_cambiar_password FROM usuarios WHERE id = ? AND activo = 1', [req.usuario.id]);
    if (!usuario) return res.status(401).json({ error: 'Usuario inactivo' });
    res.json(usuario);
  } catch (err) {
    errorInterno(res, err);
  }
});

// Cambio de contraseña del propio usuario (obligatorio en el primer ingreso)
app.put('/api/auth/password', autenticar, async (req, res) => {
  try {
    const { actual, nueva } = req.body || {};
    const usuario = await get('SELECT * FROM usuarios WHERE id = ? AND activo = 1', [req.usuario.id]);
    if (!usuario) return res.status(401).json({ error: 'Usuario inactivo' });
    if (!(await bcrypt.compare(String(actual || ''), usuario.password || '')))
      return res.status(400).json({ error: 'La contraseña actual no es correcta' });
    const nuevaStr = String(nueva || '');
    if (nuevaStr.length < 8) return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres' });
    if (nuevaStr === String(actual)) return res.status(400).json({ error: 'La nueva contraseña debe ser distinta de la actual' });

    const hash = await bcrypt.hash(nuevaStr, 10);
    await run('UPDATE usuarios SET password = ?, debe_cambiar_password = 0 WHERE id = ?', [hash, usuario.id]);
    await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, ?, ?)',
      [usuario.id, 'cambiar_password', 'Contraseña cambiada']);
    const token = firmarToken({ ...usuario, debe_cambiar_password: 0 });
    res.json({ token, message: 'Contraseña actualizada' });
  } catch (err) {
    errorInterno(res, err);
  }
});
// ============ MENÚ PÚBLICO (carta QR - sin autenticación) ============

app.get('/api/publico/menu', async (req, res) => {
  try {
    const categorias = await all(`
      SELECT c.id, c.nombre FROM categorias c ORDER BY c.nombre ASC
    `);
    const productos = await all(`
      SELECT p.id, p.nombre, p.descripcion, p.precio_venta, p.categoria_id,
             p.tracking_stock, p.stock_actual, p.es_plato
      FROM productos p
      WHERE p.activo = 1
      ORDER BY p.nombre ASC
    `);
    res.json({ categorias, productos });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.get('/api/publico/info', async (req, res) => {
  try {
    const config = await get('SELECT nombre_negocio, direccion, telefono FROM configuracion WHERE id = 1');
    const base = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/,'');
    res.json({
      nombre: config?.nombre_negocio || 'GastroManager',
      descripcion: config?.direccion ? `Dirección: ${config.direccion}` : '',
      telefono: config?.telefono || '',
      links: {
        carta:     `${base}/menu.html`,
        whatsapp:  `${base}/pedido.html?origen=whatsapp`,
        instagram: `${base}/pedido.html?origen=instagram`
      }
    });
  } catch (err) { errorInterno(res, err); }
});

const pedidoOnlineLimiter = rateLimit({ windowMs: 60000, max: 10 });
app.post('/api/publico/pedido', pedidoOnlineLimiter, async (req, res) => {
  try {
    const { cliente, telefono, tipo, direccion, notas, origen, items } = req.body;
    if (!cliente || !telefono)
      return res.status(400).json({ error: 'Nombre y teléfono son obligatorios' });
    if (!Array.isArray(items) || !items.length)
      return res.status(400).json({ error: 'El pedido no tiene items' });
    const tipoFin  = tipo === 'delivery' ? 'delivery' : 'takeaway';
    const orig     = ['whatsapp','instagram','web'].includes(origen) ? origen : 'web';
    const { pid, numero, sub } = await transaccion(async () => {
      for (const item of items) {
        const prod = await get(
          'SELECT id, nombre, precio_venta FROM productos WHERE id = ? AND activo = 1',
          [item.producto_id]);
        if (!prod) throw errorHttp(400, 'Producto no disponible');
        item.precio = prod.precio_venta;
        item.nombre = prod.nombre;
      }
      const numero   = await generarNumeroPedido();
      const result   = await run(
        `INSERT INTO pedidos (numero_pedido,tipo,cliente,usuario_id,notas,descuento,propina,origen)
         VALUES (?,?,?,NULL,?,0,0,?)`,
        [numero, tipoFin, `${cliente} (${telefono})`, notas||'', orig]);
      const pid = result.id;
      for (const item of items) {
        const cant  = Math.max(1, parseInt(item.cantidad)||1);
        const price = parseFloat(item.precio)||0;
        await run(
          `INSERT INTO pedido_items
           (pedido_id,producto_id,nombre_producto,cantidad,precio_unitario,subtotal,notas)
           VALUES (?,?,?,?,?,?,?)`,
          [pid, item.producto_id, item.nombre, cant, price, cant*price, item.notas||'']);
      }
      const rows = await all('SELECT subtotal FROM pedido_items WHERE pedido_id=?',[pid]);
      const sub  = rows.reduce((a,r)=>a+r.subtotal,0);
      await run('UPDATE pedidos SET subtotal=?,total=? WHERE id=?',[sub,sub,pid]);
      if (tipoFin==='delivery' && direccion) {
        await run(
          `INSERT INTO entregas (pedido_id,tipo,direccion,telefono,costo_envio,estado,plataforma,codigo_externo)
           VALUES (?,'delivery',?,?,0,'pendiente',?,'') `,
          [pid, direccion, telefono, orig]);
      }
      emitEvento('pedido:nuevo',{id:pid,numero_pedido:numero,tipo:tipoFin,origen:orig,cliente});
      emitEvento('cocina:actualizar',{pedido_id:pid,accion:'creado'});
      emitEvento('dashboard:actualizar',{motivo:'pedido_creado'});
      if (tipoFin==='delivery') emitEvento('delivery:actualizar',{pedido_id:pid,accion:'creado'});
      return { pid, numero, sub };
    });
    const label = {whatsapp:'WhatsApp',instagram:'Instagram',web:'Web'}[orig]||orig;
    res.status(201).json({id:pid,numero_pedido:numero,subtotal:sub,total:sub,origen:label});
  } catch (err) { errorInterno(res, err); }
});

// ============ CONFIGURACION ============

const PERFILES_NEGOCIO = {
  restaurante_grande:  { label:'Restaurante Grande',    modulos:['pos','mesas','pedidos','delivery','cocina','productos','stock','proveedores','clientes','caja','reportes'], terminologia:{pedido:'Comanda',mesa:'Mesa',producto:'Plato'} },
  restaurante_mediano: { label:'Restaurante Mediano',   modulos:['pos','mesas','pedidos','delivery','cocina','productos','stock','proveedores','clientes','caja','reportes'], terminologia:{pedido:'Pedido', mesa:'Mesa',producto:'Plato'} },
  restaurante_chico:   { label:'Restaurante Chico',     modulos:['pos','mesas','pedidos','cocina','productos','stock','clientes','caja','reportes'],                        terminologia:{pedido:'Pedido', mesa:'Mesa',producto:'Plato'} },
  cafeteria:           { label:'Cafeteria / Bar',       modulos:['pos','pedidos','productos','stock','proveedores','clientes','caja','reportes'],                           terminologia:{pedido:'Venta',  mesa:'Mostrador',producto:'Producto'} },
  panaderia:           { label:'Panaderia / Rotiseria', modulos:['pos','pedidos','cocina','productos','stock','proveedores','clientes','caja','reportes'],                   terminologia:{pedido:'Venta',  mesa:'Mostrador',producto:'Producto'} },
  heladeria:           { label:'Heladeria',             modulos:['pos','pedidos','cocina','productos','stock','proveedores','clientes','caja','reportes'],                   terminologia:{pedido:'Venta',  mesa:'Mostrador',producto:'Producto'} },
  kiosco:              { label:'Kiosco',                modulos:['pos','productos','stock','proveedores','caja','reportes'],                                                 terminologia:{pedido:'Venta',  mesa:'Mostrador',producto:'Articulo' } },
  personalizado:       { label:'Personalizado',         modulos:['pos','mesas','pedidos','delivery','cocina','productos','stock','proveedores','clientes','caja','reportes'], terminologia:{pedido:'Pedido', mesa:'Mesa',      producto:'Producto'} },
};

app.get('/api/config/perfiles', autenticar, async (req, res) => {
  res.json(PERFILES_NEGOCIO);
});

app.get('/api/config', autenticar, async (req, res) => {
  try {
    const config = await get('SELECT * FROM configuracion WHERE id = 1');
    if (config) {
      try { config.modulos_activos = JSON.parse(config.modulos_activos || '[]'); } catch(e) { config.modulos_activos = []; }
      try { config.terminologia    = JSON.parse(config.terminologia    || '{}'); } catch(e) { config.terminologia    = {}; }
    }
    res.json(config);
  } catch (err) { errorInterno(res, err); }
});

app.put('/api/config', autenticar, esAdmin, async (req, res) => {
  try {
    const { nombre_negocio, direccion, telefono, email, cuit, tasa_iva, moneda, activar_impresion,
            tipo_negocio, modulos_activos, terminologia, setup_completado } = req.body;
    const modulosJson     = modulos_activos != null ? JSON.stringify(Array.isArray(modulos_activos) ? modulos_activos : []) : null;
    const terminologiaJson = terminologia != null ? JSON.stringify(typeof terminologia === 'object' ? terminologia : {}) : null;
    await run(`UPDATE configuracion SET
      nombre_negocio = ?, direccion = ?, telefono = ?, email = ?, cuit = ?,
      tasa_iva = ?, moneda = ?, activar_impresion = ?,
      tipo_negocio     = COALESCE(?, tipo_negocio),
      modulos_activos  = COALESCE(?, modulos_activos),
      terminologia     = COALESCE(?, terminologia),
      setup_completado = COALESCE(?, setup_completado)
      WHERE id = 1`,
      [nombre_negocio, direccion, telefono, email, cuit, tasa_iva, moneda, activar_impresion,
       tipo_negocio||null, modulosJson, terminologiaJson, setup_completado!=null?setup_completado:null]);
    const config = await get('SELECT * FROM configuracion WHERE id = 1');
    if (config) {
      try { config.modulos_activos = JSON.parse(config.modulos_activos || '[]'); } catch(e) { config.modulos_activos = []; }
      try { config.terminologia    = JSON.parse(config.terminologia    || '{}'); } catch(e) { config.terminologia    = {}; }
    }
    emitEvento('config:actualizar', { tipo_negocio: config && config.tipo_negocio });
    res.json(config);
  } catch (err) { errorInterno(res, err); }
});

// ============ USUARIOS ============

app.get('/api/usuarios', autenticar, esAdmin, async (req, res) => {
  try {
    const usuarios = await all('SELECT id, nombre, email, rol, activo FROM usuarios ORDER BY id');
    res.json(usuarios);
  } catch (err) {
    errorInterno(res, err);
  }
});

app.post('/api/usuarios', autenticar, esAdmin, async (req, res) => {
  try {
    const { nombre, email, password, rol } = req.body;
    if (!nombre || !email || !password) {
      return res.status(400).json({ error: 'Nombre, email y contraseña son obligatorios' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    }
    // La contraseña la define el admin: el usuario la cambia en su primer ingreso
    const hash = await bcrypt.hash(String(password), 10);
    const result = await run('INSERT INTO usuarios (nombre, email, password, rol, debe_cambiar_password) VALUES (?, ?, ?, ?, 1)',
      [nombre, email, hash, rol === 'admin' ? 'admin' : 'vendedor']);
    await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, ?, ?)',
      [req.usuario.id, 'crear_usuario', `Usuario creado: ${nombre}`]);
    res.status(201).json({ id: result.id, message: 'Usuario creado' });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.put('/api/usuarios/:id', autenticar, esAdmin, async (req, res) => {
  try {
    const { nombre, email, rol, activo, password } = req.body;
    if (password) {
      if (String(password).length < 8) {
        return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
      }
      const hash = await bcrypt.hash(String(password), 10);
      // Contraseña reseteada por el admin: el usuario la cambia al ingresar
      await run('UPDATE usuarios SET nombre = ?, email = ?, rol = ?, activo = ?, password = ?, debe_cambiar_password = 1 WHERE id = ?',
        [nombre, email, rol, activo, hash, req.params.id]);
    } else {
      await run('UPDATE usuarios SET nombre = ?, email = ?, rol = ?, activo = ? WHERE id = ?',
        [nombre, email, rol, activo, req.params.id]);
    }
    await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, ?, ?)',
      [req.usuario.id, 'editar_usuario', `Usuario #${req.params.id} actualizado`]);
    res.json({ message: 'Usuario actualizado' });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.delete('/api/usuarios/:id', autenticar, esAdmin, async (req, res) => {
  try {
    await run('UPDATE usuarios SET activo = 0 WHERE id = ?', [req.params.id]);
    res.json({ message: 'Usuario desactivado' });
  } catch (err) {
    errorInterno(res, err);
  }
});

// ============ CATEGORIAS ============

app.get('/api/categorias', autenticar, async (req, res) => {
  try {
    const categorias = await all('SELECT * FROM categorias WHERE activo = 1 ORDER BY orden');
    res.json(categorias);
  } catch (err) {
    errorInterno(res, err);
  }
});

app.post('/api/categorias', autenticar, esAdmin, async (req, res) => {
  try {
    const { nombre, descripcion, color, orden } = req.body;
    const result = await run(
      'INSERT INTO categorias (nombre, descripcion, color, orden) VALUES (?, ?, ?, ?)',
      [nombre, descripcion || '', color || '#4CAF50', orden || 0]
    );
    res.status(201).json({ id: result.id, message: 'Categoría creada' });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.put('/api/categorias/:id', autenticar, esAdmin, async (req, res) => {
  try {
    const { nombre, descripcion, color, orden, activo } = req.body;
    await run('UPDATE categorias SET nombre = ?, descripcion = ?, color = ?, orden = ?, activo = ? WHERE id = ?',
      [nombre, descripcion, color, orden, activo, req.params.id]);
    res.json({ message: 'Categoría actualizada' });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.delete('/api/categorias/:id', autenticar, esAdmin, async (req, res) => {
  try {
    await run('UPDATE categorias SET activo = 0 WHERE id = ?', [req.params.id]);
    res.json({ message: 'Categoría desactivada' });
  } catch (err) {
    errorInterno(res, err);
  }
});

// ============ PRODUCTOS ============

app.get('/api/productos', autenticar, async (req, res) => {
  try {
    const productos = await all(`
      SELECT p.*, c.nombre as categoria_nombre, c.color as categoria_color
      FROM productos p
      LEFT JOIN categorias c ON p.categoria_id = c.id
      WHERE p.activo = 1
      ORDER BY c.orden, p.nombre
    `);
    res.json(productos);
  } catch (err) {
    errorInterno(res, err);
  }
});

app.post('/api/productos', autenticar, esAdmin, async (req, res) => {
  try {
    const { nombre, descripcion, categoria_id, precio_venta, costo, es_plato, tracking_stock, stock_actual, stock_minimo, unidad } = req.body;
    const result = await run(
      `INSERT INTO productos (nombre, descripcion, categoria_id, precio_venta, costo, es_plato, tracking_stock, stock_actual, stock_minimo, unidad) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [nombre, descripcion || '', categoria_id, precio_venta || 0, costo || 0, es_plato || 0, tracking_stock || 0, stock_actual || 0, stock_minimo || 0, unidad || 'unidad']
    );
    res.status(201).json({ id: result.id, message: 'Producto creado' });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.put('/api/productos/:id', autenticar, esAdmin, async (req, res) => {
  try {
    const { nombre, descripcion, categoria_id, precio_venta, costo, es_plato, tracking_stock, stock_actual, stock_minimo, unidad, activo } = req.body;
    await run(
      `UPDATE productos SET 
       nombre = ?, descripcion = ?, categoria_id = ?, precio_venta = ?, costo = ?, 
       es_plato = ?, tracking_stock = ?, stock_actual = ?, stock_minimo = ?, unidad = ?, activo = ?
       WHERE id = ?`,
      [nombre, descripcion, categoria_id, precio_venta, costo, es_plato, tracking_stock, stock_actual, stock_minimo, unidad, activo, req.params.id]
    );
    res.json({ message: 'Producto actualizado' });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.delete('/api/productos/:id', autenticar, esAdmin, async (req, res) => {
  try {
    await run('UPDATE productos SET activo = 0 WHERE id = ?', [req.params.id]);
    res.json({ message: 'Producto desactivado' });
  } catch (err) {
    errorInterno(res, err);
  }
});

// ============ MESAS ============

app.get('/api/mesas', autenticar, async (req, res) => {
  try {
    const mesas = await all('SELECT * FROM mesas ORDER BY sector, orden');
    res.json(mesas);
  } catch (err) {
    errorInterno(res, err);
  }
});

app.post('/api/mesas', autenticar, esAdmin, async (req, res) => {
  try {
    const { nombre, capacidad, sector, orden } = req.body;
    const result = await run(
      'INSERT INTO mesas (nombre, capacidad, sector, orden) VALUES (?, ?, ?, ?)',
      [nombre, capacidad || 4, sector || 'Principal', orden || 0]
    );
    res.status(201).json({ id: result.id, message: 'Mesa creada' });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.put('/api/mesas/:id', autenticar, esAdmin, async (req, res) => {
  try {
    const { nombre, capacidad, sector, orden, estado } = req.body;
    await run('UPDATE mesas SET nombre = ?, capacidad = ?, sector = ?, orden = ?, estado = ? WHERE id = ?',
      [nombre, capacidad, sector, orden, estado, req.params.id]);
    res.json({ message: 'Mesa actualizada' });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.delete('/api/mesas/:id', autenticar, esAdmin, async (req, res) => {
  try {
    await run('DELETE FROM mesas WHERE id = ?', [req.params.id]);
    res.json({ message: 'Mesa eliminada' });
  } catch (err) {
    errorInterno(res, err);
  }
});

// ============ RESERVAS DE MESAS ============

app.get('/api/reservas', autenticar, async (req, res) => {
  try {
    const { fecha } = req.query;
    let sql = `SELECT r.*, m.nombre as mesa_nombre, u.nombre as usuario_nombre
               FROM reservas r
               LEFT JOIN mesas m ON r.mesa_id = m.id
               LEFT JOIN usuarios u ON r.usuario_id = u.id`;
    const params = [];
    if (fecha) {
      sql += ' WHERE date(r.fecha) = ?';
      params.push(fecha);
    }
    sql += ' ORDER BY r.fecha, r.hora';
    const reservas = await all(sql, params);
    res.json(reservas);
  } catch (err) {
    errorInterno(res, err);
  }
});

app.post('/api/reservas', autenticar, async (req, res) => {
  try {
    const { mesa_id, cliente, telefono, fecha, hora, personas, notas } = req.body;
    const result = await run(
      `INSERT INTO reservas (mesa_id, cliente, telefono, fecha, hora, personas, notas, usuario_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [mesa_id || null, cliente, telefono || '', fecha, hora, personas || 2, notas || '', req.usuario.id]
    );

    // Marcar la mesa como reservada
    if (mesa_id) {
      const mesa = await get('SELECT estado FROM mesas WHERE id = ?', [mesa_id]);
      // Solo marcar reservada si está libre
      if (mesa && mesa.estado === 'libre') {
        await run('UPDATE mesas SET estado = ? WHERE id = ?', ['reservada', mesa_id]);
      }
    }

    res.status(201).json({ id: result.id, message: 'Reserva creada' });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.put('/api/reservas/:id', autenticar, async (req, res) => {
  try {
    const reservaActual = await get('SELECT * FROM reservas WHERE id = ?', [req.params.id]);
    if (!reservaActual) return res.status(404).json({ error: 'Reserva no encontrada' });

    // Update parcial: conservar valores existentes si no vienen en el body
    const mesa_id = req.body.mesa_id !== undefined ? req.body.mesa_id : reservaActual.mesa_id;
    const cliente = req.body.cliente !== undefined ? req.body.cliente : reservaActual.cliente;
    const telefono = req.body.telefono !== undefined ? req.body.telefono : reservaActual.telefono;
    const fecha = req.body.fecha !== undefined ? req.body.fecha : reservaActual.fecha;
    const hora = req.body.hora !== undefined ? req.body.hora : reservaActual.hora;
    const personas = req.body.personas !== undefined ? req.body.personas : reservaActual.personas;
    const notas = req.body.notas !== undefined ? req.body.notas : reservaActual.notas;
    const estado = req.body.estado !== undefined ? req.body.estado : reservaActual.estado;

    await run(
      `UPDATE reservas SET mesa_id = ?, cliente = ?, telefono = ?, fecha = ?, hora = ?, personas = ?, notas = ?, estado = ?
       WHERE id = ?`,
      [mesa_id, cliente, telefono, fecha, hora, personas, notas, estado, req.params.id]
    );
    // Si la reserva se cancela o llega el cliente, liberar/ocupar la mesa
    if (reservaActual.mesa_id) {
      if (estado === 'cancelada') {
        await run('UPDATE mesas SET estado = ? WHERE id = ?', ['libre', reservaActual.mesa_id]);
      } else if (estado === 'llego') {
        await run('UPDATE mesas SET estado = ? WHERE id = ?', ['ocupada', reservaActual.mesa_id]);
      } else if (estado === 'confirmada') {
        const mesa = await get('SELECT estado FROM mesas WHERE id = ?', [reservaActual.mesa_id]);
        if (mesa && mesa.estado !== 'ocupada') {
          await run('UPDATE mesas SET estado = ? WHERE id = ?', ['reservada', reservaActual.mesa_id]);
        }
      }
    }
    res.json({ message: 'Reserva actualizada' });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.delete('/api/reservas/:id', autenticar, async (req, res) => {
  try {
    const reserva = await get('SELECT mesa_id FROM reservas WHERE id = ?', [req.params.id]);
    await run('DELETE FROM reservas WHERE id = ?', [req.params.id]);
    if (reserva && reserva.mesa_id) {
      // Liberar la mesa solo si hay otra reserva activa o está reservada por esta
      const otras = await get(
        "SELECT id FROM reservas WHERE mesa_id = ? AND estado IN ('confirmada','llego') AND id != ? LIMIT 1",
        [reserva.mesa_id, req.params.id]
      );
      if (!otras) {
        await run('UPDATE mesas SET estado = ? WHERE id = ? AND estado = ?', ['libre', reserva.mesa_id, 'reservada']);
      }
    }
    res.json({ message: 'Reserva eliminada' });
  } catch (err) {
    errorInterno(res, err);
  }
});

// ============ PROMOCIONES ============

app.get('/api/promociones', autenticar, async (req, res) => {
  try {
    const promos = await all('SELECT * FROM promociones WHERE activo = 1 ORDER BY nombre');
    res.json(promos);
  } catch (err) {
    errorInterno(res, err);
  }
});

app.post('/api/promociones', autenticar, esAdmin, async (req, res) => {
  try {
    const { nombre, tipo, valor, descripcion } = req.body;
    const result = await run(
      'INSERT INTO promociones (nombre, tipo, valor, descripcion) VALUES (?, ?, ?, ?)',
      [nombre, tipo || 'porcentaje', valor || 0, descripcion || '']
    );
    res.status(201).json({ id: result.id, message: 'Promoción creada' });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.put('/api/promociones/:id', autenticar, esAdmin, async (req, res) => {
  try {
    const { nombre, tipo, valor, descripcion, activo } = req.body;
    await run('UPDATE promociones SET nombre = ?, tipo = ?, valor = ?, descripcion = ?, activo = ? WHERE id = ?',
      [nombre, tipo, valor, descripcion, activo === 0 ? 0 : 1, req.params.id]);
    res.json({ message: 'Promoción actualizada' });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.delete('/api/promociones/:id', autenticar, esAdmin, async (req, res) => {
  try {
    await run('UPDATE promociones SET activo = 0 WHERE id = ?', [req.params.id]);
    res.json({ message: 'Promoción desactivada' });
  } catch (err) {
    errorInterno(res, err);
  }
});


// ============ PEDIDOS ============

// Valida los ítems recibidos y toma nombre y precio de la tabla productos:
// nunca se confía en el precio que manda el navegador.
async function resolverItems(items) {
  if (!Array.isArray(items) || !items.length) throw Object.assign(new Error('El pedido no tiene ítems'), { status: 400 });
  const resueltos = [];
  for (const item of items) {
    const cantidad = Number(item && item.cantidad);
    if (!Number.isFinite(cantidad) || cantidad <= 0 || cantidad > 1000)
      throw Object.assign(new Error('Cantidad inválida'), { status: 400 });
    const prod = await get('SELECT id, nombre, precio_venta FROM productos WHERE id = ? AND activo = 1', [item.producto_id]);
    if (!prod) throw Object.assign(new Error('Producto no disponible'), { status: 400 });
    const precio = Number(prod.precio_venta) || 0;
    resueltos.push({ producto_id: prod.id, nombre: prod.nombre, cantidad, precio, notas: String(item.notas || '') });
  }
  return resueltos;
}

// Importe no negativo (descuento, propina, envío)
const importe = v => Math.max(0, Number(v) || 0);

// Recalcula subtotal y total de un pedido a partir de sus ítems
async function recalcularTotales(pedidoId) {
  const pedido = await get('SELECT descuento, propina FROM pedidos WHERE id = ?', [pedidoId]);
  const { s } = await get('SELECT COALESCE(SUM(subtotal), 0) AS s FROM pedido_items WHERE pedido_id = ?', [pedidoId]);
  const descuento = Math.min(importe(pedido.descuento), s);
  const total = Math.max(0, s - descuento + importe(pedido.propina));
  await run('UPDATE pedidos SET subtotal = ?, descuento = ?, total = ? WHERE id = ?', [s, descuento, total, pedidoId]);
  return { subtotal: s, total };
}

app.post('/api/pedidos', autenticar, async (req, res) => {
  try {
    const { tipo, mesa_id, cliente, notas, descuento, propina, plataforma, codigo_externo, direccion, telefono, costo_envio } = req.body;
    const descuentoVal = importe(descuento);
    const propinaVal = importe(propina);

    const resultado = await transaccion(async () => {
      const items = await resolverItems(req.body.items);
      const numero = await generarNumeroPedido();
      const result = await run(
        `INSERT INTO pedidos (numero_pedido, tipo, mesa_id, cliente, usuario_id, notas, descuento, propina)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [numero, tipo || 'salon', mesa_id || null, cliente || '', req.usuario.id, notas || '', descuentoVal, propinaVal]
      );
      const pedidoId = result.id;

      for (const item of items) {
        await run(
          `INSERT INTO pedido_items (pedido_id, producto_id, nombre_producto, cantidad, precio_unitario, subtotal, notas)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [pedidoId, item.producto_id || null, item.nombre, item.cantidad, item.precio, item.cantidad * item.precio, item.notas || '']
        );
      }

      const { subtotal, total } = await recalcularTotales(pedidoId);

      // Entregas / delivery: crear registro de entrega
      if ((tipo === 'delivery' || tipo === 'takeaway') && (plataforma || direccion || telefono)) {
        await run(`INSERT INTO entregas (pedido_id, tipo, direccion, telefono, costo_envio, estado, plataforma, codigo_externo)
                   VALUES (?, ?, ?, ?, ?, 'pendiente', ?, ?)`,
          [pedidoId, tipo, direccion || '', telefono || '', importe(costo_envio), plataforma || '', codigo_externo || '']);
      }

      if (mesa_id) {
        await run('UPDATE mesas SET estado = ? WHERE id = ?', ['ocupada', mesa_id]);
      }

      // Se emiten al confirmar la transacción
      emitEvento('pedido:creado', { id: pedidoId, numero_pedido: numero, tipo: tipo || 'salon' });
      emitEvento('cocina:actualizar', { pedido_id: pedidoId, accion: 'creado' });
      emitEvento('dashboard:actualizar', { motivo: 'pedido_creado' });
      if (tipo === 'delivery' || tipo === 'takeaway') {
        emitEvento('delivery:actualizar', { pedido_id: pedidoId, accion: 'creado' });
      }
      return { id: pedidoId, numero_pedido: numero, subtotal, total };
    });

    res.status(201).json(resultado);
  } catch (err) {
    errorInterno(res, err);
  }
});

app.get('/api/pedidos', autenticar, async (req, res) => {
  try {
    const { estado, fecha } = req.query;
    let sql = `SELECT p.*, m.nombre as mesa_nombre, u.nombre as usuario_nombre 
               FROM pedidos p
               LEFT JOIN mesas m ON p.mesa_id = m.id
               LEFT JOIN usuarios u ON p.usuario_id = u.id`;
    const params = [];
    
    if (estado && estado !== 'todos') {
      sql += ' WHERE p.estado = ?';
      params.push(estado);
    } else if (estado === 'todos') {
      // sin filtro
    } else {
      sql += " WHERE p.estado != 'cerrado' AND p.estado != 'cancelado'";
    }
    
    if (fecha) {
      sql += params.length ? ' AND' : ' WHERE';
      sql += ` date(p.creado_en, ${LOCAL()}) = ?`;
      params.push(fecha);
    }
    
    sql += ' ORDER BY p.creado_en DESC';
    const pedidos = await all(sql, params);
    res.json(pedidos);
  } catch (err) {
    errorInterno(res, err);
  }
});

// ===== COCINA: display de cocina (usa la sesión iniciada en ese navegador) =====
app.get('/api/cocina/display', autenticar, async (req, res) => {
  try {
    const pedidos = await all(`
      SELECT p.id, p.numero_pedido, p.tipo, p.mesa_id, m.nombre as mesa_nombre, p.notas,
             p.estado, p.creado_en,
             CAST((julianday('now') - julianday(p.creado_en)) * 24 * 60 AS INTEGER) as minutos_transcurridos
      FROM pedidos p
      LEFT JOIN mesas m ON p.mesa_id = m.id
      WHERE p.estado = 'abierto'
      ORDER BY p.creado_en ASC
    `);
    const result = await Promise.all(pedidos.map(async ped => {
      const items = await all(`
        SELECT nombre_producto, cantidad, notas
        FROM pedido_items WHERE pedido_id = ?
      `, [ped.id]);
      return { ...ped, items };
    }));
    res.json(result);
  } catch (err) {
    errorInterno(res, err);
  }
});

// ===== COCINA: marcar listo desde el display =====
app.post('/api/cocina/display/:id/listo', autenticar, async (req, res) => {
  try {
    const pedido = await get('SELECT id, numero_pedido FROM pedidos WHERE id = ? AND estado = ?', [req.params.id, 'abierto']);
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado o ya cerrado' });
    // Solo marca como listo en cocina (no paga), lo dejamos abierto para que el mozo lo cierre
    emitEvento('cocina:actualizar', { pedido_id: pedido.id });
    res.json({ ok: true });
  } catch (err) {
    errorInterno(res, err);
  }
});

// ===== COCINA: marcar listo desde vista interna (autenticado) =====
app.put('/api/cocina/:id/listo', autenticar, async (req, res) => {
  try {
    const pedido = await get('SELECT id, numero_pedido FROM pedidos WHERE id = ? AND estado = ?', [req.params.id, 'abierto']);
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado o ya procesado' });
    // Emite evento tiempo real para que el display y otros clientes se actualicen
    emitEvento('cocina:actualizar', { pedido_id: pedido.id, numero_pedido: pedido.numero_pedido });
    res.json({ ok: true, numero_pedido: pedido.numero_pedido });
  } catch (err) {
    errorInterno(res, err);
  }
});

// ===== COCINA: comandas en curso (tiempo real) =====
app.get('/api/cocina', autenticar, async (req, res) => {
  try {
    const pedidos = await all(`
      SELECT p.id, p.numero_pedido, p.tipo, p.mesa_id, m.nombre as mesa_nombre, p.notas,
             p.estado, p.creado_en,
             CAST((julianday('now') - julianday(p.creado_en)) * 24 * 60 AS INTEGER) as minutos_transcurridos
      FROM pedidos p
      LEFT JOIN mesas m ON p.mesa_id = m.id
      WHERE p.estado = 'abierto'
      ORDER BY p.creado_en ASC
    `);

    const result = await Promise.all(pedidos.map(async ped => {
      const items = await all(`
        SELECT nombre_producto, cantidad, notas
        FROM pedido_items WHERE pedido_id = ?
      `, [ped.id]);
      return { ...ped, items };
    }));

    res.json(result);
  } catch (err) {
    errorInterno(res, err);
  }
});

app.get('/api/pedidos/:id', autenticar, async (req, res) => {
  try {
    const pedido = await get(`SELECT p.*, m.nombre as mesa_nombre, u.nombre as usuario_nombre
                              FROM pedidos p
                              LEFT JOIN mesas m ON p.mesa_id = m.id
                              LEFT JOIN usuarios u ON p.usuario_id = u.id
                              WHERE p.id = ?`, [req.params.id]);
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
    
    const items = await all('SELECT * FROM pedido_items WHERE pedido_id = ?', [req.params.id]);
    const pagos = await all('SELECT * FROM pagos WHERE pedido_id = ?', [req.params.id]);
    const entrega = await get('SELECT * FROM entregas WHERE pedido_id = ?', [req.params.id]);
    const comprobantes = await all('SELECT * FROM comprobantes_afip WHERE pedido_id = ? ORDER BY id', [req.params.id]);

    res.json({ ...pedido, items, pagos, entrega, comprobantes });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.post('/api/pedidos/:id/items', autenticar, async (req, res) => {
  try {
    const itemId = await transaccion(async () => {
      const pedido = await get('SELECT id, estado FROM pedidos WHERE id = ?', [req.params.id]);
      if (!pedido) throw errorHttp(404, 'Pedido no encontrado');
      if (pedido.estado !== 'abierto') throw errorHttp(400, 'El pedido no está abierto');
      const [item] = await resolverItems([req.body]);
      const result = await run(
        `INSERT INTO pedido_items (pedido_id, producto_id, nombre_producto, cantidad, precio_unitario, subtotal, notas)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [pedido.id, item.producto_id, item.nombre, item.cantidad, item.precio, item.cantidad * item.precio, item.notas]
      );
      await recalcularTotales(pedido.id);
      emitEvento('cocina:actualizar', { pedido_id: pedido.id, accion: 'item_agregado' });
      emitEvento('dashboard:actualizar', { motivo: 'pedido_actualizado' });
      return result.id;
    });
    res.status(201).json({ id: itemId, message: 'Item agregado' });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.put('/api/pedidos/:id/descuento', autenticar, async (req, res) => {
  try {
    const total = await transaccion(async () => {
      const pedido = await get('SELECT * FROM pedidos WHERE id = ?', [req.params.id]);
      if (!pedido) throw errorHttp(404, 'Pedido no encontrado');
      if (pedido.estado !== 'abierto') throw errorHttp(400, 'El pedido no está abierto');
      await run('UPDATE pedidos SET descuento = ? WHERE id = ?', [importe(req.body.descuento), pedido.id]);
      return (await recalcularTotales(pedido.id)).total;
    });
    res.json({ total, message: 'Descuento aplicado' });
  } catch (err) {
    errorInterno(res, err);
  }
});

// Registra el pago, cierra el pedido, libera la mesa y descuenta stock.
// Usado por el cobro manual y por el webhook de Mercado Pago.
// Devuelve false si el pedido ya no estaba abierto (evita cobrarlo dos veces).
function registrarPago(pedido, datosPago) {
  // Todo el cobro (pago, cierre, mesa, stock) es una sola operación atómica
  return transaccion(() => registrarPagoTx(pedido, datosPago));
}

async function registrarPagoTx(pedido, { metodo, monto, referencia, usuarioId }) {
  const pedidoId = pedido.id;
  // Se marca como pagado solo si sigue abierto: si dos cobros llegan a la vez, gana uno
  const { changes } = await run(
    `UPDATE pedidos SET estado = 'pagado', cerrado_en = CURRENT_TIMESTAMP, metodo_pago = ? WHERE id = ? AND estado = 'abierto'`,
    [metodo || '', pedidoId]);
  if (!changes) return false;

  await run('INSERT INTO pagos (pedido_id, metodo, monto, referencia) VALUES (?, ?, ?, ?)',
    [pedidoId, metodo, monto, referencia || '']);

  if (pedido.mesa_id) {
    await run('UPDATE mesas SET estado = ? WHERE id = ?', ['libre', pedido.mesa_id]);
  }

  const items = await all('SELECT * FROM pedido_items WHERE pedido_id = ?', [pedidoId]);
  for (const item of items) {
    if (item.producto_id) {
      const producto = await get('SELECT * FROM productos WHERE id = ?', [item.producto_id]);
      if (producto && producto.tracking_stock) {
        await run('UPDATE productos SET stock_actual = stock_actual - ? WHERE id = ?', [item.cantidad, item.producto_id]);
        await run(`INSERT INTO movimientos_stock (producto_id, tipo, cantidad, motivo, usuario_id)
                   VALUES (?, 'venta', ?, ?, ?)`, [item.producto_id, -item.cantidad, `Venta ${pedido.numero_pedido}`, usuarioId || null]);
      }
    }
  }

  emitEvento('pedido:pagado', { id: Number(pedidoId), numero_pedido: pedido.numero_pedido });
  emitEvento('cocina:actualizar', { pedido_id: Number(pedidoId), accion: 'pagado' });
  emitEvento('delivery:actualizar', { pedido_id: Number(pedidoId), accion: 'pagado' });
  emitEvento('dashboard:actualizar', { motivo: 'pedido_pagado' });
  emitEvento('stock:actualizar', { pedido_id: Number(pedidoId), accion: 'venta' });
  return true;
}

const METODOS_PAGO = ['efectivo', 'tarjeta', 'mercadopago', 'transferencia', 'otro'];

app.post('/api/pedidos/:id/pagar', autenticar, async (req, res) => {
  try {
    const { metodo, referencia } = req.body;
    const pedido = await get('SELECT * FROM pedidos WHERE id = ?', [req.params.id]);
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
    if (pedido.estado !== 'abierto') return res.status(400).json({ error: 'El pedido ya fue cobrado o cancelado' });
    if (!METODOS_PAGO.includes(metodo)) return res.status(400).json({ error: 'Método de pago inválido' });

    // "monto" es lo que entregó el cliente: debe cubrir el total. Se registra el total
    // del pedido (el excedente es vuelto) para que la caja cuadre.
    const recibido = Number(req.body.monto);
    const total = Number(pedido.total) || 0;
    if (!Number.isFinite(recibido) || recibido < total - 0.009)
      return res.status(400).json({ error: 'El monto recibido no cubre el total del pedido' });

    const ok = await registrarPago(pedido, { metodo, monto: total, referencia: String(referencia || ''), usuarioId: req.usuario.id });
    if (!ok) return res.status(409).json({ error: 'El pedido ya fue cobrado' });
    res.json({ message: 'Pago registrado y pedido cerrado', vuelto: Math.round((recibido - total) * 100) / 100 });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.put('/api/pedidos/:id/cancelar', autenticar, async (req, res) => {
  try {
    await transaccion(async () => {
      const pedido = await get('SELECT * FROM pedidos WHERE id = ?', [req.params.id]);
      if (!pedido) throw errorHttp(404, 'Pedido no encontrado');
      // Un pedido cobrado no se cancela desde acá: descuadraría la caja
      const { changes } = await run(
        `UPDATE pedidos SET estado = 'cancelado', cerrado_en = CURRENT_TIMESTAMP WHERE id = ? AND estado = 'abierto'`, [pedido.id]);
      if (!changes) throw errorHttp(400, 'Solo se pueden cancelar pedidos abiertos');
      await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, ?, ?)',
        [req.usuario.id, 'cancelar_pedido', `Pedido ${pedido.numero_pedido} cancelado`]);
      if (pedido.mesa_id) {
        await run('UPDATE mesas SET estado = ? WHERE id = ?', ['libre', pedido.mesa_id]);
      }
      emitEvento('pedido:cancelado', { id: pedido.id, numero_pedido: pedido.numero_pedido });
      emitEvento('cocina:actualizar', { pedido_id: pedido.id, accion: 'cancelado' });
      emitEvento('delivery:actualizar', { pedido_id: pedido.id, accion: 'cancelado' });
      emitEvento('dashboard:actualizar', { motivo: 'pedido_cancelado' });
    });
    res.json({ message: 'Pedido cancelado' });
  } catch (err) {
    errorInterno(res, err);
  }
});

// ============ DELIVERY / PLATAFORMAS DE ENTREGA ============

// La API key de una plataforma solo se entrega por /integracion (admin); en los listados se quita
function plataformaSinSecretos(p) {
  const cfg = parseCfgPlataforma(p);
  delete cfg.api_key;
  return { ...p, config: JSON.stringify(cfg) };
}

// Listar plataformas de delivery configuradas
app.get('/api/delivery/plataformas', autenticar, async (req, res) => {
  try {
    const plataformas = await all('SELECT * FROM plataformas_delivery ORDER BY id');
    res.json(plataformas.map(plataformaSinSecretos));
  } catch (err) {
    errorInterno(res, err);
  }
});

// Actualizar plataformas de delivery (configuración global, admin)
app.put('/api/delivery/plataformas', autenticar, esAdmin, async (req, res) => {
  try {
    const { plataformas } = req.body;
    if (!Array.isArray(plataformas)) {
      return res.status(400).json({ error: 'Se espera un array de plataformas' });
    }
    // La config de integración (API key) se guarda solo desde /plataformas/:id/integracion
    for (const p of plataformas) {
      if (!p.id) continue;
      await run(`UPDATE plataformas_delivery SET
        nombre = ?, color = ?, icono = ?, activa = ?, comision = ?, referencia = ?
        WHERE id = ?`,
        [p.nombre, p.color, p.icono, p.activa ? 1 : 0, parseFloat(p.comision) || 0, p.referencia || '', p.id]);
    }
    const lista = await all('SELECT * FROM plataformas_delivery ORDER BY id');
    res.json(lista.map(plataformaSinSecretos));
  } catch (err) {
    errorInterno(res, err);
  }
});

// Crear una plataforma de delivery nueva (admin)
app.post('/api/delivery/plataformas', autenticar, esAdmin, async (req, res) => {
  try {
    const { nombre, color, icono, activa, comision, referencia } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
    const result = await run(
      `INSERT INTO plataformas_delivery (nombre, color, icono, activa, comision, referencia)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [nombre, color || '#6A0DAD', icono || 'motorcycle', activa ? 1 : 0, parseFloat(comision) || 0, referencia || '']);
    res.status(201).json({ id: result.id });
  } catch (err) {
    errorInterno(res, err);
  }
});

// Eliminar una plataforma de delivery (admin)
app.delete('/api/delivery/plataformas/:id', autenticar, esAdmin, async (req, res) => {
  try {
    await run('DELETE FROM plataformas_delivery WHERE id = ?', [req.params.id]);
    res.json({ message: 'Plataforma eliminada' });
  } catch (err) {
    errorInterno(res, err);
  }
});

// Listar pedidos de delivery (según plataforma activa en ese momento)
app.get('/api/delivery/pedidos', autenticar, async (req, res) => {
  try {
    const { estado, fecha } = req.query;
    let sql = `
      SELECT p.id, p.numero_pedido, p.cliente, p.estado as estado_pedido, p.total,
             p.creado_en, p.notas as notas_pedido,
             e.id as entrega_id, e.direccion, e.telefono, e.costo_envio,
             e.estado as estado_envio, e.cadete, e.plataforma, e.codigo_externo,
             COALESCE(pd.nombre, e.plataforma, 'Delivery') as plataforma_nombre,
             pd.color as plataforma_color, pd.icono as plataforma_icono
      FROM pedidos p
      LEFT JOIN entregas e ON e.pedido_id = p.id
      LEFT JOIN plataformas_delivery pd ON pd.nombre = e.plataforma
      WHERE p.tipo = 'delivery' OR (e.tipo = 'delivery' OR e.tipo = 'takeaway')
    `;
    const params = [];
    if (estado && estado !== 'todos') {
      sql += ' AND e.estado = ?';
      params.push(estado);
    }
    if (fecha) {
      sql += ` AND date(p.creado_en, ${LOCAL()}) = ?`;
      params.push(fecha);
    }
    sql += ' ORDER BY p.creado_en DESC';
    const pedidos = await all(sql, params);
    res.json(pedidos);
  } catch (err) {
    errorInterno(res, err);
  }
});

// Actualizar estado de envío de un pedido delivery
app.put('/api/delivery/pedidos/:id/estado', autenticar, async (req, res) => {
  try {
    const { estado_envio, cadete } = req.body;
    const entrega = await get('SELECT id FROM entregas WHERE pedido_id = ?', [req.params.id]);
    if (!entrega) return res.status(404).json({ error: 'Entrega no encontrada' });
    await run('UPDATE entregas SET estado = ?, cadete = ? WHERE pedido_id = ?',
      [estado_envio || 'pendiente', cadete || '', req.params.id]);
    emitEvento('delivery:actualizar', { pedido_id: Number(req.params.id), estado: estado_envio || 'pendiente' });
    emitEvento('dashboard:actualizar', { motivo: 'delivery_actualizado' });
    res.json({ message: 'Estado de entrega actualizado' });
  } catch (err) {
    errorInterno(res, err);
  }
});

// Resumen de delivery para el dashboard
app.get('/api/delivery/resumen', autenticar, async (req, res) => {
  try {
    const hoy = fechaLocal();
    const porPlataforma = await all(`
      SELECT COALESCE(pd.nombre, e.plataforma, 'Otros') as plataforma, pd.color as color,
             COUNT(*) as cantidad, COALESCE(SUM(p.total), 0) as total
      FROM pedidos p
      JOIN entregas e ON e.pedido_id = p.id
      LEFT JOIN plataformas_delivery pd ON pd.nombre = e.plataforma
      WHERE date(p.creado_en, ${LOCAL()}) = ? AND p.estado = 'pagado'
      GROUP BY plataforma
      ORDER BY cantidad DESC
    `, [hoy]);
    const activos = await all(`
      SELECT COUNT(*) as cantidad, COALESCE(SUM(p.total), 0) as total
      FROM pedidos p JOIN entregas e ON e.pedido_id = p.id
      WHERE p.estado = 'abierto' AND e.estado IN ('pendiente','aceptado','en_camino')
    `);
    res.json({
      por_plataforma: porPlataforma,
      activos: activos[0] || { cantidad: 0, total: 0 }
    });
  } catch (err) {
    errorInterno(res, err);
  }
});

// ============ INTEGRACIÓN AUTOMÁTICA DE PLATAFORMAS ============

// Estado de configuración de integración de una plataforma
app.get('/api/delivery/plataformas/:id/integracion', autenticar, esAdmin, async (req, res) => {
  try {
    const p = await get('SELECT * FROM plataformas_delivery WHERE id = ?', [req.params.id]);
    if (!p) return res.status(404).json({ error: 'Plataforma no encontrada' });
    const cfg = parseCfgPlataforma(p);
    const slug = slugificar(p.nombre);
    const base = urlPublica() || `${req.protocol}://${req.get('host')}`;
    res.json({
      id: p.id,
      nombre: p.nombre,
      activa: !!p.activa,
      slug,
      webhook_url: `${base}/api/webhooks/${slug}`,
      config: {
        modo: cfg.modo || 'manual',
        api_key: cfg.api_key || '',
        partner_id: cfg.partner_id || p.referencia || '',
        estado: cfg.estado || 'no_configurada',
        ultima_prueba: cfg.ultima_prueba || null,
        actualizada_en: cfg.actualizada_en || null
      }
    });
  } catch (err) {
    errorInterno(res, err);
  }
});

// Guardar configuración de integración de una plataforma
app.put('/api/delivery/plataformas/:id/integracion', autenticar, esAdmin, async (req, res) => {
  try {
    const p = await get('SELECT * FROM plataformas_delivery WHERE id = ?', [req.params.id]);
    if (!p) return res.status(404).json({ error: 'Plataforma no encontrada' });
    const { modo, api_key, partner_id } = req.body;
    const prevCfg = parseCfgPlataforma(p);
    const cfg = {
      modo: modo === 'api' ? 'api' : 'manual',
      api_key: typeof api_key === 'string' ? api_key.trim() : '',
      partner_id: typeof partner_id === 'string' ? partner_id.trim() : (prevCfg.partner_id || p.referencia || ''),
      estado: (modo === 'api' && api_key && String(api_key).trim()) ? 'configurada' : 'no_configurada',
      actualizada_en: new Date().toISOString()
    };
    await run('UPDATE plataformas_delivery SET config = ? WHERE id = ?',
      [JSON.stringify(cfg), req.params.id]);
    await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, ?, ?)',
      [req.usuario.id, 'integracion', `Configuración de integración de ${p.nombre}: ${cfg.modo}`]);
    res.json({ message: 'Integración guardada', config: cfg });
  } catch (err) {
    errorInterno(res, err);
  }
});

// Probar la conexión de una integración (guarda la config previa y hace ping al webhook)
app.post('/api/delivery/plataformas/:id/integracion/test', autenticar, esAdmin, async (req, res) => {
  try {
    const p = await get('SELECT * FROM plataformas_delivery WHERE id = ?', [req.params.id]);
    if (!p) return res.status(404).json({ error: 'Plataforma no encontrada' });

    const { modo, api_key, partner_id } = req.body;
    const cfg = {
      modo: modo === 'api' ? 'api' : 'manual',
      api_key: typeof api_key === 'string' ? api_key.trim() : '',
      partner_id: typeof partner_id === 'string' ? partner_id.trim() : '',
      estado: 'no_configurada',
      actualizada_en: new Date().toISOString()
    };
    await run('UPDATE plataformas_delivery SET config = ? WHERE id = ?',
      [JSON.stringify(cfg), req.params.id]);

    if (cfg.modo !== 'api') {
      return res.json({ ok: false, message: 'La plataforma está en modo manual. Activá la integración automática primero.' });
    }
    if (!cfg.api_key) {
      return res.json({ ok: false, message: 'No hay API Key configurada. Generá una API Key o pegá la de tu partner.' });
    }

    // Ping al propio webhook para validar que la API Key funciona. Siempre contra este
    // mismo servidor: nunca se usa el Host que manda el navegador.
    const slug = slugificar(p.nombre);
    const resultado = await fetch(`http://127.0.0.1:${PORT}/api/webhooks/${slug}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cfg.api_key
      },
      body: JSON.stringify({ test: true, codigo_externo: `TEST-${Date.now()}` })
    });

    const cuerpo = await resultado.json().catch(() => ({}));
    if (resultado.ok) {
      cfg.estado = 'conectada';
      cfg.ultima_prueba = new Date().toISOString();
      await run('UPDATE plataformas_delivery SET config = ? WHERE id = ?',
        [JSON.stringify(cfg), req.params.id]);
      await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, ?, ?)',
        [req.usuario.id, 'integracion', `Prueba de conexión exitosa: ${p.nombre}`]);
      res.json({ ok: true, message: 'Conexión exitosa. La URL del webhook está operativa.' });
    } else {
      res.json({ ok: false, message: cuerpo.error || `Error de conexión (HTTP ${resultado.status})` });
    }
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============ WEBHOOK PÚBLICO PARA RECIBIR PEDIDOS AUTOMÁTICOS ============
// POST /api/webhooks/:plataforma
// Permite a un partner/agregador (o un conector propio) enviar pedidos automáticamente.
// Headers: Content-Type: application/json
// Autenticación obligatoria: x-api-key (o Authorization: Bearer). La plataforma tiene que estar
// en modo API con una API Key configurada; en modo manual el webhook no acepta pedidos.
// Si el body incluye { test: true } solo verifica la conexión (no crea pedidos).
app.post('/api/webhooks/:plataforma', async (req, res) => {
  try {
    const slug = slugificar(req.params.plataforma);
    const plataformas = await all('SELECT * FROM plataformas_delivery');
    const p = plataformas.find(x => slugificar(x.nombre) === slug);
    if (!p) {
      return res.status(404).json({ error: 'Plataforma no registrada en el sistema' });
    }
    if (!p.activa) {
      return res.status(403).json({ error: `La plataforma ${p.nombre} está desactivada` });
    }

    const cfg = parseCfgPlataforma(p);

    if (cfg.modo !== 'api' || !cfg.api_key) {
      return res.status(403).json({ error: `La integración automática de ${p.nombre} no está activada` });
    }
    // Comparación en tiempo constante (se comparan hashes para igualar longitudes)
    const keyRecibida = String(req.headers['x-api-key'] || (req.headers['authorization'] || '').replace('Bearer ', ''));
    const hash = s => crypto.createHash('sha256').update(s).digest();
    if (!crypto.timingSafeEqual(hash(keyRecibida), hash(String(cfg.api_key)))) {
      return res.status(401).json({ error: 'API key inválida' });
    }

    const body = req.body || {};

    // Ping de prueba: no crea pedido
    if (body.test) {
      return res.json({ ok: true, message: `Conexión establecida con ${p.nombre}` });
    }

    // Mapear campos de distintas API de agregadores
    const items = Array.isArray(body.items) ? body.items
      : Array.isArray(body.products) ? body.products
      : Array.isArray(body.productos) ? body.productos
      : [];
    const cliente = body.cliente || body.customer_name || body.nombre_cliente || body.name || '';
    const telefono = body.telefono || body.customer_phone || body.phone || '';
    const direccion = body.direccion || body.delivery_address || body.address || '';
    const notas = body.notas || body.notas_extra || body.notes || '';
    const codigoExterno = body.codigo_externo || body.external_id || body.order_id || '';
    const costoEnvio = parseFloat(body.costo_envio || body.delivery_fee || 0) || 0;

    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'El pedido no contiene items' });
    }

    const resultado = await transaccion(async () => {
      // Evitar pedidos duplicados por código externo (dentro de la transacción: sin carreras)
      if (codigoExterno) {
        const existente = await get(
          'SELECT id, pedido_id FROM entregas WHERE codigo_externo = ? AND plataforma = ?',
          [codigoExterno, p.nombre]
        );
        if (existente) return { duplicado: existente };
      }

      const numero = await generarNumeroPedido();
      const pedidoResult = await run(
        `INSERT INTO pedidos (numero_pedido, tipo, cliente, estado, notas, usuario_id)
         VALUES (?, 'delivery', ?, 'abierto', ?, NULL)`,
        [numero, cliente, notas]
      );
      const pedidoId = pedidoResult.id;

      let subtotal = 0;
      for (const it of items) {
        const nombre = it.nombre || it.name || it.producto || 'Producto';
        const cantidad = parseFloat(it.cantidad || it.quantity || 1) || 1;
        const precio = parseFloat(it.precio || it.price || it.precio_unitario || 0) || 0;
        const producto = await get('SELECT id FROM productos WHERE nombre = ? COLLATE NOCASE', [nombre]);
        await run(
          `INSERT INTO pedido_items (pedido_id, producto_id, nombre_producto, cantidad, precio_unitario, subtotal, notas)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [pedidoId, producto ? producto.id : null, nombre, cantidad, precio, cantidad * precio, it.notas || '']
        );
        subtotal += cantidad * precio;
      }

      const total = parseFloat(body.total || 0) ? parseFloat(body.total) : (subtotal + costoEnvio);
      await run('UPDATE pedidos SET subtotal = ?, total = ? WHERE id = ?', [subtotal, total, pedidoId]);

      await run(
        `INSERT INTO entregas (pedido_id, tipo, direccion, telefono, costo_envio, estado, plataforma, codigo_externo)
         VALUES (?, 'delivery', ?, ?, ?, 'pendiente', ?, ?)`,
        [pedidoId, direccion, telefono, costoEnvio, p.nombre, codigoExterno]
      );

      await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (NULL, ?, ?)',
        ['webhook_delivery', `Pedido ${numero} recibido automáticamente desde ${p.nombre}`]);

      // Notificar en tiempo real (se emite al confirmar la transacción)
      emitEvento('pedido:creado', { id: pedidoId, numero_pedido: numero, tipo: 'delivery', plataforma: p.nombre });
      emitEvento('cocina:actualizar', { pedido_id: pedidoId, accion: 'creado' });
      emitEvento('delivery:actualizar', { pedido_id: pedidoId, accion: 'creado', plataforma: p.nombre });
      emitEvento('dashboard:actualizar', { motivo: 'webhook_delivery' });
      return { pedidoId, numero };
    });

    if (resultado.duplicado) {
      return res.status(409).json({ error: 'Pedido duplicado', entrega_id: resultado.duplicado.id, pedido_id: resultado.duplicado.pedido_id });
    }
    const { pedidoId, numero } = resultado;
    res.status(201).json({
      ok: true,
      pedido_id: pedidoId,
      numero_pedido: numero,
      message: 'Pedido recibido correctamente'
    });
  } catch (err) {
    errorInterno(res, err);
  }
});

// ============ CAJA ============

app.post('/api/caja/abrir', autenticar, async (req, res) => {
  try {
    const { monto_inicial, observaciones } = req.body;
    // En una transacción: dos aperturas simultáneas no pueden crear dos cajas abiertas
    const id = await transaccion(async () => {
      const cajaAbierta = await get("SELECT id FROM caja WHERE estado = 'abierta'");
      if (cajaAbierta) throw errorHttp(400, 'Ya hay una caja abierta');
      const result = await run(
        `INSERT INTO caja (monto_inicial, usuario_id, observaciones) VALUES (?, ?, ?)`,
        [importe(monto_inicial), req.usuario.id, observaciones || '']
      );
      return result.id;
    });
    res.status(201).json({ id, message: 'Caja abierta' });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.post('/api/caja/cerrar', autenticar, async (req, res) => {
  try {
    const { monto_final_real } = req.body;
    const totalVentas = await transaccion(async () => {
      const caja = await get("SELECT * FROM caja WHERE estado = 'abierta'");
      if (!caja) throw errorHttp(400, 'No hay caja abierta');
      const ventas = await get(`
        SELECT COALESCE(SUM(p.total), 0) as total_ventas
        FROM pedidos p
        WHERE p.estado = 'pagado' AND p.cerrado_en >= ?
      `, [caja.fecha_apertura]);
      await run(`UPDATE caja SET estado = 'cerrada', fecha_cierre = CURRENT_TIMESTAMP, monto_final_real = ? WHERE id = ?`,
        [importe(monto_final_real), caja.id]);
      return ventas.total_ventas;
    });
    res.json({ message: 'Caja cerrada', total_ventas: totalVentas });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.get('/api/caja/estado', autenticar, async (req, res) => {
  try {
    const caja = await get(`SELECT c.*, u.nombre as usuario_nombre FROM caja c LEFT JOIN usuarios u ON c.usuario_id = u.id WHERE c.estado = 'abierta'`);
    res.json(caja || null);
  } catch (err) {
    errorInterno(res, err);
  }
});

app.get('/api/caja/historial', autenticar, esAdmin, async (req, res) => {
  try {
    const cajas = await all(`
      SELECT c.*, u.nombre as usuario_nombre,
        (SELECT COALESCE(SUM(p.total), 0) FROM pedidos p WHERE p.estado = 'pagado' AND p.cerrado_en >= c.fecha_apertura AND p.cerrado_en <= COALESCE(c.fecha_cierre, CURRENT_TIMESTAMP)) as ventas
      FROM caja c
      LEFT JOIN usuarios u ON c.usuario_id = u.id
      ORDER BY c.fecha_apertura DESC
    `);
    res.json(cajas);
  } catch (err) {
    errorInterno(res, err);
  }
});

// ============ PROVEEDORES ============

app.get('/api/proveedores', autenticar, async (req, res) => {
  try {
    const proveedores = await all('SELECT * FROM proveedores WHERE activo = 1 ORDER BY nombre');
    res.json(proveedores);
  } catch (err) {
    errorInterno(res, err);
  }
});

app.post('/api/proveedores', autenticar, esAdmin, async (req, res) => {
  try {
    const { nombre, cuit, telefono, email, direccion, notas } = req.body;
    const result = await run(
      'INSERT INTO proveedores (nombre, cuit, telefono, email, direccion, notas) VALUES (?, ?, ?, ?, ?, ?)',
      [nombre, cuit || '', telefono || '', email || '', direccion || '', notas || '']
    );
    res.status(201).json({ id: result.id, message: 'Proveedor creado' });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.put('/api/proveedores/:id', autenticar, esAdmin, async (req, res) => {
  try {
    const { nombre, cuit, telefono, email, direccion, notas, activo } = req.body;
    await run('UPDATE proveedores SET nombre = ?, cuit = ?, telefono = ?, email = ?, direccion = ?, notas = ?, activo = ? WHERE id = ?',
      [nombre, cuit, telefono, email, direccion, notas, activo, req.params.id]);
    res.json({ message: 'Proveedor actualizado' });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.delete('/api/proveedores/:id', autenticar, esAdmin, async (req, res) => {
  try {
    await run('UPDATE proveedores SET activo = 0 WHERE id = ?', [req.params.id]);
    res.json({ message: 'Proveedor desactivado' });
  } catch (err) {
    errorInterno(res, err);
  }
});

// ============ STOCK Y MOVIMIENTOS ============

app.get('/api/stock', autenticar, async (req, res) => {
  try {
    const stock = await all(`
      SELECT p.id, p.nombre, p.stock_actual, p.stock_minimo, p.unidad, c.nombre as categoria_nombre,
        CASE WHEN p.stock_actual <= p.stock_minimo THEN 'bajo'
             WHEN p.stock_actual <= p.stock_minimo * 1.5 THEN 'medio'
             ELSE 'ok' END as nivel
      FROM productos p
      LEFT JOIN categorias c ON p.categoria_id = c.id
      WHERE p.tracking_stock = 1 AND p.activo = 1
      ORDER BY nivel DESC, p.nombre
    `);
    res.json(stock);
  } catch (err) {
    errorInterno(res, err);
  }
});

app.get('/api/stock/movimientos', autenticar, async (req, res) => {
  try {
    const movimientos = await all(`
      SELECT ms.*, p.nombre as producto_nombre, u.nombre as usuario_nombre
      FROM movimientos_stock ms
      JOIN productos p ON ms.producto_id = p.id
      LEFT JOIN usuarios u ON ms.usuario_id = u.id
      ORDER BY ms.fecha DESC
      LIMIT 100
    `);
    res.json(movimientos);
  } catch (err) {
    errorInterno(res, err);
  }
});

app.post('/api/stock/movimiento', autenticar, async (req, res) => {
  try {
    const { producto_id, tipo, motivo } = req.body;
    // Se convierte a número: "5" + 3 concatenaba texto y corrompía el stock
    const cantidad = Number(req.body.cantidad);
    if (!Number.isFinite(cantidad) || cantidad <= 0)
      return res.status(400).json({ error: 'Cantidad inválida' });
    const delta = tipo === 'entrada' ? cantidad : -cantidad;

    const nuevoStock = await transaccion(async () => {
      const producto = await get('SELECT id FROM productos WHERE id = ?', [producto_id]);
      if (!producto) throw errorHttp(404, 'Producto no encontrado');
      // Actualización relativa: no pisa ventas que ocurran al mismo tiempo
      await run('UPDATE productos SET stock_actual = stock_actual + ? WHERE id = ?', [delta, producto_id]);
      await run('INSERT INTO movimientos_stock (producto_id, tipo, cantidad, motivo, usuario_id) VALUES (?, ?, ?, ?, ?)',
        [producto_id, tipo, cantidad, motivo || '', req.usuario.id]);
      return (await get('SELECT stock_actual FROM productos WHERE id = ?', [producto_id])).stock_actual;
    });
    emitEvento('stock:actualizar', { producto_id: Number(producto_id), accion: 'movimiento' });
    res.json({ message: 'Movimiento registrado', nuevo_stock: nuevoStock });
  } catch (err) {
    errorInterno(res, err);
  }
});

// ============ CLIENTES ============

app.get('/api/clientes', autenticar, async (req, res) => {
  try {
    const clientes = await all('SELECT * FROM clientes ORDER BY nombre');
    res.json(clientes);
  } catch (err) {
    errorInterno(res, err);
  }
});

app.post('/api/clientes', autenticar, async (req, res) => {
  try {
    const { nombre, telefono, email, direccion, notas } = req.body;
    const result = await run(
      'INSERT INTO clientes (nombre, telefono, email, direccion, notas) VALUES (?, ?, ?, ?, ?)',
      [nombre, telefono || '', email || '', direccion || '', notas || '']
    );
    res.status(201).json({ id: result.id, message: 'Cliente creado' });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.put('/api/clientes/:id', autenticar, async (req, res) => {
  try {
    const { nombre, telefono, email, direccion, puntos, notas } = req.body;
    await run('UPDATE clientes SET nombre = ?, telefono = ?, email = ?, direccion = ?, puntos = ?, notas = ? WHERE id = ?',
      [nombre, telefono, email, direccion, puntos || 0, notas, req.params.id]);
    res.json({ message: 'Cliente actualizado' });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.delete('/api/clientes/:id', autenticar, async (req, res) => {
  try {
    await run('DELETE FROM clientes WHERE id = ?', [req.params.id]);
    res.json({ message: 'Cliente eliminado' });
  } catch (err) {
    errorInterno(res, err);
  }
});

// ============ REPORTES / ANALITICAS ============

app.get('/api/reportes/dashboard', autenticar, async (req, res) => {
  try {
    const hoy = fechaLocal();
    
    const ventasHoy = await get(`
      SELECT COALESCE(SUM(total), 0) as total, COUNT(*) as pedidos
      FROM pedidos WHERE estado = 'pagado' AND date(cerrado_en, ${LOCAL()}) = ?
    `, [hoy]);
    
    const ayer = fechaLocal(1);
    const ventasAyer = await get(`
      SELECT COALESCE(SUM(total), 0) as total
      FROM pedidos WHERE estado = 'pagado' AND date(cerrado_en, ${LOCAL()}) = ?
    `, [ayer]);
    
    const mesActual = hoy.substring(0, 7);
    const ventasMes = await get(`
      SELECT COALESCE(SUM(total), 0) as total
      FROM pedidos WHERE estado = 'pagado' AND substr(date(cerrado_en, ${LOCAL()}), 1, 7) = ?
    `, [mesActual]);
    
    const topProductos = await all(`
      SELECT pi.nombre_producto, SUM(pi.cantidad) as cantidad, SUM(pi.subtotal) as total
      FROM pedido_items pi
      JOIN pedidos p ON pi.pedido_id = p.id
      WHERE p.estado = 'pagado' AND date(p.cerrado_en, ${LOCAL()}) = ?
      GROUP BY pi.nombre_producto
      ORDER BY cantidad DESC
      LIMIT 5
    `, [hoy]);
    
    const metodosPago = await all(`
      SELECT metodo, SUM(monto) as total, COUNT(*) as cantidad
      FROM pagos p
      JOIN pedidos ped ON p.pedido_id = ped.id
      WHERE date(ped.cerrado_en, ${LOCAL()}) = ?
      GROUP BY metodo
      ORDER BY total DESC
    `, [hoy]);
    
    const pedidosRecientes = await all(`
      SELECT p.*, m.nombre as mesa FROM pedidos p
      LEFT JOIN mesas m ON p.mesa_id = m.id
      ORDER BY p.creado_en DESC LIMIT 5
    `);
    
    const stockBajo = await all(`
      SELECT nombre, stock_actual, stock_minimo, unidad
      FROM productos
      WHERE tracking_stock = 1 AND activo = 1 AND stock_actual <= stock_minimo
      ORDER BY (stock_actual - stock_minimo) ASC
      LIMIT 5
    `);
    
    const ventas7Dias = await all(`
      SELECT date(cerrado_en, ${LOCAL()}) as fecha,
             COALESCE(SUM(total), 0) as total,
             COUNT(*) as pedidos
      FROM pedidos
      WHERE estado = 'pagado'
        AND date(cerrado_en, ${LOCAL()}) >= date('now', ${LOCAL()}, '-6 days')
      GROUP BY date(cerrado_en, ${LOCAL()})
      ORDER BY fecha ASC
    `);
    // Rellenar días sin ventas para tener siempre 7 entradas
    const dias7 = [];
    for (let i = 6; i >= 0; i--) {
      const fecha = fechaLocal(i);
      const found = ventas7Dias.find(v => v.fecha === fecha);
      dias7.push(found || { fecha, total: 0, pedidos: 0 });
    }
    
    const ticketPromedio = await get(`
      SELECT COALESCE(AVG(total), 0) as promedio
      FROM pedidos WHERE estado = 'pagado' AND date(cerrado_en, ${LOCAL()}) = ?
    `, [hoy]);
    
    res.json({
      ventas_hoy: ventasHoy.total,
      pedidos_hoy: ventasHoy.pedidos,
      ventas_ayer: ventasAyer.total,
      cambio_dia: ventasAyer.total > 0 ? ((ventasHoy.total - ventasAyer.total) / ventasAyer.total * 100) : 0,
      ventas_mes: ventasMes.total,
      ticket_promedio: ticketPromedio.promedio,
      top_productos: topProductos,
      metodos_pago: metodosPago,
      pedidos_recientes: pedidosRecientes,
      stock_bajo: stockBajo,
      ventas_7dias: dias7
    });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.get('/api/reportes/ventas', autenticar, async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    let sql = `SELECT p.*, m.nombre as mesa_nombre, u.nombre as usuario_nombre
               FROM pedidos p
               LEFT JOIN mesas m ON p.mesa_id = m.id
               LEFT JOIN usuarios u ON p.usuario_id = u.id
               WHERE p.estado = 'pagado'`;
    const params = [];
    
    if (desde) {
      sql += ` AND date(p.cerrado_en, ${LOCAL()}) >= ?`;
      params.push(desde);
    }
    if (hasta) {
      sql += ` AND date(p.cerrado_en, ${LOCAL()}) <= ?`;
      params.push(hasta);
    }
    sql += ' ORDER BY p.cerrado_en DESC';
    
    const pedidos = await all(sql, params);
    const total = pedidos.reduce((sum, p) => sum + p.total, 0);
    
    res.json({ pedidos, total, cantidad: pedidos.length });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.get('/api/reportes/rentabilidad', autenticar, esAdmin, async (req, res) => {
  try {
    const rentabilidad = await all(`
      SELECT p.nombre, p.precio_venta, p.costo,
        (p.precio_venta - p.costo) as ganancia,
        CASE WHEN p.precio_venta > 0 THEN ((p.precio_venta - p.costo) / p.precio_venta * 100) ELSE 0 END as margen,
        (SELECT COALESCE(SUM(pi.cantidad), 0) FROM pedido_items pi JOIN pedidos pd ON pi.pedido_id = pd.id 
         WHERE pi.producto_id = p.id AND pd.estado = 'pagado') as vendidos
      FROM productos p
      WHERE p.activo = 1
      ORDER BY margen DESC
    `);
    res.json(rentabilidad);
  } catch (err) {
    errorInterno(res, err);
  }
});

// ============ AUDITORIA ============

app.get('/api/auditoria', autenticar, esAdmin, async (req, res) => {
  try {
    const logs = await all(`
      SELECT a.*, u.nombre as usuario_nombre
      FROM auditoria a
      LEFT JOIN usuarios u ON a.usuario_id = u.id
      ORDER BY a.fecha DESC
      LIMIT 100
    `);
    res.json(logs);
  } catch (err) {
    errorInterno(res, err);
  }
});

// ============ INSIGHTS / INTELIGENCIA DE NEGOCIO ============

app.get('/api/insights', autenticar, async (req, res) => {
  try {
    const hoy = fechaLocal();

    // --- Alerta de stock bajo (crítico y preventivo) ---
    const stockBajo = await all(`
      SELECT nombre, stock_actual, stock_minimo, unidad, tracking_stock
      FROM productos
      WHERE activo = 1 AND tracking_stock = 1
        AND stock_actual <= stock_minimo
      ORDER BY (stock_actual - stock_minimo) ASC
    `);

    const stockCritico = stockBajo.filter(p => p.stock_actual === 0 || p.stock_actual <= (p.stock_minimo / 2));
    const stockPreventivo = stockBajo.filter(p => !stockCritico.includes(p));

    // --- Rentabilidad: productos más vendidos vs margen ---
    const topRentabilidad = await all(`
      SELECT p.nombre, p.precio_venta, p.costo,
        (p.precio_venta - p.costo) as ganancia,
        CASE WHEN p.precio_venta > 0 THEN ROUND((p.precio_venta - p.costo) / p.precio_venta * 100, 1) ELSE 0 END as margen,
        (SELECT COALESCE(SUM(pi.cantidad), 0) FROM pedido_items pi JOIN pedidos pd ON pi.pedido_id = pd.id
         WHERE pi.producto_id = p.id AND pd.estado = 'pagado') as vendidos
      FROM productos p
      WHERE p.activo = 1
      ORDER BY vendidos DESC, margen DESC
      LIMIT 10
    `);

    // --- Horas pico (últimos 7 días) para sugerir personal ---
    const horasPico = await all(`
      SELECT CAST(strftime('%H', pd.cerrado_en, ${LOCAL()}) AS INTEGER) as hora, COUNT(*) as pedidos
      FROM pedidos pd
      WHERE pd.estado = 'pagado' AND date(pd.cerrado_en, ${LOCAL()}) >= date('now', ${LOCAL()}, '-7 days')
      GROUP BY hora
      ORDER BY pedidos DESC
      LIMIT 3
    `);

    // --- Comparativa: hoy vs promedio diario de la semana pasada ---
    const ventasHoy = await get(`
      SELECT COALESCE(SUM(total), 0) as total, COUNT(*) as pedidos
      FROM pedidos WHERE estado = 'pagado' AND date(cerrado_en, ${LOCAL()}) = ?
    `, [hoy]);

    const ventasSemana = await get(`
      SELECT COALESCE(AVG(diario), 0) as promedio
      FROM (
        SELECT date(cerrado_en, ${LOCAL()}) as dia, SUM(total) as diario
        FROM pedidos WHERE estado = 'pagado' AND date(cerrado_en, ${LOCAL()}) >= date('now', ${LOCAL()}, '-7 days')
        GROUP BY date(cerrado_en, ${LOCAL()})
      )
    `);

    const diferencia = ventasSemana.promedio > 0
      ? Math.round(((ventasHoy.total - ventasSemana.promedio) / ventasSemana.promedio) * 100)
      : 0;

    // --- Construcción de alertas inteligentes ---
    const alertas = [];

    if (stockCritico.length > 0) {
      alertas.push({
        tipo: 'critico',
        icono: 'exclamation-triangle',
        titulo: `${stockCritico.length} producto${stockCritico.length > 1 ? 's' : ''} sin stock o al límite`,
        detalle: stockCritico.slice(0, 3).map(p => `${p.nombre} (${p.stock_actual}/${p.stock_minimo})`).join(', ') +
          (stockCritico.length > 3 ? ` y ${stockCritico.length - 3} más` : ''),
        accion: 'Reponer inventario',
        enlace: 'stock'
      });
    }

    const muyVendidos = topRentabilidad.filter(p => p.vendidos > 0);
    if (muyVendidos.length > 0 && muyVendidos[0].margen < 30) {
      alertas.push({
        tipo: 'info',
        icono: 'chart-line',
        titulo: 'Revisar precios',
        detalle: `Tu producto más vendido (${muyVendidos[0].nombre}) tiene solo ${muyVendidos[0].margen}% de margen. Un pequeño ajuste puede aumentar la rentabilidad.`,
        accion: 'Ver rentabilidad',
        enlace: 'reportes'
      });
    }

    if (horasPico.length > 0) {
      alertas.push({
        tipo: 'info',
        icono: 'clock',
        titulo: `Horas pico: ${horasPico[0].hora}:00 hs`,
        detalle: 'Considerá reforzar el personal de cocina y salón en estos horarios para optimizar el servicio.',
        accion: 'Ver reportes',
        enlace: 'reportes'
      });
    }

    if (stockPreventivo.length > 0) {
      alertas.push({
        tipo: 'aviso',
        icono: 'boxes',
        titulo: `${stockPreventivo.length} producto${stockPreventivo.length > 1 ? 's' : ''} por agotarse pronto`,
        detalle: stockPreventivo.slice(0, 3).map(p => `${p.nombre} (${p.stock_actual})`).join(', '),
        accion: 'Orden de compra',
        enlace: 'stock'
      });
    }

    // --- Recomendaciones accionables de negocio ---
    const recomendaciones = [];
    if (diferencia < -15) {
      recomendaciones.push({
        icono: 'trending-down',
        titulo: 'Las ventas están por debajo de tu promedio',
        texto: `Hoy las ventas van ${Math.abs(diferencia)}% por debajo de tu promedio diario de la semana. Considerá promociones para impulsar el ticket.`
      });
    } else if (diferencia > 15) {
      recomendaciones.push({
        icono: 'trending-up',
        titulo: '¡Gran día de ventas!',
        texto: `Hoy superás tu promedio diario en ${diferencia}%. Aprovechá el flujo para ofrecer los productos de mayor margen.`
      });
    }

    const altaDemandaBajoStock = topRentabilidad.filter(p => p.vendidos > 0 && stockBajo.some(s => s.nombre === p.nombre));
    if (altaDemandaBajoStock.length > 0) {
      recomendaciones.push({
        icono: 'lightbulb',
        titulo: 'Productos demandados con stock bajo',
        texto: `${altaDemandaBajoStock[0].nombre} se vende bien pero su stock está bajo. Priorizá su reposición para no perder ventas.`
      });
    }

    if (recomendaciones.length === 0) {
      recomendaciones.push({
        icono: 'thumbs-up',
        titulo: 'Todo bajo control',
        texto: 'No se detectan desvíos importantes. Seguí monitoreando el panel para nuevas recomendaciones personalizadas.'
      });
    }

    res.json({
      alertas,
      recomendaciones,
      stock_bajo: stockBajo.map(p => ({
        nombre: p.nombre, stock_actual: p.stock_actual,
        stock_minimo: p.stock_minimo, unidad: p.unidad
      })),
      metricas: {
        ventas_hoy: ventasHoy.total,
        pedidos_hoy: ventasHoy.pedidos,
        promedio_semana: ventasSemana.promedio,
        diferencia_pct: diferencia,
        horas_pico: horasPico
      },
      generado_en: new Date().toISOString()
    });
  } catch (err) {
    errorInterno(res, err);
  }
});

// ============ 404 HANDLER (página custom para rutas no-API) ============


// ============ INTEGRACIONES ============

// Helper: leer/guardar config de integraciones
const getIntCfg = async (tipo) => {
  const row = await get('SELECT valor FROM integraciones_config WHERE clave = ?', [tipo]);
  try { return row ? JSON.parse(row.valor) : {}; } catch { return {}; }
};
const setIntCfg = (tipo, data) => run(
  `INSERT INTO integraciones_config (clave, valor, actualizado_en) VALUES (?, ?, CURRENT_TIMESTAMP)
   ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado_en = excluded.actualizado_en`,
  [tipo, JSON.stringify(data)]
);

// URL pública del sistema (necesaria para webhooks de MP / Tienda Nube)
const urlPublica = () => (process.env.BASE_URL || '').replace(/\/$/, '');

// Cliente HTTP para Mercado Pago
async function mpRequest(cfg, method, ruta, body) {
  const token = cfg.modo === 'produccion' ? cfg.access_token : (cfg.access_token_test || cfg.access_token);
  const r = await fetch(`https://api.mercadopago.com${ruta}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000)
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Mercado Pago ${r.status}: ${data.message || 'error'}`);
  return data;
}

// Cliente HTTP para Tienda Nube (respeta el límite de 2 req/s de su API)
const esperar = ms => new Promise(r => setTimeout(r, ms));
async function tnRequest(cfg, method, ruta, body, reintento = true) {
  const r = await fetch(`https://api.tiendanube.com/v1/${cfg.store_id}${ruta}`, {
    method,
    headers: {
      Authentication: `bearer ${cfg.access_token}`,
      'User-Agent': 'GastroManager/2.0',
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000)
  });
  if (r.status === 429 && reintento) {
    await esperar(2000);
    return tnRequest(cfg, method, ruta, body, false);
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(`Tienda Nube ${r.status}: ${data.description || data.message || 'error'}`);
    err.status = r.status;
    throw err;
  }
  return data;
}

// Campos secretos: nunca se devuelven al navegador. Se muestran enmascarados
// y, si vuelven sin cambios al guardar, se conserva el valor guardado.
const CAMPOS_SECRETOS = {
  mercadopago: ['access_token', 'access_token_test'],
  afip: ['access_token', 'key'],
  tiendanube: ['access_token']
};
const MASCARA = '••••••••';
const enmascarar = v => v ? MASCARA + String(v).slice(-4) : '';

// GET /api/integraciones/config
app.get('/api/integraciones/config', autenticar, esAdmin, async (req, res) => {
  try {
    const [mp, afip, tn] = await Promise.all([
      getIntCfg('mercadopago'),
      getIntCfg('afip'),
      getIntCfg('tiendanube')
    ]);
    const cfgs = { mercadopago: mp, afip, tiendanube: tn };
    for (const [tipo, campos] of Object.entries(CAMPOS_SECRETOS)) {
      for (const c of campos) if (cfgs[tipo][c]) cfgs[tipo][c] = enmascarar(cfgs[tipo][c]);
    }
    if (afip.key) afip.key = MASCARA; // la clave privada no muestra ni el final
    res.json(cfgs);
  } catch (e) { errorInterno(res, e); }
});

// GET /api/integraciones/estado
app.get('/api/integraciones/estado', autenticar, async (req, res) => {
  try {
    const [mp, afip, tn] = await Promise.all([
      getIntCfg('mercadopago'),
      getIntCfg('afip'),
      getIntCfg('tiendanube')
    ]);
    const estado = {
      mercadopago: mp.activa && mp.access_token ? 'conectada' : mp.access_token ? 'configurada' : 'desconectada',
      afip:        afip.activa && afip.cuit && afip.access_token ? 'conectada' : (afip.cuit || afip.access_token) ? 'configurada' : 'desconectada',
      tiendanube:  tn.activa && tn.store_id && tn.access_token ? 'conectada' : tn.store_id ? 'configurada' : 'desconectada',
      delivery:    'desconectada'
    };
    const plat = await all('SELECT COUNT(*) as c FROM plataformas_delivery WHERE activa = 1').catch(() => [{ c: 0 }]);
    if (plat[0] && plat[0].c > 0) estado.delivery = 'conectada';
    res.json(estado);
  } catch (e) { errorInterno(res, e); }
});

// PUT /api/integraciones/config/:tipo
app.put('/api/integraciones/config/:tipo', autenticar, esAdmin, async (req, res) => {
  const { tipo } = req.params;
  if (!['mercadopago', 'afip', 'tiendanube'].includes(tipo))
    return res.status(400).json({ error: 'Tipo no válido' });
  try {
    const data = { ...req.body };
    const actual = await getIntCfg(tipo);
    for (const c of CAMPOS_SECRETOS[tipo]) {
      if (typeof data[c] === 'string' && data[c].startsWith('••')) data[c] = actual[c] || '';
    }
    await setIntCfg(tipo, data);
    await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, ?, ?)',
      [req.usuario.id, 'config_integracion', `Configuración de ${tipo} actualizada`]);
    res.json({ ok: true });
  } catch (e) { errorInterno(res, e); }
});


// POST /api/integraciones/test/:tipo
app.post('/api/integraciones/test/:tipo', autenticar, esAdmin, async (req, res) => {
  const { tipo } = req.params;
  try {
    const cfg = await getIntCfg(tipo);
    if (tipo === 'mercadopago') {
      if (!cfg.access_token) return res.json({ ok: false, message: 'No hay Access Token configurado.' });
      const https = require('https');
      const token = cfg.modo === 'produccion' ? cfg.access_token : (cfg.access_token_test || cfg.access_token);
      const result = await new Promise((resolve) => {
        const opts = { hostname: 'api.mercadopago.com', path: '/v1/payment_methods', method: 'GET',
          headers: { Authorization: `Bearer ${token}` } };
        const r = https.request(opts, (resp) => {
          resp.on('data', () => {});
          resp.on('end', () => resolve({ status: resp.statusCode }));
        });
        r.on('error', (e) => resolve({ status: 0, error: e.message }));
        r.end();
      });
      if (result.status === 200) return res.json({ ok: true, message: 'Conexión con Mercado Pago exitosa.' });
      return res.json({ ok: false, message: `Error ${result.status}: token inválido o sin permisos.` });
    }
    if (tipo === 'afip') {
      if (!cfg.cuit) return res.json({ ok: false, message: 'Falta el CUIT.' });
      if (!cfg.access_token) return res.json({ ok: false, message: 'Falta el Access Token de AfipSDK.' });
      try {
        const afipInst = new Afip({
          CUIT: parseInt(cfg.cuit.replace(/-/g, ''), 10),
          production: cfg.modo === 'produccion',
          access_token: cfg.access_token,
          ...(cfg.cert && cfg.key ? { cert: cfg.cert, key: cfg.key } : {})
        });
        const status = await afipInst.ElectronicBilling.getServerStatus();
        const ok = status && status.AppServer === 'OK' && status.DbServer === 'OK';
        return res.json({
          ok,
          message: ok
            ? `Servidor AFIP OK — CUIT ${cfg.cuit} en modo ${cfg.modo || 'homologacion'}.`
            : `Servidor AFIP con problemas: App=${status.AppServer} DB=${status.DbServer}`
        });
      } catch (eAfip) {
        return res.json({ ok: false, message: `Error al conectar con AFIP: ${eAfip.message}` });
      }
    }
    if (tipo === 'tiendanube') {
      if (!cfg.store_id || !cfg.access_token) return res.json({ ok: false, message: 'Faltan el ID de tienda o el token.' });
      const https = require('https');
      const result = await new Promise((resolve) => {
        const opts = { hostname: 'api.tiendanube.com', path: `/v1/${cfg.store_id}/products?per_page=1`, method: 'GET',
          headers: { Authentication: `bearer ${cfg.access_token}`, 'User-Agent': 'GastroManager/2.0' } };
        const r = https.request(opts, (resp) => {
          resp.on('data', () => {});
          resp.on('end', () => resolve({ status: resp.statusCode }));
        });
        r.on('error', (e) => resolve({ status: 0, error: e.message }));
        r.end();
      });
      if (result.status === 200) return res.json({ ok: true, message: 'Conexión con Tienda Nube exitosa.' });
      return res.json({ ok: false, message: `Error ${result.status}: token o ID de tienda inválidos.` });
    }
    res.json({ ok: false, message: 'Tipo de integración desconocido.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});



// GET /api/integraciones/afip/comprobantes
app.get('/api/integraciones/afip/comprobantes', autenticar, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const rows = await all(
      'SELECT * FROM comprobantes_afip ORDER BY id DESC LIMIT ?', [limit]
    );
    res.json(rows);
  } catch (e) { errorInterno(res, e); }
});

const facturandoPedidos = new Set();

// POST /api/integraciones/afip/facturar
app.post('/api/integraciones/afip/facturar', autenticar, async (req, res) => {
  const pedido_id = parseInt(req.body.pedido_id, 10);
  const tipo_comprobante = parseInt(req.body.tipo_comprobante, 10);
  // CUIT del receptor: obligatorio para Factura A
  const cuitReceptor = String(req.body.cuit_receptor || '').replace(/\D/g, '');
  if (!pedido_id || !tipo_comprobante)
    return res.status(400).json({ error: 'Faltan datos obligatorios.' });
  // 1 = Factura A, 6 = Factura B, 11 = Factura C
  if (![1, 6, 11].includes(tipo_comprobante))
    return res.status(400).json({ error: 'Tipo de comprobante no soportado (usar Factura A, B o C).' });
  if (tipo_comprobante === 1 && cuitReceptor.length !== 11)
    return res.status(400).json({ error: 'La Factura A requiere el CUIT del cliente (11 dígitos).' });
  // Evita pedir dos CAE para el mismo pedido si llegan dos solicitudes a la vez
  // (la llamada a AFIP es HTTP externa y no puede ir dentro de una transacción)
  if (facturandoPedidos.has(pedido_id))
    return res.status(409).json({ error: 'Ya se está generando el comprobante de este pedido.' });
  facturandoPedidos.add(pedido_id);
  try {
    const cfg = await getIntCfg('afip');
    if (!cfg.activa)        return res.status(400).json({ error: 'La integración AFIP no está activa.' });
    if (!cfg.cuit)          return res.status(400).json({ error: 'Configurá el CUIT en Integraciones → AFIP.' });
    if (!cfg.access_token)  return res.status(400).json({ error: 'Configurá el Access Token de AfipSDK en Integraciones → AFIP.' });

    const pedido = await get('SELECT * FROM pedidos WHERE id = ?', [pedido_id]);
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado.' });
    if (pedido.estado !== 'pagado')
      return res.status(400).json({ error: 'Solo se pueden facturar pedidos cobrados.' });

    // No emitir comprobante duplicado para el mismo pedido
    const yaFacturado = await get(
      'SELECT id, cae, tipo_comprobante_nombre FROM comprobantes_afip WHERE pedido_id = ?',
      [pedido_id]
    );
    if (yaFacturado) {
      return res.status(409).json({
        error: `Este pedido ya tiene ${yaFacturado.tipo_comprobante_nombre} con CAE ${yaFacturado.cae}.`
      });
    }

    // Construir instancia Afip con o sin certificado propio
    const afipOpts = {
      CUIT:         parseInt(String(cfg.cuit).replace(/-/g, ''), 10),
      production:   cfg.modo === 'produccion',
      access_token: cfg.access_token
    };
    // Si el usuario subió su propio cert + key, los usamos
    if (cfg.cert && cfg.key && !/^•+$/.test(cfg.key)) {
      afipOpts.cert = cfg.cert;
      afipOpts.key  = cfg.key;
    }
    const afipInst = new Afip(afipOpts);

    const ptoVenta = parseInt(cfg.pto_venta, 10) || 1;

    // Obtener último número de comprobante para calcular el siguiente
    const ultimoNro = await afipInst.ElectronicBilling.getLastVoucher(ptoVenta, tipo_comprobante);
    const nroComprobante = ultimoNro + 1;

    // Fecha en formato YYYYMMDD que requiere AFIP
    const hoy = new Date();
    const fechaAFIP = `${hoy.getFullYear()}${String(hoy.getMonth() + 1).padStart(2, '0')}${String(hoy.getDate()).padStart(2, '0')}`;

    // Calcular importes. El total del pedido incluye IVA.
    const total = parseFloat(pedido.total) || 0;
    // Alícuotas AFIP: 3 = 0%, 4 = 10.5%, 5 = 21%, 6 = 27%
    const ALICUOTAS = { 3: 0, 4: 0.105, 5: 0.21, 6: 0.27 };
    const codigoAlicuota = ALICUOTAS[cfg.iva_tipo] !== undefined ? Number(cfg.iva_tipo) : 5;
    const tasaIVA = ALICUOTAS[codigoAlicuota];
    // Factura A y B (emisor Responsable Inscripto) discriminan IVA; Factura C (monotributo) no lleva IVA
    const discriminaIVA = tipo_comprobante === 1 || tipo_comprobante === 6;
    let impNeto = total, impIVA = 0;
    if (discriminaIVA) {
      impNeto = parseFloat((total / (1 + tasaIVA)).toFixed(2));
      impIVA  = parseFloat((total - impNeto).toFixed(2));
    }

    const voucherData = {
      CbteTipo:   tipo_comprobante,
      PtoVta:     ptoVenta,
      Concepto:   1,           // 1=Productos, 2=Servicios, 3=Productos y Servicios
      // Factura A: 80 = CUIT del receptor. B/C: 99 = Consumidor Final
      DocTipo:    tipo_comprobante === 1 ? 80 : 99,
      DocNro:     tipo_comprobante === 1 ? parseInt(cuitReceptor, 10) : 0,
      // Condición IVA del receptor (obligatoria): 1 = Resp. Inscripto, 5 = Consumidor Final
      CondicionIVAReceptorId: tipo_comprobante === 1 ? 1 : 5,
      CbteDesde:  nroComprobante,
      CbteHasta:  nroComprobante,
      CbteFch:    parseInt(fechaAFIP, 10),
      ImpTotal:   total,
      ImpTotConc: 0,
      ImpNeto:    impNeto,
      ImpOpEx:    0,
      ImpIVA:     impIVA,
      ImpTrib:    0,
      MonId:      'PES',
      MonCotiz:   1,
      ...(discriminaIVA ? {
        Iva: [{ Id: codigoAlicuota, BaseImp: impNeto, Importe: impIVA }]
      } : {})
    };

    // Llamada real al WSFE de AFIP
    const resultado = await afipInst.ElectronicBilling.createVoucher(voucherData);

    const nombres = { 1: 'Factura A', 2: 'Nota Débito A', 3: 'Nota Crédito A',
                      6: 'Factura B', 7: 'Nota Débito B', 8: 'Nota Crédito B',
                     11: 'Factura C', 12: 'Nota Débito C', 13: 'Nota Crédito C',
                     51: 'Factura M' };

    await run(
      `INSERT INTO comprobantes_afip
         (pedido_id, tipo_comprobante, tipo_comprobante_nombre, punto_venta,
          numero_comprobante, cae, cae_vencimiento, fecha_comprobante, total)
       VALUES (?, ?, ?, ?, ?, ?, ?, date('now', ${LOCAL()}), ?)`,
      [pedido_id, tipo_comprobante, nombres[tipo_comprobante] || `Tipo ${tipo_comprobante}`,
       ptoVenta, nroComprobante, resultado.CAE, resultado.CAEFchVto, total]
    );

    emitEvento('afip:comprobante', { pedido_id, cae: resultado.CAE });

    res.json({
      ok:                true,
      cae:               resultado.CAE,
      cae_vencimiento:   resultado.CAEFchVto,
      numero_comprobante: nroComprobante,
      punto_venta:       ptoVenta,
      tipo_comprobante,
      tipo_nombre:       nombres[tipo_comprobante] || `Tipo ${tipo_comprobante}`
    });
  } catch (e) {
    console.error('[AFIP facturar]', e.message);
    res.status(500).json({ error: e.message });
  } finally {
    facturandoPedidos.delete(pedido_id);
  }
});

// POST /api/integraciones/tiendanube/sync-productos
app.post('/api/integraciones/tiendanube/sync-productos', autenticar, async (req, res) => {
  try {
    const cfg = await getIntCfg('tiendanube');
    if (!cfg.store_id || !cfg.access_token)
      return res.status(400).json({ error: 'Configurá el ID de tienda y el token primero.' });
    // Solo productos de venta (con precio); los insumos no se publican en la tienda
    const productos = await all('SELECT * FROM productos WHERE activo = 1 AND precio_venta > 0 ORDER BY id');
    let creados = 0, actualizados = 0;
    const errores = [];

    for (const p of productos) {
      const precio = Number(p.precio_venta).toFixed(2);
      const variante = {
        price: precio,
        stock_management: !!p.tracking_stock,
        stock: p.tracking_stock ? Math.max(0, Math.floor(p.stock_actual || 0)) : null
      };
      try {
        let actualizado = false;
        if (p.tn_product_id && p.tn_variant_id) {
          try {
            await tnRequest(cfg, 'PUT', `/products/${p.tn_product_id}`,
              { name: { es: p.nombre }, description: { es: p.descripcion || '' } });
            await esperar(500);
            await tnRequest(cfg, 'PUT', `/products/${p.tn_product_id}/variants/${p.tn_variant_id}`, variante);
            actualizado = true;
            actualizados++;
          } catch (e) {
            if (e.status !== 404) throw e; // si lo borraron en Tienda Nube, se vuelve a crear
          }
        }
        if (!actualizado) {
          const creado = await tnRequest(cfg, 'POST', '/products', {
            name: { es: p.nombre },
            description: { es: p.descripcion || '' },
            variants: [variante]
          });
          await run('UPDATE productos SET tn_product_id = ?, tn_variant_id = ? WHERE id = ?',
            [creado.id, creado.variants && creado.variants[0] ? creado.variants[0].id : null, p.id]);
          creados++;
        }
      } catch (e) {
        errores.push(`${p.nombre}: ${e.message}`);
      }
      await esperar(500);
    }

    const sincronizados = creados + actualizados;
    await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, ?, ?)',
      [req.usuario.id, 'integracion', `Sync Tienda Nube: ${creados} creados, ${actualizados} actualizados, ${errores.length} errores`]);
    res.json({
      ok: errores.length === 0,
      message: errores.length
        ? `Sincronización con ${errores.length} error(es): ${errores.slice(0, 3).join(' | ')}`
        : (productos.length ? 'Productos sincronizados' : 'No hay productos con precio de venta para publicar'),
      sincronizados, creados, actualizados, errores
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/integraciones/mercadopago/link/:pedidoId
// Crea un link de pago (Checkout Pro) para un pedido abierto. El pago aprobado
// llega por /api/mp/notificacion y cierra el pedido automáticamente.
app.post('/api/integraciones/mercadopago/link/:pedidoId', autenticar, async (req, res) => {
  try {
    const cfg = await getIntCfg('mercadopago');
    if (!cfg.activa || !cfg.access_token)
      return res.status(400).json({ error: 'Configurá y activá Mercado Pago en Integraciones.' });
    const pedido = await get('SELECT * FROM pedidos WHERE id = ?', [req.params.pedidoId]);
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
    if (pedido.estado !== 'abierto') return res.status(400).json({ error: 'El pedido no está abierto' });
    if (!(pedido.total > 0)) return res.status(400).json({ error: 'El pedido no tiene importe' });

    const base = urlPublica();
    const preferencia = await mpRequest(cfg, 'POST', '/checkout/preferences', {
      items: [{ title: `Pedido ${pedido.numero_pedido}`, quantity: 1, unit_price: Number(pedido.total), currency_id: 'ARS' }],
      external_reference: String(pedido.id),
      // MP solo acepta URLs públicas HTTPS para notificaciones
      ...(base.startsWith('https://') ? { notification_url: `${base}/api/mp/notificacion` } : {})
    });
    res.json({
      link: cfg.modo === 'produccion' ? preferencia.init_point : (preferencia.sandbox_init_point || preferencia.init_point),
      preferencia_id: preferencia.id,
      notificaciones: base.startsWith('https://')
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/mp/notificacion  (Webhook / IPN de Mercado Pago)
// No se confía en el cuerpo recibido: se consulta el pago a la API de MP con nuestro token.
app.post('/api/mp/notificacion', async (req, res) => {
  const body = req.body || {};
  const tipo = body.type || body.topic || req.query.type || req.query.topic;
  const paymentId = (body.data && body.data.id) || req.query['data.id'] || req.query.id;
  if (tipo !== 'payment' || !paymentId) return res.sendStatus(200);

  try {
    const cfg = await getIntCfg('mercadopago');
    if (!cfg.access_token) return res.sendStatus(200);

    const pago = await mpRequest(cfg, 'GET', `/v1/payments/${encodeURIComponent(paymentId)}`);
    const pedido = pago.external_reference
      ? await get('SELECT * FROM pedidos WHERE id = ?', [pago.external_reference])
      : null;
    if (!pedido) return res.sendStatus(200);

    // La consulta HTTP a MP ya se hizo: desde acá todo es una sola transacción
    await transaccion(async () => {
      await run('UPDATE pedidos SET mp_payment_id = ? WHERE id = ?', [String(pago.id), pedido.id]);
      // Idempotente: MP reenvía notificaciones; registrarPago solo cobra pedidos abiertos
      if (pago.status === 'approved') {
        const cobrado = await registrarPago(pedido, {
          metodo: 'mercadopago',
          monto: Number(pago.transaction_amount) || pedido.total,
          referencia: `MP-${pago.id}`,
          usuarioId: null
        });
        if (cobrado) {
          await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (NULL, ?, ?)',
            ['pago_mercadopago', `Pedido ${pedido.numero_pedido} cobrado por Mercado Pago (pago ${pago.id})`]);
        }
      }
      emitEvento('pago:recibido', { payment_id: pago.id, pedido_id: pedido.id, estado: pago.status });
    });
    res.sendStatus(200);
  } catch (e) {
    console.error('[MP notificacion]', e.message);
    res.sendStatus(500); // MP reintenta la notificación
  }
});

// POST /api/tiendanube/webhook  (Webhook de Tienda Nube)
// Tienda Nube envía solo { store_id, event, id }: el pedido se consulta a su API,
// lo que además valida que pertenece a nuestra tienda.
app.post('/api/tiendanube/webhook', async (req, res) => {
  const evento = req.body || {};
  if (evento.event !== 'order/created' || !evento.id) return res.sendStatus(200);

  try {
    const cfg = await getIntCfg('tiendanube');
    if (!cfg.activa || !cfg.store_id || !cfg.access_token) return res.sendStatus(200);
    if (evento.store_id && String(evento.store_id) !== String(cfg.store_id)) return res.sendStatus(200);

    const o = await tnRequest(cfg, 'GET', `/orders/${encodeURIComponent(evento.id)}`);
    const codigoExterno = String(o.id);
    const cliente = o.contact_name || (o.customer && o.customer.name) || 'Cliente Tienda Nube';
    const telefono = o.contact_phone || (o.customer && o.customer.phone) || '';
    const dir = o.shipping_address || {};
    const direccion = [dir.address, dir.number, dir.floor, dir.locality, dir.city].filter(Boolean).join(' ');
    const esRetiro = o.shipping_pickup_type === 'pickup';
    const tipo = esRetiro ? 'takeaway' : 'delivery';
    const costoEnvio = parseFloat(o.shipping_cost_customer) || 0;

    // La consulta HTTP ya se hizo: el alta del pedido es una sola transacción
    await transaccion(async () => {
      // Dentro de la transacción: dos reintentos simultáneos no duplican el pedido
      const existente = await get(
        "SELECT pedido_id FROM entregas WHERE codigo_externo = ? AND plataforma = 'Tienda Nube'", [codigoExterno]);
      if (existente) return;

      const numero = await generarNumeroPedido();
      const { id: pedidoId } = await run(
        `INSERT INTO pedidos (numero_pedido, tipo, cliente, estado, notas, usuario_id, origen)
         VALUES (?, ?, ?, 'abierto', ?, NULL, 'tiendanube')`,
        [numero, tipo, cliente, [`Tienda Nube #${o.number || o.id}`, o.note].filter(Boolean).join(' – ')]);

      let subtotal = 0;
      for (const it of (o.products || [])) {
        const cantidad = parseFloat(it.quantity) || 1;
        const precio = parseFloat(it.price) || 0;
        const producto = await get(
          'SELECT id FROM productos WHERE tn_product_id = ? OR nombre = ? COLLATE NOCASE ORDER BY tn_product_id IS NULL LIMIT 1',
          [it.product_id || -1, it.name || '']);
        await run(
          `INSERT INTO pedido_items (pedido_id, producto_id, nombre_producto, cantidad, precio_unitario, subtotal, notas)
           VALUES (?, ?, ?, ?, ?, ?, '')`,
          [pedidoId, producto ? producto.id : null, it.name || 'Producto', cantidad, precio, cantidad * precio]);
        subtotal += cantidad * precio;
      }
      const total = parseFloat(o.total) || (subtotal + costoEnvio);
      await run('UPDATE pedidos SET subtotal = ?, total = ? WHERE id = ?', [subtotal, total, pedidoId]);
      await run(
        `INSERT INTO entregas (pedido_id, tipo, direccion, telefono, costo_envio, estado, plataforma, codigo_externo)
         VALUES (?, ?, ?, ?, ?, 'pendiente', 'Tienda Nube', ?)`,
        [pedidoId, tipo, direccion, telefono, costoEnvio, codigoExterno]);
      await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (NULL, ?, ?)',
        ['webhook_tiendanube', `Pedido ${numero} recibido desde Tienda Nube #${o.number || o.id}`]);

      emitEvento('pedido:creado', { id: pedidoId, numero_pedido: numero, tipo, plataforma: 'Tienda Nube' });
      emitEvento('cocina:actualizar', { pedido_id: pedidoId, accion: 'creado' });
      emitEvento('delivery:actualizar', { pedido_id: pedidoId, accion: 'creado', plataforma: 'Tienda Nube' });
      emitEvento('dashboard:actualizar', { motivo: 'webhook_tiendanube' });
    });
    res.sendStatus(200);
  } catch (e) {
    console.error('[Tienda Nube webhook]', e.message);
    res.sendStatus(500); // Tienda Nube reintenta el webhook
  }
});

// ============ FIN INTEGRACIONES ============

// ============ COPIAS DE SEGURIDAD ============
// Copia automática cada 24 hs en data/backups (se conservan las últimas BACKUPS_CONSERVAR).
// Con BACKUP_COPIA_DIR (ej. una carpeta de Google Drive / OneDrive sincronizada) se guarda
// además un duplicado fuera de la carpeta del sistema.
// Restaurar: detener el servidor, reemplazar data/gastromanager.db por la copia y volver a iniciarlo.
const DIR_BACKUPS = path.join(__dirname, 'data', 'backups');
const BACKUPS_CONSERVAR = Math.max(1, parseInt(process.env.BACKUPS_CONSERVAR, 10) || 30);
const NOMBRE_BACKUP = /^gastromanager_\d{4}-\d{2}-\d{2}_\d{6}\.db$/;

function listarBackups() {
  if (!fs.existsSync(DIR_BACKUPS)) return [];
  return fs.readdirSync(DIR_BACKUPS)
    .filter(n => NOMBRE_BACKUP.test(n))
    .map(nombre => {
      const st = fs.statSync(path.join(DIR_BACKUPS, nombre));
      return { nombre, tamano: st.size, fecha: st.mtime.toISOString() };
    })
    .sort((a, b) => b.nombre.localeCompare(a.nombre));
}

let backupEnCurso = null;
function crearBackup() {
  // Si ya hay una copia en curso se reutiliza (evita dos VACUUM a la vez)
  if (backupEnCurso) return backupEnCurso;
  backupEnCurso = (async () => {
    fs.mkdirSync(DIR_BACKUPS, { recursive: true });
    const hora = new Intl.DateTimeFormat('en-GB', {
      timeZone: ZONA_HORARIA, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).format(new Date()).replace(/:/g, '');
    const nombre = `gastromanager_${fechaLocal()}_${hora}.db`;
    const destino = path.join(DIR_BACKUPS, nombre);
    // VACUUM INTO genera una copia consistente aunque la base esté en uso
    await new Promise((resolve, reject) => db.run('VACUUM INTO ?', [destino], err => err ? reject(err) : resolve()));

    if (process.env.BACKUP_COPIA_DIR) {
      try {
        fs.mkdirSync(process.env.BACKUP_COPIA_DIR, { recursive: true });
        fs.copyFileSync(destino, path.join(process.env.BACKUP_COPIA_DIR, nombre));
      } catch (e) {
        console.error('[backup] No se pudo copiar a BACKUP_COPIA_DIR:', e.message);
      }
    }
    // Rotación: se borran las más viejas
    for (const viejo of listarBackups().slice(BACKUPS_CONSERVAR)) {
      try { fs.unlinkSync(path.join(DIR_BACKUPS, viejo.nombre)); } catch (e) {}
    }
    console.log(`[backup] Copia creada: ${nombre}`);
    return listarBackups().find(b => b.nombre === nombre);
  })().finally(() => { backupEnCurso = null; });
  return backupEnCurso;
}

// Crea una copia si la última tiene más de 24 hs (se revisa al iniciar y cada hora)
async function backupSiCorresponde() {
  try {
    const ultima = listarBackups()[0];
    if (!ultima || Date.now() - new Date(ultima.fecha).getTime() >= 24 * 3600 * 1000) {
      await crearBackup();
    }
  } catch (e) {
    console.error('[backup] Error al crear la copia automática:', e);
  }
}

app.get('/api/backups', autenticar, esAdmin, (req, res) => {
  try { res.json(listarBackups()); } catch (err) { errorInterno(res, err); }
});

app.post('/api/backups', autenticar, esAdmin, async (req, res) => {
  try {
    const backup = await crearBackup();
    await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, ?, ?)',
      [req.usuario.id, 'backup', `Copia de seguridad manual: ${backup.nombre}`]);
    res.status(201).json(backup);
  } catch (err) { errorInterno(res, err); }
});

app.get('/api/backups/:nombre', autenticar, esAdmin, (req, res) => {
  // Solo nombres generados por el sistema: evita leer archivos fuera de data/backups
  if (!NOMBRE_BACKUP.test(req.params.nombre)) return res.status(400).json({ error: 'Nombre de copia inválido' });
  const archivo = path.join(DIR_BACKUPS, req.params.nombre);
  if (!fs.existsSync(archivo)) return res.status(404).json({ error: 'Copia no encontrada' });
  res.download(archivo, req.params.nombre);
});



app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Endpoint no encontrado' });
  }
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// ============ INICIAR SERVIDOR ============

migrarEsquema().then(() => server.listen(PORT, () => {
  console.log('==========================================');
  console.log('  🍽️  GASTROMANAGER v2.0');
  console.log('  Sistema de Gestión Gastronómica');
  console.log('==========================================');
  console.log(`  Servidor corriendo en: http://localhost:${PORT}`);
  console.log(`  API disponible en: http://localhost:${PORT}/api`);
  console.log(`  Socket.IO realtime: activo`);
  console.log(`  Zona horaria: ${ZONA_HORARIA}`);
  console.log('==========================================');
  // Copias de seguridad automáticas
  backupSiCorresponde();
  setInterval(backupSiCorresponde, 60 * 60 * 1000).unref();
})).catch(err => {
  console.error('Error al migrar la base de datos:', err);
  process.exit(1);
});



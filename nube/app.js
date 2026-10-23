'use strict';
// Morfi Nube: recibe las ventas y el estado de cada local y los muestra en un panel.
// - Los locales mandan con su token (Authorization: Bearer ...): solo pueden escribir lo suyo.
// - El dueño ve los locales de su cuenta; soporte ve todos (para atender a los clientes).
// El sistema de cada local sigue siendo el que manda: si la nube no está, el local trabaja igual y reenvía después.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { run, get, all, transaccion, listo, DIR } = require('./db');

// Clave para firmar las sesiones del panel: NUBE_SECRETO o una propia guardada junto a la base
function secreto() {
  if (process.env.NUBE_SECRETO) return process.env.NUBE_SECRETO;
  const archivo = path.join(DIR, '.secreto');
  try { const s = fs.readFileSync(archivo, 'utf8').trim(); if (s.length >= 32) return s; } catch (e) {}
  const nuevo = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(archivo, nuevo, { mode: 0o600 });
  return nuevo;
}
const SECRETO = secreto();
const hashToken = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const errorHttp = (status, mensaje) => Object.assign(new Error(mensaje), { status });
const ruta = fn => async (req, res, next) => {
  try { await listo; await fn(req, res, next); } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error('[nube]', e);
    res.status(500).json({ error: 'Error interno' });
  }
};

const app = express();
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? true : 'loopback');
const politica = extra => helmet({ contentSecurityPolicy: { useDefaults: false, directives: {
  defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'],
  fontSrc: ["'self'", 'data:'], connectSrc: ["'self'"], objectSrc: ["'none'"], baseUri: ["'self'"], frameAncestors: ["'none'"],
  formAction: ["'self'"], ...extra } } });
const politicaPanel = politica({});
// La carta pública es la misma página del local (public/pedido.html), que usa onclick en el HTML
const politicaCarta = politica({ scriptSrcAttr: ["'unsafe-inline'"] });
app.use((req, res, next) => (req.path.startsWith('/l/') ? politicaCarta : politicaPanel)(req, res, next));
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api/', rateLimit({ windowMs: 60000, max: 600, standardHeaders: true, legacyHeaders: false }));

app.get('/api/salud', ruta(async (req, res) => { res.json({ ok: true }); }));

// ============ LO QUE MANDAN LOS LOCALES ============

const autenticarLocal = ruta(async (req, res, next) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const local = token && await get('SELECT id, cuenta_id, nombre FROM locales WHERE token_hash = ?', [hashToken(token)]);
  if (!local) throw errorHttp(401, 'Token de local inválido');
  req.local = local;
  next();
});

function validarVenta(v) {
  const pedidoId = Number(v && v.pedido_id);
  if (!Number.isInteger(pedidoId) || pedidoId <= 0) throw errorHttp(400, 'Venta sin pedido_id');
  if (!FECHA.test(String(v.fecha || ''))) throw errorHttp(400, `Venta ${pedidoId} sin fecha válida`);
  if (!['pagado', 'cancelado'].includes(v.estado)) throw errorHttp(400, `Venta ${pedidoId} con estado inválido`);
  const items = Array.isArray(v.items) ? v.items.slice(0, 500) : [];
  return { pedidoId, items };
}

// Idempotente: el local puede reenviar (se cortó internet a mitad de camino) y la venta se reemplaza, no se duplica
app.post('/api/sync/ventas', autenticarLocal, ruta(async (req, res) => {
  const ventas = Array.isArray(req.body && req.body.ventas) ? req.body.ventas : [];
  if (ventas.length > 500) throw errorHttp(413, 'Máximo 500 ventas por envío');
  const validas = ventas.map(v => ({ v, ...validarVenta(v) }));
  await transaccion(async () => {
    for (const { v, pedidoId, items } of validas) {
      await run(`INSERT OR REPLACE INTO ventas (local_id, pedido_id, numero, fecha, hora, estado, tipo, metodo, total, propina, descuento)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [req.local.id, pedidoId, String(v.numero || '').slice(0, 40), v.fecha,
        String(v.hora || '').slice(0, 5), v.estado, String(v.tipo || '').slice(0, 20), String(v.metodo || '').slice(0, 20),
        r2(v.total), r2(v.propina), r2(v.descuento)]);
      await run('DELETE FROM ventas_items WHERE local_id = ? AND pedido_id = ?', [req.local.id, pedidoId]);
      for (const it of items) {
        await run('INSERT INTO ventas_items (local_id, pedido_id, producto, cantidad, subtotal) VALUES (?, ?, ?, ?, ?)',
          [req.local.id, pedidoId, String(it.producto || '').slice(0, 120), Number(it.cantidad) || 0, r2(it.subtotal)]);
      }
    }
    await run('UPDATE locales SET ultima_sync = CURRENT_TIMESTAMP WHERE id = ?', [req.local.id]);
  });
  res.json({ ok: true, recibidas: validas.length });
}));

// Estado del local: versión, última copia, facturas en espera, internet. Cada envío reemplaza el anterior.
app.post('/api/sync/estado', autenticarLocal, ruta(async (req, res) => {
  const b = req.body || {};
  const estado = {
    version: String(b.version || '').slice(0, 40),
    ultima_copia: b.ultima_copia ? String(b.ultima_copia).slice(0, 40) : null,
    copia_en_nube: !!b.copia_en_nube,
    facturas_en_espera: Number(b.facturas_en_espera) || 0,
    facturas_con_error: Number(b.facturas_con_error) || 0,
    caja_abierta: !!b.caja_abierta,
    ventas_sin_enviar: Number(b.ventas_sin_enviar) || 0
  };
  await run('UPDATE locales SET estado = ?, ultima_sync = CURRENT_TIMESTAMP WHERE id = ?', [JSON.stringify(estado), req.local.id]);
  res.json({ ok: true });
}));

// Carta online de cada local (/l/<cliente>) y sus pedidos
const tienda = require('./tienda');
tienda(app, { ruta, errorHttp, autenticarLocal, r2 });

// ============ PANEL ============

const loginLimiter = rateLimit({ windowMs: 15 * 60000, max: 10, skipSuccessfulRequests: true,
  message: { error: 'Demasiados intentos. Probá de nuevo en unos minutos.' } });

app.post('/api/login', loginLimiter, ruta(async (req, res) => {
  const { email, password } = req.body || {};
  const u = await get('SELECT * FROM usuarios WHERE email = ?', [String(email || '').trim().toLowerCase()]);
  if (!u || !(await bcrypt.compare(String(password || ''), u.password))) throw errorHttp(400, 'Email o contraseña incorrectos');
  const cuenta = u.cuenta_id ? await get('SELECT nombre FROM cuentas WHERE id = ?', [u.cuenta_id]) : null;
  res.json({ token: jwt.sign({ id: u.id }, SECRETO, { expiresIn: '12h' }),
    usuario: { nombre: u.nombre, rol: u.rol, cuenta: cuenta ? cuenta.nombre : null } });
}));

const autenticarUsuario = ruta(async (req, res, next) => {
  let datos;
  try { datos = jwt.verify((req.headers.authorization || '').replace(/^Bearer\s+/i, ''), SECRETO); } catch (e) { throw errorHttp(401, 'Iniciá sesión'); }
  const u = await get('SELECT id, cuenta_id, nombre, rol FROM usuarios WHERE id = ?', [datos.id]);
  if (!u) throw errorHttp(401, 'Iniciá sesión');
  req.usuario = u;
  next();
});

// Locales que ve el usuario: los de su cuenta (soporte: todos, o los de ?cuenta=)
async function localesVisibles(u, cuentaId) {
  if (u.rol === 'soporte') {
    return cuentaId ? all('SELECT * FROM locales WHERE cuenta_id = ? ORDER BY nombre', [cuentaId])
      : all('SELECT * FROM locales ORDER BY nombre');
  }
  return all('SELECT * FROM locales WHERE cuenta_id = ? ORDER BY nombre', [u.cuenta_id]);
}

function periodo(q) {
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.ZONA_HORARIA || 'America/Argentina/Buenos_Aires' }).format(new Date());
  const desde = q.desde || hoy, hasta = q.hasta || hoy;
  if (!FECHA.test(desde) || !FECHA.test(hasta) || desde > hasta) throw errorHttp(400, 'Período inválido');
  return { desde, hasta };
}
const enLista = ids => ids.length ? ids.map(() => '?').join(',') : 'NULL';

// Ventas del período por local y en total, por día y los productos más vendidos. Ventas = cobrado sin propina.
app.get('/api/panel/resumen', autenticarUsuario, ruta(async (req, res) => {
  const { desde, hasta } = periodo(req.query);
  const locales = await localesVisibles(req.usuario, req.query.cuenta && Number(req.query.cuenta));
  const ids = locales.map(l => l.id);
  const base = `FROM ventas WHERE estado = 'pagado' AND fecha BETWEEN ? AND ? AND local_id IN (${enLista(ids)})`;
  const porLocal = await all(`SELECT local_id, COUNT(*) AS tickets, SUM(total - propina) AS ventas, SUM(propina) AS propinas, SUM(descuento) AS descuentos
    ${base} GROUP BY local_id`, [desde, hasta, ...ids]);
  const porDia = await all(`SELECT fecha, local_id, SUM(total - propina) AS ventas, COUNT(*) AS tickets ${base} GROUP BY fecha, local_id ORDER BY fecha`,
    [desde, hasta, ...ids]);
  const productos = await all(`SELECT i.producto, SUM(i.cantidad) AS cantidad, SUM(i.subtotal) AS importe
    FROM ventas_items i JOIN ventas v ON v.local_id = i.local_id AND v.pedido_id = i.pedido_id
    WHERE v.estado = 'pagado' AND v.fecha BETWEEN ? AND ? AND v.local_id IN (${enLista(ids)})
    GROUP BY i.producto ORDER BY importe DESC LIMIT 15`, [desde, hasta, ...ids]);
  const fila = l => {
    const p = porLocal.find(x => x.local_id === l.id) || {};
    const ventas = r2(p.ventas), tickets = p.tickets || 0;
    return { id: l.id, nombre: l.nombre, ventas, tickets, ticket_promedio: tickets ? r2(ventas / tickets) : 0,
      propinas: r2(p.propinas), descuentos: r2(p.descuentos) };
  };
  const filas = locales.map(fila);
  const ventas = r2(filas.reduce((s, f) => s + f.ventas, 0)), tickets = filas.reduce((s, f) => s + f.tickets, 0);
  res.json({ desde, hasta, locales: filas,
    total: { ventas, tickets, ticket_promedio: tickets ? r2(ventas / tickets) : 0, propinas: r2(filas.reduce((s, f) => s + f.propinas, 0)) },
    por_dia: porDia.map(d => ({ ...d, ventas: r2(d.ventas) })),
    productos: productos.map(p => ({ ...p, importe: r2(p.importe) })) });
}));

// Salud de cada local: si manda datos, copias, facturas trabadas. Alertas para actuar antes de que llame el cliente.
const MIN_SIN_SYNC = 15;
function alertas(l, estado, minutos, trabados) {
  const a = [];
  if (trabados) a.push(`${trabados} pedido(s) online sin recibir en el local`);
  if (minutos === null) a.push('Nunca se conectó a la nube');
  else if (minutos > MIN_SIN_SYNC) a.push(`Sin noticias hace ${minutos >= 120 ? Math.round(minutos / 60) + ' h' : minutos + ' min'} (sin internet o PC apagada)`);
  if (estado.ultima_copia && Date.now() - new Date(estado.ultima_copia).getTime() > 26 * 3600000) a.push('Sin copia de seguridad hace más de 26 h');
  if (estado.version && !estado.copia_en_nube) a.push('Sin copia en la nube configurada');
  if (estado.facturas_con_error) a.push(`${estado.facturas_con_error} factura(s) que ARCA rechazó`);
  if (estado.facturas_en_espera) a.push(`${estado.facturas_en_espera} factura(s) en espera de ARCA`);
  return a;
}

async function estadoLocales(locales) {
  return Promise.all(locales.map(async l => {
    const estado = JSON.parse(l.estado || '{}');
    const minutos = l.ultima_sync ? Math.max(0, Math.round((Date.now() - new Date(l.ultima_sync.replace(' ', 'T') + 'Z').getTime()) / 60000)) : null;
    const cuenta = await get('SELECT nombre FROM cuentas WHERE id = ?', [l.cuenta_id]);
    const carta = await get('SELECT 1 AS si FROM cartas WHERE local_id = ?', [l.id]);
    const trabados = await tienda.pedidosTrabados(l.id);
    return { id: l.id, nombre: l.nombre, cliente: l.cliente, cuenta: cuenta && cuenta.nombre, ultima_sync: l.ultima_sync,
      minutos_sin_sync: minutos, estado, carta_online: carta ? `/l/${encodeURIComponent(l.cliente)}` : null,
      alertas: alertas(l, estado, minutos, trabados) };
  }));
}

app.get('/api/panel/locales', autenticarUsuario, ruta(async (req, res) => {
  res.json(await estadoLocales(await localesVisibles(req.usuario)));
}));

// Soporte: todas las cuentas y locales, los más urgentes primero (caído > facturas rechazadas > el resto de las alertas)
const gravedad = l => (l.minutos_sin_sync === null || l.minutos_sin_sync > MIN_SIN_SYNC ? 100 : 0) +
  (l.estado.facturas_con_error ? 10 : 0) + l.alertas.length;
app.get('/api/soporte/locales', autenticarUsuario, ruta(async (req, res) => {
  if (req.usuario.rol !== 'soporte') throw errorHttp(403, 'Solo soporte');
  const lista = await estadoLocales(await all('SELECT * FROM locales ORDER BY nombre'));
  res.json(lista.sort((a, b) => gravedad(b) - gravedad(a)));
}));

// ============ ALTAS (las usa nube/alta.js) ============

async function altaLocal({ cuenta, nombre, cliente }) {
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(String(cliente || ''))) throw errorHttp(400, 'El cliente va en minúsculas y sin espacios (ej. la-buena-mesa)');
  let c = await get('SELECT id FROM cuentas WHERE nombre = ?', [cuenta]);
  if (!c) c = { id: (await run('INSERT INTO cuentas (nombre) VALUES (?)', [cuenta])).id };
  const token = 'mnl_' + crypto.randomBytes(24).toString('hex');
  const { id } = await run('INSERT INTO locales (cuenta_id, nombre, cliente, token_hash) VALUES (?, ?, ?, ?)', [c.id, nombre, cliente, hashToken(token)]);
  return { id, cuenta_id: c.id, token };
}

async function altaUsuario({ cuenta, nombre, email, password, rol = 'duenio' }) {
  if (!['duenio', 'soporte'].includes(rol)) throw errorHttp(400, 'Rol inválido');
  if (String(password || '').length < 8) throw errorHttp(400, 'La contraseña tiene que tener al menos 8 caracteres');
  const c = rol === 'soporte' ? null : await get('SELECT id FROM cuentas WHERE nombre = ?', [cuenta]);
  if (rol !== 'soporte' && !c) throw errorHttp(404, `No existe la cuenta "${cuenta}" (primero dar de alta un local)`);
  const { id } = await run('INSERT INTO usuarios (cuenta_id, nombre, email, password, rol) VALUES (?, ?, ?, ?, ?)',
    [c ? c.id : null, nombre, String(email).trim().toLowerCase(), bcrypt.hashSync(String(password), 10), rol]);
  return { id };
}

module.exports = { app, altaLocal, altaUsuario, hashToken };

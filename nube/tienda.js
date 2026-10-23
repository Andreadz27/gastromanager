'use strict';
// Morfi Nube, etapa 2: la carta online de cada local en una dirección fija (/l/<cliente>) y sus pedidos.
// El pedido queda acá y el local lo viene a buscar cada pocos segundos: no hace falta túnel ni abrir puertos,
// y el link del local no cambia aunque cambie la PC o la conexión.
// Si el local no viene a buscar (sin internet, PC apagada) no se toman pedidos: nadie los vería en la cocina.
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { run, get, all } = require('./db');
const { validarPedidoOnline } = require('../src/validar-pedido-online');

const PUBLICO = path.join(__dirname, '..', 'public');
const FONT_AWESOME = path.join(__dirname, '..', 'node_modules', '@fortawesome', 'fontawesome-free');
// La página es la misma del local (public/pedido.html): se sirven solo estos archivos
const ARCHIVOS = ['pedido.html', 'favicon.svg', 'css/styles.css', 'css/menu.css', 'css/pedido.css', 'js/pedido.js'];
const SEG_LOCAL_ACTIVO = 60;       // el local busca cada 10 s: un minuto sin venir = no está
const MIN_VENCE = 30;              // un pedido que el local no recibió en 30 min ya no sirve
const MAX_PENDIENTES = 100;
const segundosDesde = t => t ? (Date.now() - new Date(t.replace(' ', 'T') + 'Z').getTime()) / 1000 : Infinity;
const texto = (v, n) => String(v || '').slice(0, n);

module.exports = function registrarTienda(app, { ruta, errorHttp, autenticarLocal, r2 }) {

  // ============ LO QUE HACE EL LOCAL ============

  // La carta que se muestra online (la manda el local cuando cambia)
  app.post('/api/sync/carta', autenticarLocal, ruta(async (req, res) => {
    const { info = {}, categorias, productos } = req.body || {};
    if (!Array.isArray(categorias) || !Array.isArray(productos) || productos.length > 3000) throw errorHttp(400, 'Carta inválida');
    const carta = {
      info: { nombre: texto(info.nombre, 100), direccion: texto(info.direccion, 200), telefono: texto(info.telefono, 40), email: texto(info.email, 120) },
      categorias: categorias.slice(0, 300).map(c => ({ id: Number(c.id), nombre: texto(c.nombre, 80) })),
      productos: productos.map(p => ({
        id: Number(p.id), nombre: texto(p.nombre, 120), descripcion: texto(p.descripcion, 500), precio_venta: r2(p.precio_venta),
        categoria_id: Number(p.categoria_id) || null, tracking_stock: p.tracking_stock ? 1 : 0, stock_actual: Number(p.stock_actual) || 0,
        es_plato: p.es_plato ? 1 : 0
      }))
    };
    await run(`INSERT INTO cartas (local_id, datos) VALUES (?, ?)
      ON CONFLICT(local_id) DO UPDATE SET datos = excluded.datos, actualizado_en = CURRENT_TIMESTAMP`, [req.local.id, JSON.stringify(carta)]);
    const { cliente } = await get('SELECT cliente FROM locales WHERE id = ?', [req.local.id]);
    // El link fijo de la carta: el local lo usa en sus QR y links de WhatsApp e Instagram
    res.json({ ok: true, url: `${req.protocol}://${req.get('host')}/l/${encodeURIComponent(cliente)}` });
  }));

  // El local viene a buscar los pedidos nuevos (esto también dice que está conectado)
  app.get('/api/sync/pedidos', autenticarLocal, ruta(async (req, res) => {
    await run('UPDATE locales SET ultimo_pedido_poll = CURRENT_TIMESTAMP WHERE id = ?', [req.local.id]);
    await run(`UPDATE pedidos_online SET estado = 'vencido', datos = NULL
      WHERE estado = 'pendiente' AND creado_en < datetime('now', '-${MIN_VENCE} minutes')`);
    const lista = await all("SELECT id, datos FROM pedidos_online WHERE local_id = ? AND estado = 'pendiente' ORDER BY id LIMIT 50", [req.local.id]);
    res.json(lista.map(p => ({ id: p.id, ...JSON.parse(p.datos) })));
  }));

  // El local lo cargó (con su número y el total con sus precios): se borran los datos del cliente.
  // Se acepta aunque haya vencido por un instante: ya está en la cocina.
  app.post('/api/sync/pedidos/:id/recibido', autenticarLocal, ruta(async (req, res) => {
    const b = req.body || {};
    const { changes } = await run(`UPDATE pedidos_online SET estado = 'recibido', datos = NULL, numero = ?, total = ?, recibido_en = CURRENT_TIMESTAMP
      WHERE id = ? AND local_id = ? AND estado IN ('pendiente', 'vencido')`, [texto(b.numero, 40), r2(b.total), Number(req.params.id), req.local.id]);
    res.json({ ok: true, actualizado: changes > 0 });
  }));

  // El local no lo pudo cargar (ej. un producto ya no está): se le avisa al cliente
  app.post('/api/sync/pedidos/:id/rechazado', autenticarLocal, ruta(async (req, res) => {
    await run(`UPDATE pedidos_online SET estado = 'rechazado', datos = NULL, error = ?
      WHERE id = ? AND local_id = ? AND estado IN ('pendiente', 'vencido')`, [texto((req.body || {}).error, 200), Number(req.params.id), req.local.id]);
    res.json({ ok: true });
  }));

  // ============ LA CARTA PÚBLICA (sin login) ============

  app.use('/vendor/fontawesome/css', express.static(path.join(FONT_AWESOME, 'css'), { maxAge: '30d' }));
  app.use('/vendor/fontawesome/webfonts', express.static(path.join(FONT_AWESOME, 'webfonts'), { maxAge: '30d' }));

  const conLocal = fn => ruta(async (req, res) => {
    const l = await get('SELECT l.id, l.cliente, l.ultimo_pedido_poll, c.datos AS carta FROM locales l JOIN cartas c ON c.local_id = l.id WHERE l.cliente = ?',
      [String(req.params.cliente)]);
    if (!l) throw errorHttp(404, 'Este local no tiene carta online');
    await fn(req, res, l, JSON.parse(l.carta));
  });
  const recibe = l => segundosDesde(l.ultimo_pedido_poll) <= SEG_LOCAL_ACTIVO;
  const sinConexion = carta => 'El local no está recibiendo pedidos online en este momento.' +
    (carta.info.telefono ? ` Podés llamar al ${carta.info.telefono}.` : '');

  app.get('/l/:cliente/api/publico/menu', conLocal(async (req, res, l, carta) => {
    res.json({ categorias: carta.categorias, productos: carta.productos });
  }));

  app.get('/l/:cliente/api/publico/info', conLocal(async (req, res, l, carta) => {
    const base = `${req.protocol}://${req.get('host')}/l/${encodeURIComponent(l.cliente)}`;
    res.json({
      nombre: carta.info.nombre || 'Morfi', descripcion: carta.info.direccion ? `Dirección: ${carta.info.direccion}` : '',
      telefono: carta.info.telefono, email: carta.info.email,
      links: { carta: `${base}/pedido.html`, whatsapp: `${base}/pedido.html?origen=whatsapp`, instagram: `${base}/pedido.html?origen=instagram` },
      recibe_pedidos: recibe(l), aviso: recibe(l) ? '' : sinConexion(carta)
    });
  }));

  app.post('/l/:cliente/api/publico/pedido', rateLimit({ windowMs: 60000, max: 10 }), conLocal(async (req, res, l, carta) => {
    if (!recibe(l)) throw errorHttp(503, sinConexion(carta));
    const d = validarPedidoOnline(req.body);
    // Total estimado con la carta que mandó el local; el que vale es el que calcula el local con sus precios
    let total = 0;
    for (const it of d.items) {
      const p = carta.productos.find(x => x.id === it.producto_id);
      if (!p || !(p.precio_venta > 0)) throw errorHttp(400, 'Producto no disponible');
      total += p.precio_venta * it.cantidad;
    }
    const { n } = await get("SELECT COUNT(*) AS n FROM pedidos_online WHERE local_id = ? AND estado = 'pendiente'", [l.id]);
    if (n >= MAX_PENDIENTES) throw errorHttp(503, sinConexion(carta));
    const codigo = crypto.randomBytes(12).toString('hex');
    await run('INSERT INTO pedidos_online (local_id, codigo, datos, total) VALUES (?, ?, ?, ?)', [l.id, codigo, JSON.stringify(d), r2(total)]);
    res.status(201).json({ pendiente: true, codigo, total: r2(total) });
  }));

  // El cliente ve si el local ya lo recibió (y con qué número)
  app.get('/l/:cliente/api/publico/pedido/:codigo', conLocal(async (req, res, l, carta) => {
    const p = await get('SELECT estado, numero, total, error FROM pedidos_online WHERE codigo = ? AND local_id = ?', [String(req.params.codigo), l.id]);
    if (!p) throw errorHttp(404, 'Pedido no encontrado');
    const mensaje = p.estado === 'rechazado' ? `El local no pudo tomar el pedido: ${p.error || 'llamá al local'}`
      : p.estado === 'vencido' ? 'El local no recibió el pedido a tiempo.' + (carta.info.telefono ? ` Llamá al ${carta.info.telefono}.` : '')
        : '';
    res.json({ estado: p.estado, numero_pedido: p.numero, total: p.total, mensaje });
  }));

  app.get('/l/:cliente', (req, res) => {
    const q = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
    res.redirect(`/l/${encodeURIComponent(req.params.cliente)}/pedido.html${q}`);
  });
  app.get('/l/:cliente/*', (req, res) => {
    const archivo = req.params[0];
    if (!ARCHIVOS.includes(archivo)) return res.status(404).send('No encontrado');
    res.sendFile(path.join(PUBLICO, archivo), { maxAge: archivo === 'pedido.html' ? 0 : '1h' });
  });
};

// Para el panel: pedidos que el local no viene a buscar
module.exports.pedidosTrabados = localId => get(`SELECT COUNT(*) AS n FROM pedidos_online
  WHERE local_id = ? AND estado = 'pendiente' AND creado_en < datetime('now', '-2 minutes')`, [localId]).then(r => r.n);

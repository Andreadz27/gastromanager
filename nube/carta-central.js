'use strict';
// Morfi Nube, etapa 3: precios centrales para cadenas. El dueño ve cada producto con el precio de cada sucursal
// y lo cambia en todas (o en las que elija) desde el celular. El cambio queda en la nube y cada local lo aplica
// al buscar pedidos (cada 10 s); si un local está sin internet, lo aplica cuando vuelve.
// Los productos se reconocen por nombre entre sucursales (cada local tiene sus propios ids).
const { run, get, all, transaccion } = require('./db');

const clave = nombre => String(nombre || '').trim().toLowerCase().replace(/\s+/g, ' ');
const PRECIO_MAX = 100000000;

module.exports = function registrarCartaCentral(app, { ruta, errorHttp, autenticarLocal, autenticarUsuario, r2 }) {

  const soloDuenio = ruta(async (req, res, next) => {
    // Soporte no toca los precios de los clientes
    if (req.usuario.rol !== 'duenio') throw errorHttp(403, 'Solo el dueño de la cuenta cambia los precios');
    next();
  });

  async function cartasDeLaCuenta(cuentaId) {
    const filas = await all(`SELECT l.id, l.nombre, c.datos FROM locales l JOIN cartas c ON c.local_id = l.id
      WHERE l.cuenta_id = ? ORDER BY l.nombre`, [cuentaId]);
    return filas.map(f => ({ id: f.id, nombre: f.nombre, productos: JSON.parse(f.datos).productos }));
  }

  // Cada producto (por nombre) con su precio en cada sucursal y el cambio que esté en camino
  app.get('/api/panel/carta', autenticarUsuario, soloDuenio, ruta(async (req, res) => {
    const locales = await cartasDeLaCuenta(req.usuario.cuenta_id);
    const pendientes = await all(`SELECT local_id, producto_id, precio FROM cambios_precio
      WHERE estado = 'pendiente' AND local_id IN (SELECT id FROM locales WHERE cuenta_id = ?)`, [req.usuario.cuenta_id]);
    const productos = new Map();
    for (const l of locales) {
      for (const p of l.productos) {
        const k = clave(p.nombre);
        if (!productos.has(k)) productos.set(k, { producto: p.nombre, precios: [] });
        const pend = pendientes.find(x => x.local_id === l.id && x.producto_id === p.id);
        productos.get(k).precios.push({ local_id: l.id, local: l.nombre, producto_id: p.id, precio: p.precio_venta,
          precio_nuevo: pend ? pend.precio : null });
      }
    }
    const lista = [...productos.values()].sort((a, b) => a.producto.localeCompare(b.producto, 'es'));
    for (const p of lista) p.distinto = new Set(p.precios.map(x => x.precio)).size > 1;
    res.json({ locales: locales.map(l => ({ id: l.id, nombre: l.nombre })), productos: lista });
  }));

  // Nuevo precio para un producto en las sucursales elegidas (por defecto, en todas las que lo tienen)
  app.post('/api/panel/precios', autenticarUsuario, soloDuenio, ruta(async (req, res) => {
    const { producto, locales: elegidos } = req.body || {};
    const precio = r2(req.body && req.body.precio);
    if (!(precio > 0) || precio > PRECIO_MAX) throw errorHttp(400, 'Precio inválido');
    const k = clave(producto);
    const locales = await cartasDeLaCuenta(req.usuario.cuenta_id);
    const destino = [];
    for (const l of locales) {
      if (Array.isArray(elegidos) && !elegidos.map(Number).includes(l.id)) continue;
      const p = l.productos.find(x => clave(x.nombre) === k);
      if (p) destino.push({ local_id: l.id, producto_id: p.id, producto: p.nombre, precio_anterior: p.precio_venta });
    }
    if (!destino.length) throw errorHttp(404, 'Ninguna sucursal tiene ese producto');
    await transaccion(async () => {
      for (const d of destino) {
        // Si había otro cambio sin aplicar para ese producto, vale el último
        await run("UPDATE cambios_precio SET estado = 'reemplazado' WHERE local_id = ? AND producto_id = ? AND estado = 'pendiente'",
          [d.local_id, d.producto_id]);
        await run(`INSERT INTO cambios_precio (local_id, producto_id, producto, precio_anterior, precio, usuario_id)
          VALUES (?, ?, ?, ?, ?, ?)`, [d.local_id, d.producto_id, d.producto, d.precio_anterior, precio, req.usuario.id]);
      }
    });
    res.status(201).json({ ok: true, sucursales: destino.length });
  }));

  // ============ LO QUE HACE EL LOCAL ============

  app.get('/api/sync/cambios', autenticarLocal, ruta(async (req, res) => {
    const lista = await all(`SELECT c.id, c.producto_id, c.producto, c.precio, c.precio_anterior, u.nombre AS usuario
      FROM cambios_precio c LEFT JOIN usuarios u ON u.id = c.usuario_id
      WHERE c.local_id = ? AND c.estado = 'pendiente' ORDER BY c.id LIMIT 200`, [req.local.id]);
    res.json(lista);
  }));

  app.post('/api/sync/cambios/:id', autenticarLocal, ruta(async (req, res) => {
    const error = req.body && req.body.error ? String(req.body.error).slice(0, 200) : null;
    await run(`UPDATE cambios_precio SET estado = ?, error = ?, aplicado_en = CURRENT_TIMESTAMP
      WHERE id = ? AND local_id = ? AND estado = 'pendiente'`, [error ? 'error' : 'aplicado', error, Number(req.params.id), req.local.id]);
    res.json({ ok: true });
  }));
};

// Para el panel: cambios de precio que el local no pudo aplicar o que esperan hace rato
module.exports.cambiosTrabados = localId => get(`SELECT
    SUM(estado = 'error' AND aplicado_en > datetime('now', '-1 day')) AS con_error,
    SUM(estado = 'pendiente' AND creado_en < datetime('now', '-15 minutes')) AS demorados
  FROM cambios_precio WHERE local_id = ?`, [localId]).then(r => ({ con_error: r.con_error || 0, demorados: r.demorados || 0 }));

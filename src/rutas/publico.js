'use strict';
const {
  rateLimit, urlPublica, run, get, all, transaccion, errorHttp, errorInterno, emitEvento, generarNumeroPedido,
  comandaAutomatica, resolverItems, recalcularTotales, mesaPorToken, estadoMesa, solicitarPedidoMesa, llamarMozo,
  iniciarPagoMesa, verificarPagoMesa, pedirComprobanteMesa
} = require('../contexto');
const QRCode = require('qrcode');

module.exports = function registrarRutas(app) {

// Imagen QR de un texto (link de la carta, de pago de Mercado Pago...). Antes se pedía a api.qrserver.com:
// sin internet no salía ningún QR. Es pública porque la usa <img src> (sin token) y solo dibuja el texto.
app.get('/api/publico/qr.svg', async (req, res) => {
  try {
    const texto = String(req.query.d || '');
    if (!texto || texto.length > 1000) return res.status(400).json({ error: 'Texto inválido para el QR' });
    res.type('image/svg+xml').set('Cache-Control', 'public, max-age=86400')
      .send(await QRCode.toString(texto, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' }));
  } catch (err) { errorInterno(res, err); }
});

// ============ MENÚ PÚBLICO (carta QR - sin autenticación) ============

app.get('/api/publico/menu', async (req, res) => {
  try {
    const categorias = await all(`
      SELECT c.id, c.nombre FROM categorias c
      WHERE c.activo = 1 AND EXISTS (SELECT 1 FROM productos p WHERE p.categoria_id = c.id AND p.activo = 1)
      ORDER BY c.orden, c.nombre
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
    const config = await get('SELECT nombre_negocio, direccion, telefono, email FROM configuracion WHERE id = 1');
    // Sin BASE_URL no hay links: el navegador arma los suyos con la dirección por la que entró
    // (antes salían con localhost y el QR impreso en las mesas no abría en ningún celular)
    const base = urlPublica();
    res.json({
      nombre: config?.nombre_negocio || 'Morfi',
      descripcion: config?.direccion ? `Dirección: ${config.direccion}` : '',
      telefono: config?.telefono || '',
      email: config?.email || '',
      links: base ? {
        carta:     `${base}/menu.html`,
        whatsapp:  `${base}/pedido.html?origen=whatsapp`,
        instagram: `${base}/pedido.html?origen=instagram`
      } : {}
    });
  } catch (err) { errorInterno(res, err); }
});

const pedidoOnlineLimiter = rateLimit({ windowMs: 60000, max: 10 });
// Topes del pedido online (sin login): nadie pide 30 platos distintos ni 50 de uno por la web
const MAX_ITEMS_ONLINE = 30;
const MAX_CANTIDAD_ONLINE = 50;
app.post('/api/publico/pedido', pedidoOnlineLimiter, async (req, res) => {
  try {
    const { tipo, direccion, notas, origen, items } = req.body || {};
    const cliente = String((req.body && req.body.cliente) || '').trim().slice(0, 80);
    const telefono = String((req.body && req.body.telefono) || '').trim().slice(0, 30);
    if (!cliente || !telefono)
      return res.status(400).json({ error: 'Nombre y teléfono son obligatorios' });
    if (!Array.isArray(items) || !items.length)
      return res.status(400).json({ error: 'El pedido no tiene ítems' });
    if (items.length > MAX_ITEMS_ONLINE || items.some(i => !i || !(Number(i.cantidad) >= 1) || Number(i.cantidad) > MAX_CANTIDAD_ONLINE))
      return res.status(400).json({ error: `Para pedidos grandes llamá al local (máximo ${MAX_CANTIDAD_ONLINE} unidades por producto)` });
    const tipoFin  = tipo === 'delivery' ? 'delivery' : 'takeaway';
    const orig     = ['whatsapp','instagram','web'].includes(origen) ? origen : 'web';
    const { pid, numero, total } = await transaccion(async () => {
      // Precio y nombre salen de la base (nunca del navegador); por la web no se venden insumos sin precio
      const resueltos = await resolverItems(items.map(i => ({ ...i, cantidad: parseInt(i.cantidad, 10), notas: String(i.notas || '').slice(0, 200) })));
      if (resueltos.some(i => !(i.precio > 0))) throw errorHttp(400, 'Producto no disponible');
      const numero   = await generarNumeroPedido();
      const result   = await run(
        `INSERT INTO pedidos (numero_pedido,tipo,cliente,usuario_id,notas,descuento,propina,origen)
         VALUES (?,?,?,NULL,?,0,0,?)`,
        [numero, tipoFin, `${cliente} (${telefono})`, String(notas || '').slice(0, 500), orig]);
      const pid = result.id;
      for (const item of resueltos) {
        await run(
          `INSERT INTO pedido_items
           (pedido_id,producto_id,nombre_producto,cantidad,precio_unitario,subtotal,notas)
           VALUES (?,?,?,?,?,?,?)`,
          [pid, item.producto_id, item.nombre, item.cantidad, item.precio, item.subtotal, item.notas]);
      }
      const { total } = await recalcularTotales(pid);
      // La entrega guarda el teléfono: con eso sale el aviso de WhatsApp "listo" o "en camino"
      if (tipoFin === 'takeaway' || direccion) {
        await run(
          `INSERT INTO entregas (pedido_id,tipo,direccion,telefono,costo_envio,estado,plataforma,codigo_externo)
           VALUES (?,?,?,?,0,'pendiente',?,'') `,
          [pid, tipoFin, String(direccion || '').slice(0, 200), telefono, orig]);
      }
      emitEvento('pedido:nuevo',{id:pid,numero_pedido:numero,tipo:tipoFin,origen:orig,cliente});
      emitEvento('cocina:actualizar',{pedido_id:pid,accion:'creado'});
      emitEvento('dashboard:actualizar',{motivo:'pedido_creado'});
      emitEvento('delivery:actualizar',{pedido_id:pid,accion:'creado'});
      return { pid, numero, total };
    });
    await comandaAutomatica(pid).catch(() => false);
    const label = {whatsapp:'WhatsApp',instagram:'Instagram',web:'Web'}[orig]||orig;
    res.status(201).json({id:pid,numero_pedido:numero,subtotal:total,total,origen:label});
  } catch (err) { errorInterno(res, err); }
});

// ============ PEDIDO DESDE LA MESA (QR de cada mesa, sin login) ============
// En el local todos los celulares salen por la misma IP (el WiFi): el límite por IP es amplio
// y el tope real es por mesa (pedidos sin confirmar, en el servicio)
const mesaLimiter = rateLimit({ windowMs: 60000, max: 60 });
const conMesa = fn => async (req, res) => {
  try {
    const mesa = await mesaPorToken(req.params.token);
    if (!mesa) return res.status(404).json({ error: 'Este QR no corresponde a ninguna mesa. Pedile ayuda al mozo.' });
    await fn(req, res, mesa);
  } catch (err) { errorInterno(res, err); }
};

app.get('/api/publico/mesa/:token', mesaLimiter, conMesa(async (req, res, mesa) => {
  res.json(await estadoMesa(mesa));
}));

app.post('/api/publico/mesa/:token/pedido', mesaLimiter, conMesa(async (req, res, mesa) => {
  const { items, notas, cliente } = req.body || {};
  res.status(201).json(await solicitarPedidoMesa(mesa, { items, notas, cliente }));
}));

app.post('/api/publico/mesa/:token/llamar', mesaLimiter, conMesa(async (req, res, mesa) => {
  const { tipo, forma } = req.body || {};
  res.status(201).json(await llamarMozo(mesa, tipo, forma));
}));

// Pagar desde la mesa con Mercado Pago: toda la cuenta o una parte, con propina
app.post('/api/publico/mesa/:token/pagar', mesaLimiter, conMesa(async (req, res, mesa) => {
  const { partes, propina } = req.body || {};
  res.status(201).json(await iniciarPagoMesa(mesa, req.params.token, { partes, propina }));
}));

// Al volver de Mercado Pago (payment_id viene en la URL de vuelta): se consulta y se acredita
app.post('/api/publico/mesa/:token/pago/:id/verificar', mesaLimiter, conMesa(async (req, res, mesa) => {
  res.json(await verificarPagoMesa(mesa, Number(req.params.id), req.body && req.body.payment_id));
}));

app.post('/api/publico/mesa/:token/pago/:id/comprobante', mesaLimiter, conMesa(async (req, res, mesa) => {
  res.json(await pedirComprobanteMesa(mesa, Number(req.params.id), req.body && req.body.telefono));
}));

};

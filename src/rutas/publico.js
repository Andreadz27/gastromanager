'use strict';
const {
  rateLimit, PORT, run, get, all, transaccion, errorHttp, errorInterno, emitEvento, generarNumeroPedido,
  comandaAutomatica
} = require('../contexto');

module.exports = function registrarRutas(app) {

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
    await comandaAutomatica(pid).catch(() => false);
    const label = {whatsapp:'WhatsApp',instagram:'Instagram',web:'Web'}[orig]||orig;
    res.status(201).json({id:pid,numero_pedido:numero,subtotal:sub,total:sub,origen:label});
  } catch (err) { errorInterno(res, err); }
});

};

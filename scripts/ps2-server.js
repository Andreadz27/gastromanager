'use strict';
// ps2-server.js — agrega endpoint público POST /api/publico/pedido
// y mejora GET /api/publico/info con links para compartir
const fs = require('fs'), path = require('path');
const f = path.join(__dirname, '..', 'server.js');
let s = fs.readFileSync(f, 'utf8');
const E = s.includes('\r\n') ? '\r\n' : '\n';
if (s.includes('/api/publico/pedido')) { console.log('SKIP server.js'); process.exit(0); }

const V = `app.get('/api/publico/info', async (req, res) => {
  try {
    const config = await get('SELECT nombre_negocio, direccion, telefono FROM configuracion WHERE id = 1');
    res.json({
      nombre: config?.nombre_negocio || 'GastroManager',
      descripcion: config?.direccion ? \`Direcci\\u00f3n: \${config.direccion}\` : '',
      telefono: config?.telefono || ''
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});`;

const N = `app.get('/api/publico/info', async (req, res) => {
  try {
    const config = await get('SELECT nombre_negocio, direccion, telefono FROM configuracion WHERE id = 1');
    const base = (process.env.BASE_URL || \`http://localhost:\${PORT}\`).replace(/\\/$/,'');
    res.json({
      nombre: config?.nombre_negocio || 'GastroManager',
      descripcion: config?.direccion ? \`Dirección: \${config.direccion}\` : '',
      telefono: config?.telefono || '',
      links: {
        carta:     \`\${base}/menu.html\`,
        whatsapp:  \`\${base}/pedido.html?origen=whatsapp\`,
        instagram: \`\${base}/pedido.html?origen=instagram\`
      }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const pedidoOnlineLimiter = rateLimit({ windowMs: 60000, max: 10 });
app.post('/api/publico/pedido', pedidoOnlineLimiter, async (req, res) => {
  try {
    const { cliente, telefono, tipo, direccion, notas, origen, items } = req.body;
    if (!cliente || !telefono)
      return res.status(400).json({ error: 'Nombre y teléfono son obligatorios' });
    if (!Array.isArray(items) || !items.length)
      return res.status(400).json({ error: 'El pedido no tiene items' });
    for (const item of items) {
      const prod = await get(
        'SELECT id, nombre, precio_venta FROM productos WHERE id = ? AND activo = 1',
        [item.producto_id]);
      if (!prod) return res.status(400).json({ error: \`Producto no disponible\` });
      item.precio = prod.precio_venta;
      item.nombre = prod.nombre;
    }
    const numero   = generarNumeroPedido();
    const tipoFin  = tipo === 'delivery' ? 'delivery' : 'takeaway';
    const orig     = ['whatsapp','instagram','web'].includes(origen) ? origen : 'web';
    const result   = await run(
      \`INSERT INTO pedidos (numero_pedido,tipo,cliente,usuario_id,notas,descuento,propina,origen)
       VALUES (?,?,?,NULL,?,0,0,?)\`,
      [numero, tipoFin, \`\${cliente} (\${telefono})\`, notas||'', orig]);
    const pid = result.id;
    for (const item of items) {
      const cant  = Math.max(1, parseInt(item.cantidad)||1);
      const price = parseFloat(item.precio)||0;
      await run(
        \`INSERT INTO pedido_items
         (pedido_id,producto_id,nombre_producto,cantidad,precio_unitario,subtotal,notas)
         VALUES (?,?,?,?,?,?,?)\`,
        [pid, item.producto_id, item.nombre, cant, price, cant*price, item.notas||'']);
    }
    const rows = await all('SELECT subtotal FROM pedido_items WHERE pedido_id=?',[pid]);
    const sub  = rows.reduce((a,r)=>a+r.subtotal,0);
    await run('UPDATE pedidos SET subtotal=?,total=? WHERE id=?',[sub,sub,pid]);
    if (tipoFin==='delivery' && direccion) {
      await run(
        \`INSERT INTO entregas (pedido_id,tipo,direccion,telefono,costo_envio,estado,plataforma,codigo_externo)
         VALUES (?,'delivery',?,?,0,'pendiente',?,'') \`,
        [pid, direccion, telefono, orig]);
    }
    emitEvento('pedido:nuevo',{id:pid,numero_pedido:numero,tipo:tipoFin,origen:orig,cliente});
    emitEvento('cocina:actualizar',{pedido_id:pid,accion:'creado'});
    emitEvento('dashboard:actualizar',{motivo:'pedido_creado'});
    if (tipoFin==='delivery') emitEvento('delivery:actualizar',{pedido_id:pid,accion:'creado'});
    const label = {whatsapp:'WhatsApp',instagram:'Instagram',web:'Web'}[orig]||orig;
    res.status(201).json({id:pid,numero_pedido:numero,subtotal:sub,total:sub,origen:label});
  } catch (err) { res.status(500).json({ error: err.message }); }
});`;

const sN = s.replace(/\r\n/g,'\n');
const vN = V.replace(/\r\n/g,'\n');
if (!sN.includes(vN)) { console.error('PATRON NO ENCONTRADO server.js'); process.exit(1); }
fs.writeFileSync(f, sN.replace(vN, N.replace(/\r\n/g,'\n')).replace(/\n/g,E), 'utf8');
console.log('OK server.js');

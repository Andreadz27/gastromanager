'use strict';
const {
  path, Afip, run, get, all, transaccion, LOCAL, errorInterno, autenticar, esAdmin, emitEvento, generarNumeroPedido, importe, registrarPago, getIntCfg, setIntCfg, urlPublica, mpRequest, esperar, tnRequest, PAUSA_TN_MS, comandaAutomatica, requiere
} = require('../contexto');

module.exports = function registrarRutas(app) {

// ============ INTEGRACIONES ============

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
      try {
        await mpRequest(cfg, 'GET', '/v1/payment_methods');
        return res.json({ ok: true, message: 'Conexión con Mercado Pago exitosa.' });
      } catch (e) {
        return res.json({ ok: false, message: `${e.message}. Revisá que el token sea válido.` });
      }
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
      try {
        await tnRequest(cfg, 'GET', '/products?per_page=1');
        return res.json({ ok: true, message: 'Conexión con Tienda Nube exitosa.' });
      } catch (e) {
        return res.json({ ok: false, message: `${e.message}. Revisá el ID de tienda y el token.` });
      }
    }
    res.json({ ok: false, message: 'Tipo de integración desconocido.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/integraciones/afip/comprobantes
app.get('/api/integraciones/afip/comprobantes', autenticar, requiere('pedidos.cobrar'), async (req, res) => {
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
app.post('/api/integraciones/afip/facturar', autenticar, requiere('pedidos.cobrar'), async (req, res) => {
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
app.post('/api/integraciones/tiendanube/sync-productos', autenticar, esAdmin, async (req, res) => {
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
            await esperar(PAUSA_TN_MS);
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
      await esperar(PAUSA_TN_MS);
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
app.post('/api/integraciones/mercadopago/link/:pedidoId', autenticar, requiere('pedidos.cobrar'), async (req, res) => {
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
    const pedidoNuevo = await transaccion(async () => {
      // Dentro de la transacción: dos reintentos simultáneos no duplican el pedido
      const existente = await get(
        "SELECT pedido_id FROM entregas WHERE codigo_externo = ? AND plataforma = 'Tienda Nube'", [codigoExterno]);
      if (existente) return null;

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
      return pedidoId;
    });
    if (pedidoNuevo) await comandaAutomatica(pedidoNuevo).catch(() => false);
    res.sendStatus(200);
  } catch (e) {
    console.error('[Tienda Nube webhook]', e.message);
    res.sendStatus(500); // Tienda Nube reintenta el webhook
  }
});

};

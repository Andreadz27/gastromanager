'use strict';
const {
  crypto, PORT, run, get, all, transaccion, LOCAL, fechaLocal, slugificar, parseCfgPlataforma, errorInterno, autenticar, esAdmin, emitEvento, generarNumeroPedido, urlPublica, comandaAutomatica, requiere
} = require('../contexto');

module.exports = function registrarRutas(app) {

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
app.get('/api/delivery/pedidos', autenticar, requiere('delivery'), async (req, res) => {
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
app.put('/api/delivery/pedidos/:id/estado', autenticar, requiere('delivery'), async (req, res) => {
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
app.get('/api/delivery/resumen', autenticar, requiere('delivery'), async (req, res) => {
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
    await comandaAutomatica(pedidoId).catch(() => false);
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

};

'use strict';
const {
  run, get, all, transaccion, LOCAL, errorHttp, errorInterno, autenticar, emitEvento, generarNumeroPedido, resolverItems, importe, recalcularTotales, registrarPago, METODOS_PAGO
} = require('../contexto');

module.exports = function registrarRutas(app) {

// ============ PEDIDOS ============

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

};

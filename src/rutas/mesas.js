'use strict';
const {
  run, get, all, actualizarParcial, errorInterno, autenticar, emitEvento, requiere, urlPublica, nuevoTokenMesa,
  solicitudesPendientes, confirmarSolicitud, rechazarSolicitud, atenderSolicitud
} = require('../contexto');
const QRCode = require('qrcode');

module.exports = function registrarRutas(app) {

// ============ MESAS ============

app.get('/api/mesas', autenticar, requiere('pedidos.ver'), async (req, res) => {
  try {
    // Con lo que piden desde el QR sin resolver, para marcar la mesa
    const mesas = await all(`SELECT m.id, m.nombre, m.capacidad, m.estado, m.sector, m.orden,
        (SELECT COUNT(*) FROM solicitudes_mesa s WHERE s.mesa_id = m.id AND s.estado = 'pendiente') AS solicitudes_pendientes
      FROM mesas m ORDER BY m.sector, m.orden`);
    res.json(mesas);
  } catch (err) {
    errorInterno(res, err);
  }
});

app.post('/api/mesas', autenticar, requiere('catalogo'), async (req, res) => {
  try {
    const { nombre, capacidad, sector, orden } = req.body;
    const result = await run(
      'INSERT INTO mesas (nombre, capacidad, sector, orden, qr_token) VALUES (?, ?, ?, ?, ?)',
      [nombre, capacidad || 4, sector || 'Principal', orden || 0, nuevoTokenMesa()]
    );
    res.status(201).json({ id: result.id, message: 'Mesa creada' });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.put('/api/mesas/:id', autenticar, requiere('catalogo'), async (req, res) => {
  try {
    await actualizarParcial('mesas', req.params.id, req.body || {}, ['nombre', 'capacidad', 'sector', 'orden', 'estado']);
    res.json({ message: 'Mesa actualizada' });
  } catch (err) {
    errorInterno(res, err);
  }
});

// Cambiar solo el estado de una mesa (ej. el mozo sienta a un cliente con reserva).
// Lo puede hacer cualquier usuario; editar nombre, capacidad o sector sigue siendo solo del admin.
const ESTADOS_MESA = ['libre', 'ocupada', 'reservada'];
const pedidoAbiertoEnMesa = mesaId =>
  get("SELECT id, numero_pedido FROM pedidos WHERE mesa_id = ? AND estado = 'abierto' LIMIT 1", [mesaId]);

app.put('/api/mesas/:id/estado', autenticar, requiere('pedidos.tomar'), async (req, res) => {
  try {
    const estado = req.body && req.body.estado;
    if (!ESTADOS_MESA.includes(estado)) return res.status(400).json({ error: 'Estado de mesa inválido' });
    // Una mesa con pedido abierto se libera al cobrar o cancelar el pedido, no a mano
    const abierto = estado !== 'ocupada' && await pedidoAbiertoEnMesa(req.params.id);
    if (abierto) return res.status(409).json({ error: `La mesa tiene el pedido ${abierto.numero_pedido} abierto: cobralo o cancelalo primero` });
    await actualizarParcial('mesas', req.params.id, { estado }, ['estado']);
    emitEvento('mesas:actualizar', { mesa_id: Number(req.params.id), estado });
    res.json({ message: 'Estado de la mesa actualizado' });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.delete('/api/mesas/:id', autenticar, requiere('catalogo'), async (req, res) => {
  try {
    await run('DELETE FROM mesas WHERE id = ?', [req.params.id]);
    res.json({ message: 'Mesa eliminada' });
  } catch (err) {
    errorInterno(res, err);
  }
});

// ============ QR DE CADA MESA ============

// Dirección del QR: la pública (BASE_URL) o, si no hay, la que usa el navegador del administrador
function baseQr(req) {
  const publica = urlPublica();
  if (publica) return publica;
  const b = String(req.query.base || '');
  return /^https?:\/\/[^\s/?#]+$/.test(b) ? b : '';
}

app.get('/api/mesas/qr', autenticar, requiere('catalogo'), async (req, res) => {
  try {
    const base = baseQr(req);
    if (!base) return res.status(400).json({ error: 'Falta la dirección del sistema para armar los QR' });
    // Mesas creadas antes por otra vía (sin clave): se les asigna ahora
    for (const m of await all('SELECT id FROM mesas WHERE qr_token IS NULL'))
      await run('UPDATE mesas SET qr_token = ? WHERE id = ?', [nuevoTokenMesa(), m.id]);
    const mesas = await all('SELECT id, nombre, sector, qr_token FROM mesas ORDER BY sector, orden');
    res.json(await Promise.all(mesas.map(async m => {
      const url = `${base}/pedido.html?mesa=${m.qr_token}`;
      return { id: m.id, nombre: m.nombre, sector: m.sector, url,
        svg: await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) };
    })));
  } catch (err) { errorInterno(res, err); }
});

// QR nuevo para una mesa (el anterior deja de funcionar: por si alguien se llevó una foto del QR)
app.post('/api/mesas/:id/qr', autenticar, requiere('catalogo'), async (req, res) => {
  try {
    const r = await run('UPDATE mesas SET qr_token = ? WHERE id = ?', [nuevoTokenMesa(), req.params.id]);
    if (!r.changes) return res.status(404).json({ error: 'Mesa no encontrada' });
    res.json({ ok: true });
  } catch (err) { errorInterno(res, err); }
});

// ============ PEDIDOS Y LLAMADOS DESDE LA MESA ============

app.get('/api/mesas/solicitudes', autenticar, requiere('pedidos.tomar'), async (req, res) => {
  try { res.json(await solicitudesPendientes()); } catch (err) { errorInterno(res, err); }
});

app.post('/api/mesas/solicitudes/:id/confirmar', autenticar, requiere('pedidos.tomar'), async (req, res) => {
  try {
    const items = req.body && Array.isArray(req.body.items) ? req.body.items : null;
    res.json(await confirmarSolicitud(Number(req.params.id), req.usuario.id, items));
  } catch (err) { errorInterno(res, err); }
});

app.post('/api/mesas/solicitudes/:id/rechazar', autenticar, requiere('pedidos.tomar'), async (req, res) => {
  try { res.json(await rechazarSolicitud(Number(req.params.id), req.usuario.id, req.body && req.body.motivo)); } catch (err) { errorInterno(res, err); }
});

app.post('/api/mesas/solicitudes/:id/atender', autenticar, requiere('pedidos.tomar'), async (req, res) => {
  try { res.json(await atenderSolicitud(Number(req.params.id), req.usuario.id)); } catch (err) { errorInterno(res, err); }
});

// ============ RESERVAS DE MESAS ============

app.get('/api/reservas', autenticar, requiere('pedidos.ver'), async (req, res) => {
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

app.post('/api/reservas', autenticar, requiere('pedidos.tomar'), async (req, res) => {
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

app.put('/api/reservas/:id', autenticar, requiere('pedidos.tomar'), async (req, res) => {
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
        // Si la mesa ya está ocupada con un pedido, cancelar la reserva no la libera
        if (!(await pedidoAbiertoEnMesa(reservaActual.mesa_id)))
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

app.delete('/api/reservas/:id', autenticar, requiere('pedidos.tomar'), async (req, res) => {
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

};

'use strict';
const {
  run, get, all, actualizarParcial, errorInterno, autenticar, esAdmin, emitEvento
} = require('../contexto');

module.exports = function registrarRutas(app) {

// ============ MESAS ============

app.get('/api/mesas', autenticar, async (req, res) => {
  try {
    const mesas = await all('SELECT * FROM mesas ORDER BY sector, orden');
    res.json(mesas);
  } catch (err) {
    errorInterno(res, err);
  }
});

app.post('/api/mesas', autenticar, esAdmin, async (req, res) => {
  try {
    const { nombre, capacidad, sector, orden } = req.body;
    const result = await run(
      'INSERT INTO mesas (nombre, capacidad, sector, orden) VALUES (?, ?, ?, ?)',
      [nombre, capacidad || 4, sector || 'Principal', orden || 0]
    );
    res.status(201).json({ id: result.id, message: 'Mesa creada' });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.put('/api/mesas/:id', autenticar, esAdmin, async (req, res) => {
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
app.put('/api/mesas/:id/estado', autenticar, async (req, res) => {
  try {
    const estado = req.body && req.body.estado;
    if (!ESTADOS_MESA.includes(estado)) return res.status(400).json({ error: 'Estado de mesa inválido' });
    await actualizarParcial('mesas', req.params.id, { estado }, ['estado']);
    emitEvento('mesas:actualizar', { mesa_id: Number(req.params.id), estado });
    res.json({ message: 'Estado de la mesa actualizado' });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.delete('/api/mesas/:id', autenticar, esAdmin, async (req, res) => {
  try {
    await run('DELETE FROM mesas WHERE id = ?', [req.params.id]);
    res.json({ message: 'Mesa eliminada' });
  } catch (err) {
    errorInterno(res, err);
  }
});

// ============ RESERVAS DE MESAS ============

app.get('/api/reservas', autenticar, async (req, res) => {
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

app.post('/api/reservas', autenticar, async (req, res) => {
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

app.put('/api/reservas/:id', autenticar, async (req, res) => {
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

app.delete('/api/reservas/:id', autenticar, async (req, res) => {
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

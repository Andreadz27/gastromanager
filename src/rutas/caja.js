'use strict';
const {
  run, get, all, transaccion, errorHttp, errorInterno, autenticar, importe, requiere
} = require('../contexto');

module.exports = function registrarRutas(app) {

// ============ CAJA ============

app.post('/api/caja/abrir', autenticar, requiere('caja.operar'), async (req, res) => {
  try {
    const { monto_inicial, observaciones } = req.body;
    // En una transacción: dos aperturas simultáneas no pueden crear dos cajas abiertas
    const id = await transaccion(async () => {
      const cajaAbierta = await get("SELECT id FROM caja WHERE estado = 'abierta'");
      if (cajaAbierta) throw errorHttp(400, 'Ya hay una caja abierta');
      const result = await run(
        `INSERT INTO caja (monto_inicial, usuario_id, observaciones) VALUES (?, ?, ?)`,
        [importe(monto_inicial), req.usuario.id, observaciones || '']
      );
      return result.id;
    });
    res.status(201).json({ id, message: 'Caja abierta' });
  } catch (err) {
    errorInterno(res, err);
  }
});

const redondear = n => Math.round((Number(n) || 0) * 100) / 100;

// Arqueo: cobros del turno por medio de pago, ingresos/egresos de efectivo y
// efectivo esperado = inicial + ventas en efectivo + ingresos − egresos
async function resumenCaja(caja) {
  const hasta = caja.fecha_cierre || '9999-12-31';
  const porMetodo = await all(`
    SELECT metodo, COALESCE(SUM(monto), 0) AS total, COUNT(*) AS cantidad
    FROM pagos WHERE fecha >= ? AND fecha <= ?
    GROUP BY metodo ORDER BY total DESC`, [caja.fecha_apertura, hasta]);
  const movimientos = await all(`
    SELECT m.id, m.tipo, m.concepto, m.monto, m.fecha, u.nombre AS usuario_nombre
    FROM movimientos_caja m LEFT JOIN usuarios u ON u.id = m.usuario_id
    WHERE m.caja_id = ? ORDER BY m.fecha`, [caja.id]);
  const suma = tipo => redondear(movimientos.filter(m => m.tipo === tipo).reduce((s, m) => s + m.monto, 0));
  const ventasEfectivo = redondear((porMetodo.find(m => m.metodo === 'efectivo') || {}).total);
  const ingresos = suma('ingreso'), egresos = suma('egreso');
  return {
    monto_inicial: redondear(caja.monto_inicial),
    por_metodo: porMetodo.map(m => ({ ...m, total: redondear(m.total) })),
    total_ventas: redondear(porMetodo.reduce((s, m) => s + m.total, 0)),
    cobros: porMetodo.reduce((s, m) => s + m.cantidad, 0),
    ventas_efectivo: ventasEfectivo,
    ingresos, egresos, movimientos,
    efectivo_esperado: redondear(caja.monto_inicial + ventasEfectivo + ingresos - egresos)
  };
}

// Ingreso o egreso de efectivo en la caja abierta (cambio, retiro, pago a proveedor...)
app.post('/api/caja/movimiento', autenticar, requiere('caja.operar'), async (req, res) => {
  try {
    const { tipo } = req.body || {};
    const monto = Number(req.body && req.body.monto);
    const concepto = String((req.body && req.body.concepto) || '').trim();
    if (!['ingreso', 'egreso'].includes(tipo)) return res.status(400).json({ error: 'Tipo de movimiento inválido' });
    if (!Number.isFinite(monto) || monto <= 0) return res.status(400).json({ error: 'El monto debe ser mayor a cero' });
    if (!concepto) return res.status(400).json({ error: 'Indicá el concepto del movimiento' });
    const id = await transaccion(async () => {
      const caja = await get("SELECT id FROM caja WHERE estado = 'abierta'");
      if (!caja) throw errorHttp(400, 'No hay caja abierta');
      const r = await run('INSERT INTO movimientos_caja (caja_id, tipo, concepto, monto, usuario_id) VALUES (?, ?, ?, ?, ?)',
        [caja.id, tipo, concepto, redondear(monto), req.usuario.id]);
      await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, ?, ?)',
        [req.usuario.id, `caja_${tipo}`, `${tipo === 'ingreso' ? 'Ingreso' : 'Egreso'} de caja: ${concepto} (${redondear(monto)})`]);
      return r.id;
    });
    res.status(201).json({ id, message: 'Movimiento registrado' });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.post('/api/caja/cerrar', autenticar, requiere('caja.operar'), async (req, res) => {
  try {
    const contado = Number(req.body && req.body.monto_final_real);
    if (!Number.isFinite(contado) || contado < 0)
      return res.status(400).json({ error: 'Ingresá el efectivo contado en caja' });
    const resultado = await transaccion(async () => {
      const caja = await get("SELECT * FROM caja WHERE estado = 'abierta'");
      if (!caja) throw errorHttp(400, 'No hay caja abierta');
      const resumen = await resumenCaja(caja);
      const diferencia = redondear(contado - resumen.efectivo_esperado);
      await run(`UPDATE caja SET estado = 'cerrada', fecha_cierre = CURRENT_TIMESTAMP, monto_final_real = ?,
                   monto_esperado = ?, diferencia = ?, resumen = ?, observaciones_cierre = ? WHERE id = ?`,
        [redondear(contado), resumen.efectivo_esperado, diferencia, JSON.stringify(resumen),
         String((req.body && req.body.observaciones) || ''), caja.id]);
      await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, ?, ?)',
        [req.usuario.id, 'cerrar_caja', `Caja #${caja.id} cerrada. Esperado ${resumen.efectivo_esperado}, contado ${redondear(contado)}, diferencia ${diferencia}`]);
      return { resumen, diferencia };
    });
    res.json({
      message: 'Caja cerrada',
      total_ventas: resultado.resumen.total_ventas,
      efectivo_esperado: resultado.resumen.efectivo_esperado,
      efectivo_contado: redondear(contado),
      diferencia: resultado.diferencia,
      resumen: resultado.resumen
    });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.get('/api/caja/estado', autenticar, requiere('caja.operar'), async (req, res) => {
  try {
    const caja = await get(`SELECT c.*, u.nombre as usuario_nombre FROM caja c LEFT JOIN usuarios u ON c.usuario_id = u.id WHERE c.estado = 'abierta'`);
    if (!caja) return res.json(null);
    res.json({ ...caja, resumen: await resumenCaja(caja) });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.get('/api/caja/historial', autenticar, requiere('caja.historial'), async (req, res) => {
  try {
    const cajas = await all(`
      SELECT c.id, c.fecha_apertura, c.fecha_cierre, c.monto_inicial, c.monto_final_real, c.estado,
        c.monto_esperado, c.diferencia, c.observaciones, c.observaciones_cierre, u.nombre as usuario_nombre,
        (SELECT COALESCE(SUM(pg.monto), 0) FROM pagos pg
          WHERE pg.fecha >= c.fecha_apertura AND pg.fecha <= COALESCE(c.fecha_cierre, '9999-12-31')) as ventas
      FROM caja c
      LEFT JOIN usuarios u ON c.usuario_id = u.id
      ORDER BY c.fecha_apertura DESC
      LIMIT 200
    `);
    res.json(cajas);
  } catch (err) {
    errorInterno(res, err);
  }
});

// Detalle del arqueo de una caja (cerrada: el guardado al cerrar; abierta: en vivo)
app.get('/api/caja/:id/arqueo', autenticar, requiere('caja.historial'), async (req, res) => {
  try {
    const caja = await get(`SELECT c.*, u.nombre as usuario_nombre FROM caja c LEFT JOIN usuarios u ON c.usuario_id = u.id WHERE c.id = ?`, [req.params.id]);
    if (!caja) return res.status(404).json({ error: 'Caja no encontrada' });
    let resumen = null;
    try { resumen = caja.resumen ? JSON.parse(caja.resumen) : null; } catch (e) {}
    res.json({ ...caja, resumen: resumen || await resumenCaja(caja) });
  } catch (err) {
    errorInterno(res, err);
  }
});

};

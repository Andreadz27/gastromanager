'use strict';
const {
  run, get, all, transaccion, LOCAL, fechaLocal, errorHttp, errorInterno, autenticar, requiere, tienePermiso
} = require('../contexto');

module.exports = function registrarRutas(app) {

// ============ CONTABILIDAD ============
// Gastos y compras con su comprobante, cuentas a pagar, IVA del mes, estado de resultados
// y libro diario. Las ventas salen de los cobros registrados: no se cargan dos veces.
// El libro diario no se guarda: se arma en cada consulta a partir de cobros, gastos y
// movimientos de caja, así nunca queda desfasado si se corrige o anula un gasto.

const CATEGORIAS = [
  { id: 'mercaderia', nombre: 'Mercadería e insumos', codigo: '5.1.01' },
  { id: 'sueldos', nombre: 'Sueldos y cargas sociales', codigo: '5.2.01' },
  { id: 'alquiler', nombre: 'Alquiler', codigo: '5.2.02' },
  { id: 'servicios', nombre: 'Servicios (luz, gas, agua, internet)', codigo: '5.2.03' },
  { id: 'impuestos', nombre: 'Impuestos y tasas', codigo: '5.2.04' },
  { id: 'comisiones', nombre: 'Comisiones (apps, tarjetas, Mercado Pago)', codigo: '5.2.05' },
  { id: 'mantenimiento', nombre: 'Mantenimiento y reparaciones', codigo: '5.2.06' },
  { id: 'marketing', nombre: 'Publicidad y marketing', codigo: '5.2.07' },
  { id: 'otros', nombre: 'Otros gastos', codigo: '5.2.08' }
];
const CATEGORIA = Object.fromEntries(CATEGORIAS.map(c => [c.id, c]));

const COMPROBANTES = {
  factura_a: 'Factura A', factura_b: 'Factura B', factura_c: 'Factura C',
  ticket: 'Ticket', recibo: 'Recibo', sin_comprobante: 'Sin comprobante'
};
const METODOS_GASTO = {
  efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta', mercadopago: 'Mercado Pago', cheque: 'Cheque', otro: 'Otro'
};

// Plan de cuentas (las cuentas de gastos salen de CATEGORIAS)
const CUENTAS = {
  caja: { codigo: '1.1.01', nombre: 'Caja' },
  bancos: { codigo: '1.1.02', nombre: 'Bancos y tarjetas' },
  mp: { codigo: '1.1.03', nombre: 'Mercado Pago' },
  otros_medios: { codigo: '1.1.04', nombre: 'Otros medios de cobro' },
  iva_cf: { codigo: '1.1.05', nombre: 'IVA crédito fiscal' },
  proveedores: { codigo: '2.1.01', nombre: 'Proveedores' },
  iva_df: { codigo: '2.1.02', nombre: 'IVA débito fiscal' },
  ajustes: { codigo: '3.1.01', nombre: 'Aportes y ajustes de caja' },
  ventas: { codigo: '4.1.01', nombre: 'Ventas' },
  ...Object.fromEntries(CATEGORIAS.map(c => [c.id, { codigo: c.codigo, nombre: c.nombre }])),
  caja_menores: { codigo: '5.2.09', nombre: 'Gastos menores de caja' }
};
const CUENTA_DE_MEDIO = {
  efectivo: 'caja', tarjeta: 'bancos', transferencia: 'bancos', cheque: 'bancos', mercadopago: 'mp'
};
const cuentaDeMedio = metodo => CUENTA_DE_MEDIO[metodo] || 'otros_medios';

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const esFecha = s => FECHA.test(String(s || '')) && !isNaN(new Date(s + 'T00:00:00Z'));

// Período pedido (por defecto, el mes en curso hasta hoy)
function periodo(query) {
  const hoy = fechaLocal();
  const desde = query.desde || hoy.slice(0, 8) + '01';
  const hasta = query.hasta || hoy;
  if (!esFecha(desde) || !esFecha(hasta)) throw errorHttp(400, 'Fechas inválidas (formato AAAA-MM-DD)');
  if (desde > hasta) throw errorHttp(400, 'La fecha "desde" es posterior a "hasta"');
  return { desde, hasta };
}

// Responsable inscripto: el IVA de las compras es crédito fiscal y no es costo.
// Con tasa 0 (monotributo) el gasto se toma por el total.
async function tasaIva() {
  const c = await get('SELECT tasa_iva FROM configuracion WHERE id = 1');
  const t = Number(c && c.tasa_iva);
  return Number.isFinite(t) && t > 0 ? t : 0;
}
const costoGasto = (g, tasa) => r2(tasa > 0 ? g.total - g.iva : g.total);
// IVA contenido en un importe final (precio con IVA incluido)
const ivaIncluido = (monto, tasa) => tasa > 0 ? r2(monto - monto / (1 + tasa / 100)) : 0;

// Cobros del período por día y medio de pago (pedidos pagados)
const cobrosPorDia = (desde, hasta) => all(`
  SELECT date(pg.fecha, ${LOCAL()}) AS dia, pg.metodo, SUM(pg.monto) AS total, COUNT(*) AS cantidad
  FROM pagos pg JOIN pedidos p ON p.id = pg.pedido_id
  WHERE p.estado = 'pagado' AND date(pg.fecha, ${LOCAL()}) BETWEEN ? AND ?
  GROUP BY dia, pg.metodo ORDER BY dia`, [desde, hasta]);

// Egresos e ingresos de caja que no corresponden a un gasto cargado
const movimientosCajaSueltos = (desde, hasta) => all(`
  SELECT m.id, date(m.fecha, ${LOCAL()}) AS dia, m.tipo, m.concepto, m.monto
  FROM movimientos_caja m
  WHERE date(m.fecha, ${LOCAL()}) BETWEEN ? AND ?
    AND m.id NOT IN (SELECT caja_movimiento_id FROM gastos WHERE caja_movimiento_id IS NOT NULL)
  ORDER BY m.fecha`, [desde, hasta]);

const SELECT_GASTO = `
  SELECT g.*, pr.nombre AS proveedor_nombre, pr.cuit AS proveedor_cuit, u.nombre AS usuario_nombre
  FROM gastos g
  LEFT JOIN proveedores pr ON pr.id = g.proveedor_id
  LEFT JOIN usuarios u ON u.id = g.usuario_id`;

// Valida y normaliza un gasto completo. El total siempre es neto + IVA + otros impuestos.
async function validarGasto(b) {
  const fecha = String(b.fecha || '');
  if (!esFecha(fecha)) throw errorHttp(400, 'Indicá la fecha del gasto');
  if (!CATEGORIA[b.categoria]) throw errorHttp(400, 'Categoría inválida');
  const descripcion = String(b.descripcion || '').trim().slice(0, 200);
  if (!descripcion) throw errorHttp(400, 'Indicá una descripción del gasto');
  const tipo = b.tipo_comprobante || 'sin_comprobante';
  if (!COMPROBANTES[tipo]) throw errorHttp(400, 'Tipo de comprobante inválido');
  const importes = {};
  for (const campo of ['neto', 'iva', 'otros_impuestos']) {
    const v = Number(b[campo] === undefined || b[campo] === '' || b[campo] === null ? 0 : b[campo]);
    if (!Number.isFinite(v) || v < 0) throw errorHttp(400, 'Los importes no pueden ser negativos');
    importes[campo] = r2(v);
  }
  // El IVA discriminado solo existe en la factura A
  if (tipo !== 'factura_a' && importes.iva > 0) throw errorHttp(400, 'Solo la factura A discrimina IVA');
  const total = r2(importes.neto + importes.iva + importes.otros_impuestos);
  if (total <= 0) throw errorHttp(400, 'El importe del gasto debe ser mayor a cero');
  let proveedorId = null;
  if (b.proveedor_id !== undefined && b.proveedor_id !== null && b.proveedor_id !== '') {
    const pr = await get('SELECT id FROM proveedores WHERE id = ?', [b.proveedor_id]);
    if (!pr) throw errorHttp(400, 'Proveedor no encontrado');
    proveedorId = pr.id;
  }
  const vencimiento = b.vencimiento ? String(b.vencimiento) : null;
  if (vencimiento && !esFecha(vencimiento)) throw errorHttp(400, 'Fecha de vencimiento inválida');
  return {
    fecha, categoria: b.categoria, proveedor_id: proveedorId, descripcion, tipo_comprobante: tipo,
    numero_comprobante: String(b.numero_comprobante || '').trim().slice(0, 40), ...importes, total, vencimiento
  };
}

// Marca el gasto como pagado. En efectivo "desde la caja" registra el egreso en la caja abierta,
// así el arqueo cuadra y el gasto no se cuenta dos veces.
async function pagarGastoTx(gasto, body, usuario) {
  const metodo = String((body && body.metodo_pago) || '');
  if (!METODOS_GASTO[metodo]) throw errorHttp(400, 'Indicá el medio de pago');
  const fechaPago = (body && body.fecha_pago) || fechaLocal();
  if (!esFecha(fechaPago)) throw errorHttp(400, 'Fecha de pago inválida');
  if (fechaPago < gasto.fecha) throw errorHttp(400, 'La fecha de pago no puede ser anterior a la del gasto');
  let movimientoId = null;
  if (body && body.desde_caja) {
    if (metodo !== 'efectivo') throw errorHttp(400, 'Solo se paga desde la caja en efectivo');
    if (!tienePermiso(usuario, 'caja.operar')) throw errorHttp(403, 'Tu usuario no puede registrar egresos de caja');
    const caja = await get("SELECT id FROM caja WHERE estado = 'abierta'");
    if (!caja) throw errorHttp(400, 'No hay caja abierta para pagar en efectivo desde la caja');
    const pr = gasto.proveedor_id ? await get('SELECT nombre FROM proveedores WHERE id = ?', [gasto.proveedor_id]) : null;
    const concepto = `Pago: ${gasto.descripcion}${pr ? ' (' + pr.nombre + ')' : ''}`.slice(0, 200);
    movimientoId = (await run('INSERT INTO movimientos_caja (caja_id, tipo, concepto, monto, usuario_id) VALUES (?, ?, ?, ?, ?)',
      [caja.id, 'egreso', concepto, gasto.total, usuario.id])).id;
  }
  const { changes } = await run(`UPDATE gastos SET estado = 'pagado', fecha_pago = ?, metodo_pago = ?, caja_movimiento_id = ?
    WHERE id = ? AND estado = 'pendiente' AND anulado = 0`, [fechaPago, metodo, movimientoId, gasto.id]);
  if (!changes) throw errorHttp(400, 'El gasto ya estaba pagado o anulado');
  await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, ?, ?)',
    [usuario.id, 'pagar_gasto', `Gasto #${gasto.id} pagado (${METODOS_GASTO[metodo]}${movimientoId ? ', desde la caja' : ''}): ${gasto.descripcion} ${gasto.total}`]);
}

app.get('/api/contabilidad/opciones', autenticar, requiere('contabilidad'), async (req, res) => {
  try {
    res.json({
      categorias: CATEGORIAS, comprobantes: COMPROBANTES, metodos: METODOS_GASTO,
      tasa_iva: await tasaIva(), hoy: fechaLocal()
    });
  } catch (err) {
    errorInterno(res, err);
  }
});

// ----- Gastos -----
app.get('/api/contabilidad/gastos', autenticar, requiere('contabilidad'), async (req, res) => {
  try {
    const { desde, hasta } = periodo(req.query);
    const where = ['g.fecha BETWEEN ? AND ?'], params = [desde, hasta];
    if (req.query.anulados !== '1') where.push('g.anulado = 0');
    if (['pendiente', 'pagado'].includes(req.query.estado)) { where.push('g.estado = ?'); params.push(req.query.estado); }
    if (CATEGORIA[req.query.categoria]) { where.push('g.categoria = ?'); params.push(req.query.categoria); }
    if (req.query.proveedor_id) { where.push('g.proveedor_id = ?'); params.push(req.query.proveedor_id); }
    res.json(await all(`${SELECT_GASTO} WHERE ${where.join(' AND ')} ORDER BY g.fecha DESC, g.id DESC LIMIT 1000`, params));
  } catch (err) {
    errorInterno(res, err);
  }
});

app.post('/api/contabilidad/gastos', autenticar, requiere('contabilidad'), async (req, res) => {
  try {
    const body = req.body || {};
    const g = await validarGasto(body);
    const id = await transaccion(async () => {
      const r = await run(`INSERT INTO gastos (fecha, categoria, proveedor_id, descripcion, tipo_comprobante, numero_comprobante,
          neto, iva, otros_impuestos, total, vencimiento, usuario_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [g.fecha, g.categoria, g.proveedor_id, g.descripcion, g.tipo_comprobante, g.numero_comprobante,
          g.neto, g.iva, g.otros_impuestos, g.total, g.vencimiento, req.usuario.id]);
      await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, ?, ?)',
        [req.usuario.id, 'crear_gasto', `Gasto #${r.id}: ${g.descripcion} (${CATEGORIA[g.categoria].nombre}) ${g.total}`]);
      // Pagado en el momento
      if (body.pagado) await pagarGastoTx({ ...g, id: r.id }, body, req.usuario);
      return r.id;
    });
    res.status(201).json({ id, message: 'Gasto registrado' });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.put('/api/contabilidad/gastos/:id', autenticar, requiere('contabilidad'), async (req, res) => {
  try {
    await transaccion(async () => {
      const actual = await get('SELECT * FROM gastos WHERE id = ?', [req.params.id]);
      if (!actual) throw errorHttp(404, 'Gasto no encontrado');
      if (actual.anulado) throw errorHttp(400, 'El gasto está anulado');
      const datos = { ...actual };
      for (const campo of ['fecha', 'categoria', 'proveedor_id', 'descripcion', 'tipo_comprobante', 'numero_comprobante',
        'neto', 'iva', 'otros_impuestos', 'vencimiento']) {
        if (req.body && req.body[campo] !== undefined) datos[campo] = req.body[campo];
      }
      const g = await validarGasto(datos);
      if (actual.estado === 'pagado' && (g.total !== r2(actual.total) || g.fecha > actual.fecha_pago))
        throw errorHttp(400, 'El gasto ya está pagado: para cambiar el importe o la fecha, anulalo y cargalo de nuevo');
      await run(`UPDATE gastos SET fecha = ?, categoria = ?, proveedor_id = ?, descripcion = ?, tipo_comprobante = ?,
          numero_comprobante = ?, neto = ?, iva = ?, otros_impuestos = ?, total = ?, vencimiento = ? WHERE id = ?`,
        [g.fecha, g.categoria, g.proveedor_id, g.descripcion, g.tipo_comprobante, g.numero_comprobante,
          g.neto, g.iva, g.otros_impuestos, g.total, g.vencimiento, actual.id]);
      await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, ?, ?)',
        [req.usuario.id, 'editar_gasto', `Gasto #${actual.id}: ${g.descripcion} ${g.total}`]);
    });
    res.json({ message: 'Gasto actualizado' });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.post('/api/contabilidad/gastos/:id/pagar', autenticar, requiere('contabilidad'), async (req, res) => {
  try {
    await transaccion(async () => {
      const gasto = await get('SELECT * FROM gastos WHERE id = ?', [req.params.id]);
      if (!gasto) throw errorHttp(404, 'Gasto no encontrado');
      await pagarGastoTx(gasto, req.body || {}, req.usuario);
    });
    res.json({ message: 'Pago registrado' });
  } catch (err) {
    errorInterno(res, err);
  }
});

// Anular (no se borra: queda en la auditoría). Si se pagó desde la caja, el egreso queda en la caja
// porque el efectivo efectivamente salió; pasa a contarse como gasto menor de caja.
app.delete('/api/contabilidad/gastos/:id', autenticar, requiere('contabilidad'), async (req, res) => {
  try {
    await transaccion(async () => {
      const gasto = await get('SELECT * FROM gastos WHERE id = ? AND anulado = 0', [req.params.id]);
      if (!gasto) throw errorHttp(404, 'Gasto no encontrado');
      await run('UPDATE gastos SET anulado = 1, caja_movimiento_id = NULL WHERE id = ?', [gasto.id]);
      await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, ?, ?)',
        [req.usuario.id, 'anular_gasto', `Gasto #${gasto.id} anulado: ${gasto.descripcion} ${gasto.total}`]);
    });
    res.json({ message: 'Gasto anulado' });
  } catch (err) {
    errorInterno(res, err);
  }
});

// ----- Cuentas a pagar -----
app.get('/api/contabilidad/cuentas-pagar', autenticar, requiere('contabilidad'), async (req, res) => {
  try {
    const hoy = fechaLocal();
    const gastos = await all(`${SELECT_GASTO} WHERE g.estado = 'pendiente' AND g.anulado = 0
      ORDER BY COALESCE(g.vencimiento, g.fecha), g.id`);
    for (const g of gastos) {
      const vence = g.vencimiento || g.fecha;
      g.dias_para_vencer = Math.round((new Date(vence + 'T00:00:00Z') - new Date(hoy + 'T00:00:00Z')) / 86400000);
    }
    const suma = lista => r2(lista.reduce((s, g) => s + g.total, 0));
    const porProveedor = new Map();
    for (const g of gastos) {
      const clave = g.proveedor_nombre || 'Sin proveedor';
      const p = porProveedor.get(clave) || { proveedor: clave, cantidad: 0, total: 0 };
      p.cantidad++; p.total = r2(p.total + g.total);
      porProveedor.set(clave, p);
    }
    res.json({
      hoy, gastos,
      total: suma(gastos),
      vencido: suma(gastos.filter(g => g.dias_para_vencer < 0)),
      proximos_7_dias: suma(gastos.filter(g => g.dias_para_vencer >= 0 && g.dias_para_vencer <= 7)),
      por_proveedor: [...porProveedor.values()].sort((a, b) => b.total - a.total)
    });
  } catch (err) {
    errorInterno(res, err);
  }
});

// ----- Estado de resultados -----
app.get('/api/contabilidad/resultados', autenticar, requiere('contabilidad'), async (req, res) => {
  try {
    const { desde, hasta } = periodo(req.query);
    const tasa = await tasaIva();
    const cobros = await cobrosPorDia(desde, hasta);
    const gastos = await all("SELECT * FROM gastos WHERE anulado = 0 AND fecha BETWEEN ? AND ?", [desde, hasta]);
    const sueltos = (await movimientosCajaSueltos(desde, hasta)).filter(m => m.tipo === 'egreso');
    const { teorico } = await get(`
      SELECT COALESCE(SUM(pi.cantidad * COALESCE(pr.costo, 0)), 0) AS teorico
      FROM pedido_items pi JOIN pedidos p ON p.id = pi.pedido_id LEFT JOIN productos pr ON pr.id = pi.producto_id
      WHERE p.estado = 'pagado' AND date(p.cerrado_en, ${LOCAL()}) BETWEEN ? AND ?`, [desde, hasta]);

    const ventasBrutas = r2(cobros.reduce((s, c) => s + c.total, 0));
    const ivaDebito = ivaIncluido(ventasBrutas, tasa);
    const ventasNetas = r2(ventasBrutas - ivaDebito);
    const porCategoria = {};
    for (const g of gastos) porCategoria[g.categoria] = r2((porCategoria[g.categoria] || 0) + costoGasto(g, tasa));
    const costoMercaderia = porCategoria.mercaderia || 0;
    const gastosOperativos = CATEGORIAS.filter(c => c.id !== 'mercaderia' && porCategoria[c.id])
      .map(c => ({ categoria: c.id, nombre: c.nombre, monto: porCategoria[c.id] }));
    const menores = r2(sueltos.reduce((s, m) => s + m.monto, 0));
    if (menores) gastosOperativos.push({ categoria: 'caja', nombre: 'Gastos menores de caja (sin comprobante)', monto: menores });
    gastosOperativos.sort((a, b) => b.monto - a.monto);
    const totalOperativos = r2(gastosOperativos.reduce((s, g) => s + g.monto, 0));
    const margenBruto = r2(ventasNetas - costoMercaderia);
    const resultado = r2(margenBruto - totalOperativos);
    const pct = v => ventasNetas > 0 ? Math.round(v / ventasNetas * 1000) / 10 : 0;

    // Serie diaria (ventas netas y gastos) para el gráfico
    const dias = new Map();
    const dia = d => { if (!dias.has(d)) dias.set(d, { fecha: d, ventas: 0, gastos: 0 }); return dias.get(d); };
    for (let d = new Date(desde + 'T00:00:00Z'), n = 0; d <= new Date(hasta + 'T00:00:00Z') && n < 400; d.setUTCDate(d.getUTCDate() + 1), n++)
      dia(d.toISOString().slice(0, 10));
    for (const c of cobros) { const x = dia(c.dia); x.ventas = r2(x.ventas + c.total - ivaIncluido(c.total, tasa)); }
    for (const g of gastos) { const x = dia(g.fecha); x.gastos = r2(x.gastos + costoGasto(g, tasa)); }
    for (const m of sueltos) { const x = dia(m.dia); x.gastos = r2(x.gastos + m.monto); }

    res.json({
      desde, hasta, tasa_iva: tasa,
      ventas_brutas: ventasBrutas, iva_debito: ivaDebito, ventas_netas: ventasNetas,
      cantidad_ventas: cobros.reduce((s, c) => s + c.cantidad, 0),
      costo_mercaderia: costoMercaderia, costo_teorico: r2(teorico),
      food_cost_real: pct(costoMercaderia), food_cost_teorico: pct(teorico),
      margen_bruto: margenBruto, margen_bruto_pct: pct(margenBruto),
      gastos_operativos: gastosOperativos, total_gastos_operativos: totalOperativos,
      resultado, margen_neto_pct: pct(resultado),
      serie: [...dias.values()].sort((a, b) => a.fecha.localeCompare(b.fecha))
    });
  } catch (err) {
    errorInterno(res, err);
  }
});

// ----- IVA del mes -----
app.get('/api/contabilidad/iva', autenticar, requiere('contabilidad'), async (req, res) => {
  try {
    const mes = req.query.mes || fechaLocal().slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return res.status(400).json({ error: 'Mes inválido (formato AAAA-MM)' });
    const tasa = await tasaIva();
    const desde = mes + '-01', hasta = mes + '-31';
    const cobros = await cobrosPorDia(desde, hasta);
    const ventasBrutas = r2(cobros.reduce((s, c) => s + c.total, 0));
    const debito = ivaIncluido(ventasBrutas, tasa);
    const compras = await all(`${SELECT_GASTO} WHERE g.anulado = 0 AND g.fecha BETWEEN ? AND ? AND g.iva > 0
      ORDER BY g.fecha, g.id`, [desde, hasta]);
    const credito = r2(compras.reduce((s, g) => s + g.iva, 0));
    // Facturas electrónicas emitidas (creado_en está en hora local del servidor)
    const facturas = await all(`SELECT tipo_comprobante_nombre AS tipo, COUNT(*) AS cantidad, COALESCE(SUM(total), 0) AS total
      FROM comprobantes_afip WHERE substr(creado_en, 1, 7) = ? GROUP BY tipo_comprobante_nombre`, [mes]);
    res.json({
      mes, tasa_iva: tasa,
      ventas: { brutas: ventasBrutas, netas: r2(ventasBrutas - debito), iva: debito, facturas },
      compras: { comprobantes: compras, neto: r2(compras.reduce((s, g) => s + g.neto, 0)), iva: credito },
      saldo: r2(debito - credito)
    });
  } catch (err) {
    errorInterno(res, err);
  }
});

// ----- Libro diario y balance de sumas y saldos -----
app.get('/api/contabilidad/libro-diario', autenticar, requiere('contabilidad'), async (req, res) => {
  try {
    const { desde, hasta } = periodo(req.query);
    const tasa = await tasaIva();
    const asientos = [];
    const linea = (clave, debe, haber) => ({ codigo: CUENTAS[clave].codigo, cuenta: CUENTAS[clave].nombre, debe: r2(debe), haber: r2(haber) });
    const asiento = (fecha, orden, concepto, lineas) => asientos.push({ fecha, orden, concepto, lineas: lineas.filter(l => l.debe || l.haber) });

    // Ventas: un asiento por día, cobrado en cada medio contra ventas e IVA débito
    const porDia = new Map();
    for (const c of await cobrosPorDia(desde, hasta)) {
      if (!porDia.has(c.dia)) porDia.set(c.dia, []);
      porDia.get(c.dia).push(c);
    }
    for (const [fecha, cobros] of porDia) {
      const medios = {};
      for (const c of cobros) medios[cuentaDeMedio(c.metodo)] = r2((medios[cuentaDeMedio(c.metodo)] || 0) + c.total);
      const total = r2(cobros.reduce((s, c) => s + c.total, 0));
      const iva = ivaIncluido(total, tasa);
      asiento(fecha, 1, `Ventas del día (${cobros.reduce((s, c) => s + c.cantidad, 0)} cobros)`, [
        ...Object.entries(medios).map(([cuenta, monto]) => linea(cuenta, monto, 0)),
        linea('ventas', 0, total - iva), linea('iva_df', 0, iva)
      ]);
    }

    // Gastos devengados en el período y pagos del período
    const gastos = await all(`${SELECT_GASTO} WHERE g.anulado = 0 AND (g.fecha BETWEEN ? AND ? OR g.fecha_pago BETWEEN ? AND ?)`,
      [desde, hasta, desde, hasta]);
    for (const g of gastos) {
      const ref = [COMPROBANTES[g.tipo_comprobante], g.numero_comprobante].filter(x => x && x !== 'Sin comprobante').join(' ');
      const concepto = `${g.descripcion}${g.proveedor_nombre ? ' - ' + g.proveedor_nombre : ''}${ref ? ' (' + ref + ')' : ''}`;
      const pagadoEnElActo = g.estado === 'pagado' && g.fecha_pago === g.fecha;
      if (g.fecha >= desde && g.fecha <= hasta) {
        const costo = costoGasto(g, tasa);
        asiento(g.fecha, 2, concepto, [
          linea(g.categoria, costo, 0), linea('iva_cf', g.total - costo, 0),
          linea(pagadoEnElActo ? cuentaDeMedio(g.metodo_pago) : 'proveedores', 0, g.total)
        ]);
      }
      if (g.estado === 'pagado' && !pagadoEnElActo && g.fecha_pago >= desde && g.fecha_pago <= hasta) {
        asiento(g.fecha_pago, 3, `Pago: ${concepto}`, [linea('proveedores', g.total, 0), linea(cuentaDeMedio(g.metodo_pago), 0, g.total)]);
      }
    }

    // Movimientos de caja que no son pagos de gastos cargados
    for (const m of await movimientosCajaSueltos(desde, hasta)) {
      asiento(m.dia, 4, `Caja: ${m.concepto}`, m.tipo === 'egreso'
        ? [linea('caja_menores', m.monto, 0), linea('caja', 0, m.monto)]
        : [linea('caja', m.monto, 0), linea('ajustes', 0, m.monto)]);
    }

    asientos.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.orden - b.orden);
    asientos.forEach((a, i) => { a.numero = i + 1; delete a.orden; });

    // Sumas y saldos por cuenta
    const cuentas = new Map();
    for (const a of asientos) for (const l of a.lineas) {
      const c = cuentas.get(l.codigo) || { codigo: l.codigo, cuenta: l.cuenta, debe: 0, haber: 0 };
      c.debe = r2(c.debe + l.debe); c.haber = r2(c.haber + l.haber);
      cuentas.set(l.codigo, c);
    }
    const balance = [...cuentas.values()].sort((a, b) => a.codigo.localeCompare(b.codigo))
      .map(c => ({ ...c, saldo: r2(c.debe - c.haber) }));
    res.json({
      desde, hasta, asientos, balance,
      total_debe: r2(balance.reduce((s, c) => s + c.debe, 0)),
      total_haber: r2(balance.reduce((s, c) => s + c.haber, 0))
    });
  } catch (err) {
    errorInterno(res, err);
  }
});

};

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciarServidor } = require('./helpers');

// Escenario: IVA 21 %, 10 platos a $1.210 (costo $300) cobrados en efectivo = $12.100 con IVA.
let s, hoy, prov, gastoCarne, gastoAlquiler;
before(async () => {
  s = await iniciarServidor();
  await s.q('UPDATE configuracion SET tasa_iva = 21 WHERE id = 1');
  const [prod] = await s.q('SELECT id FROM productos WHERE activo = 1 ORDER BY id LIMIT 1');
  await s.q('UPDATE productos SET precio_venta = 1210, costo = 300, tracking_stock = 0 WHERE id = ?', [prod.id]);
  assert.equal((await s.llamar('POST', '/api/caja/abrir', { monto_inicial: 1000 }, s.tokenVendedor))[0], 201);
  const [, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'takeaway', items: [{ producto_id: prod.id, cantidad: 10 }] }, s.tokenVendedor);
  assert.equal((await s.llamar('POST', `/api/pedidos/${p.id}/pagar`, { metodo: 'efectivo', monto: 12100 }, s.tokenVendedor))[0], 200);
  hoy = (await s.llamar('GET', '/api/contabilidad/opciones', undefined, s.tokenAdmin))[1].hoy;
  [prov] = await s.q('SELECT id FROM proveedores ORDER BY id LIMIT 1');
});
after(async () => { await s.cerrar(); });

const enDias = n => { const d = new Date(hoy + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const gasto = (body, token = s.tokenAdmin) => s.llamar('POST', '/api/contabilidad/gastos',
  { fecha: hoy, categoria: 'otros', descripcion: 'Gasto', tipo_comprobante: 'recibo', neto: 100, ...body }, token);

test('solo administrador y encargado acceden a la contabilidad', async () => {
  assert.equal((await s.llamar('GET', '/api/contabilidad/resultados', undefined, s.tokenVendedor))[0], 403);
  assert.equal((await gasto({}, s.tokenVendedor))[0], 403);
  assert.equal((await s.llamar('GET', '/api/contabilidad/resultados', undefined))[0], 401);
});

test('validaciones al cargar un gasto', async () => {
  assert.equal((await gasto({ categoria: 'inexistente' }))[0], 400);
  assert.equal((await gasto({ descripcion: '  ' }))[0], 400);
  assert.equal((await gasto({ neto: -5 }))[0], 400);
  assert.equal((await gasto({ neto: 0 }))[0], 400);
  assert.equal((await gasto({ fecha: '2026-13-45' }))[0], 400);
  assert.equal((await gasto({ tipo_comprobante: 'factura_b', iva: 21 }))[0], 400, 'solo la factura A discrimina IVA');
  assert.equal((await gasto({ proveedor_id: 99999 }))[0], 400);
  assert.equal((await gasto({ pagado: true, metodo_pago: 'tarjeta', desde_caja: true }))[0], 400, 'desde la caja solo en efectivo');
  assert.equal((await s.q('SELECT COUNT(*) c FROM gastos'))[0].c, 0, 'los rechazados no dejan nada guardado');
});

test('compra a pagar, gasto pagado desde la caja y egreso suelto', async () => {
  let r = await gasto({ categoria: 'mercaderia', descripcion: 'Compra de carne', proveedor_id: prov.id, tipo_comprobante: 'factura_a',
    numero_comprobante: '0003-00001234', neto: 2000, iva: 420, vencimiento: enDias(3) });
  assert.equal(r[0], 201);
  gastoCarne = r[1].id;
  const [g] = await s.q('SELECT total, estado FROM gastos WHERE id = ?', [gastoCarne]);
  assert.deepEqual({ ...g }, { total: 2420, estado: 'pendiente' });

  r = await gasto({ categoria: 'alquiler', descripcion: 'Alquiler', neto: 3000, pagado: true, metodo_pago: 'efectivo', desde_caja: true });
  assert.equal(r[0], 201);
  gastoAlquiler = r[1].id;
  assert.equal((await s.llamar('POST', '/api/caja/movimiento', { tipo: 'egreso', monto: 500, concepto: 'Hielo' }, s.tokenVendedor))[0], 201);

  // La caja descuenta el pago del alquiler: 1000 + 12100 − 3000 − 500
  const [, caja] = await s.llamar('GET', '/api/caja/estado', undefined, s.tokenVendedor);
  assert.equal(caja.resumen.efectivo_esperado, 9600);
  assert.ok(caja.resumen.movimientos.some(m => m.concepto.startsWith('Pago: Alquiler') && m.monto === 3000));

  const [, cp] = await s.llamar('GET', '/api/contabilidad/cuentas-pagar', undefined, s.tokenAdmin);
  assert.equal(cp.total, 2420);
  assert.equal(cp.proximos_7_dias, 2420);
  assert.equal(cp.vencido, 0);
  assert.equal(cp.gastos[0].dias_para_vencer, 3);
});

test('estado de resultados: IVA, mercadería, gastos y egresos de caja sin duplicar', async () => {
  const [st, r] = await s.llamar('GET', `/api/contabilidad/resultados?desde=${hoy}&hasta=${hoy}`, undefined, s.tokenAdmin);
  assert.equal(st, 200);
  assert.equal(r.ventas_brutas, 12100);
  assert.equal(r.iva_debito, 2100);
  assert.equal(r.ventas_netas, 10000);
  assert.equal(r.costo_mercaderia, 2000, 'el IVA de la factura A no es costo');
  assert.equal(r.costo_teorico, 3000);
  assert.equal(r.food_cost_teorico, 30);
  // Alquiler 3000 (no se cuenta además como egreso de caja) + hielo 500
  assert.deepEqual(r.gastos_operativos.map(g => [g.categoria, g.monto]), [['alquiler', 3000], ['caja', 500]]);
  assert.equal(r.resultado, 4500);
  assert.equal(r.margen_neto_pct, 45);
  assert.equal(r.serie.length, 1);
  assert.deepEqual(r.serie[0], { fecha: hoy, ventas: 10000, gastos: 5500 });
  assert.equal((await s.llamar('GET', '/api/contabilidad/resultados?desde=2026-05-10&hasta=2026-05-01', undefined, s.tokenAdmin))[0], 400);
});

test('IVA del mes: débito de ventas, crédito de facturas A y saldo', async () => {
  const [, iva] = await s.llamar('GET', `/api/contabilidad/iva?mes=${hoy.slice(0, 7)}`, undefined, s.tokenAdmin);
  assert.equal(iva.ventas.iva, 2100);
  assert.equal(iva.compras.iva, 420);
  assert.equal(iva.compras.comprobantes.length, 1);
  assert.equal(iva.saldo, 1680);
  assert.equal((await s.llamar('GET', '/api/contabilidad/iva?mes=2026-13', undefined, s.tokenAdmin))[0], 400);
});

test('pagar una deuda y no poder pagarla dos veces', async () => {
  assert.equal((await s.llamar('POST', `/api/contabilidad/gastos/${gastoCarne}/pagar`, { metodo_pago: 'transferencia', fecha_pago: enDias(-1) }, s.tokenAdmin))[0], 400,
    'no se paga antes de la fecha del comprobante');
  assert.equal((await s.llamar('POST', `/api/contabilidad/gastos/${gastoCarne}/pagar`, { metodo_pago: 'transferencia' }, s.tokenAdmin))[0], 200);
  assert.equal((await s.llamar('POST', `/api/contabilidad/gastos/${gastoCarne}/pagar`, { metodo_pago: 'transferencia' }, s.tokenAdmin))[0], 400);
  const [, cp] = await s.llamar('GET', '/api/contabilidad/cuentas-pagar', undefined, s.tokenAdmin);
  assert.equal(cp.total, 0);
  // Pagado: se puede corregir la descripción pero no el importe
  assert.equal((await s.llamar('PUT', `/api/contabilidad/gastos/${gastoCarne}`, { neto: 5000 }, s.tokenAdmin))[0], 400);
  assert.equal((await s.llamar('PUT', `/api/contabilidad/gastos/${gastoCarne}`, { descripcion: 'Carne y achuras' }, s.tokenAdmin))[0], 200);
  const [, lista] = await s.llamar('GET', `/api/contabilidad/gastos?desde=${hoy}&hasta=${hoy}&estado=pagado`, undefined, s.tokenAdmin);
  assert.deepEqual(lista.map(g => g.descripcion).sort(), ['Alquiler', 'Carne y achuras']);
});

test('libro diario balanceado y sumas y saldos por cuenta', async () => {
  const [, d] = await s.llamar('GET', `/api/contabilidad/libro-diario?desde=${hoy}&hasta=${hoy}`, undefined, s.tokenAdmin);
  // Ventas del día, compra de carne (pagada el mismo día), alquiler y egreso de caja
  assert.equal(d.asientos.length, 4);
  for (const a of d.asientos) {
    const debe = a.lineas.reduce((x, l) => x + l.debe, 0), haber = a.lineas.reduce((x, l) => x + l.haber, 0);
    assert.ok(Math.abs(debe - haber) < 0.001, `asiento ${a.numero} balanceado`);
  }
  assert.equal(d.total_debe, d.total_haber);
  const saldo = Object.fromEntries(d.balance.map(c => [c.cuenta, c.saldo]));
  assert.equal(saldo['Caja'], 12100 - 3000 - 500);
  assert.equal(saldo['Bancos y tarjetas'], -2420);
  assert.equal(saldo['Ventas'], -10000);
  assert.equal(saldo['IVA débito fiscal'], -2100);
  assert.equal(saldo['IVA crédito fiscal'], 420);
  assert.equal(saldo['Mercadería e insumos'], 2000);
  assert.equal(saldo['Proveedores'], undefined, 'sin deudas pendientes');
});

test('anular un gasto pagado desde la caja: el egreso queda como gasto menor', async () => {
  assert.equal((await s.llamar('DELETE', `/api/contabilidad/gastos/${gastoAlquiler}`, undefined, s.tokenAdmin))[0], 200);
  assert.equal((await s.llamar('DELETE', `/api/contabilidad/gastos/${gastoAlquiler}`, undefined, s.tokenAdmin))[0], 404);
  const [, r] = await s.llamar('GET', `/api/contabilidad/resultados?desde=${hoy}&hasta=${hoy}`, undefined, s.tokenAdmin);
  assert.deepEqual(r.gastos_operativos.map(g => [g.categoria, g.monto]), [['caja', 3500]]);
  assert.equal(r.resultado, 4500);
  const [, lista] = await s.llamar('GET', `/api/contabilidad/gastos?desde=${hoy}&hasta=${hoy}`, undefined, s.tokenAdmin);
  assert.equal(lista.length, 1);
});

test('monotributo (IVA 0 %): sin débito y los gastos se toman por el total', async () => {
  await s.q('UPDATE configuracion SET tasa_iva = 0 WHERE id = 1');
  const [, r] = await s.llamar('GET', `/api/contabilidad/resultados?desde=${hoy}&hasta=${hoy}`, undefined, s.tokenAdmin);
  assert.equal(r.iva_debito, 0);
  assert.equal(r.ventas_netas, 12100);
  assert.equal(r.costo_mercaderia, 2420);
  await s.q('UPDATE configuracion SET tasa_iva = 21 WHERE id = 1');
});

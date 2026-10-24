// Ganancias: ventas sin propina, costo de lo vendido, comisiones (medio de pago y app de delivery), gastos,
// por plato, canal y mozo, fugas, punto de equilibrio y "cuánto gané hoy". Números hechos para verificarse a mano.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { iniciarServidor } = require('./helpers');
const { firmarLicencia } = require('../src/licencia-firma');
const { fechaLocal } = require('../src/tiempo');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
let s, A, B;
const hoy = fechaLocal();
const ver = async (ruta, token = s.tokenAdmin) => { const [st, r] = await s.llamar('GET', ruta, null, token); assert.equal(st, 200, JSON.stringify(r)); return r; };

async function venta(items, pagos, { propina = 0, plataforma = null } = {}) {
  const [, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'takeaway', items }, s.tokenVendedor);
  if (plataforma) await s.q("INSERT INTO entregas (pedido_id, tipo, plataforma) VALUES (?, 'delivery', ?)", [p.id, plataforma]);
  const [st, r] = await s.llamar('POST', `/api/pedidos/${p.id}/cobro`, { pagos, propina }, s.tokenVendedor);
  assert.equal(st, 200, JSON.stringify(r));
  return p;
}

before(async () => {
  s = await iniciarServidor({ MORFI_LICENCIA_PUBLICA: publicKey.export({ type: 'spki', format: 'pem' }) });
  await s.q('UPDATE configuracion SET tasa_iva = 0');
  [A, B] = await s.q('SELECT id FROM productos WHERE activo = 1 AND COALESCE(es_combo, 0) = 0 ORDER BY id LIMIT 2');
  // Sin control de stock ni receta: solo interesan precio y costo
  await s.q('UPDATE productos SET tracking_stock = 0, stock_actual = 1000 WHERE id IN (?, ?)', [A.id, B.id]);
  await s.q('DELETE FROM recetas WHERE plato_id IN (?, ?)', [A.id, B.id]);
  await s.q('UPDATE productos SET precio_venta = 1000, costo = 400 WHERE id = ?', [A.id]);
  await s.q('UPDATE productos SET precio_venta = 2000, costo = 0 WHERE id = ?', [B.id]);
  await s.q("UPDATE plataformas_delivery SET comision = 25 WHERE nombre = 'PedidosYa'");
  // 2 × A en efectivo; 1 × A con tarjeta + $100 de propina; 1 × A por PedidosYa en efectivo
  await venta([{ producto_id: A.id, cantidad: 2 }], [{ metodo: 'efectivo', monto: 2000 }]);
  await venta([{ producto_id: A.id, cantidad: 1 }], [{ metodo: 'tarjeta', monto: 1100 }], { propina: 100 });
  await venta([{ producto_id: A.id, cantidad: 1 }], [{ metodo: 'efectivo', monto: 1000 }], { plataforma: 'PedidosYa' });
  // Gastos: el alquiler cuenta; la mercadería no (ya está en el costo de lo vendido)
  await s.q("INSERT INTO gastos (fecha, categoria, descripcion, neto, total) VALUES (?, 'alquiler', 'Alquiler', 500, 500)", [hoy]);
  await s.q("INSERT INTO gastos (fecha, categoria, descripcion, neto, total) VALUES (?, 'mercaderia', 'Compra', 9999, 9999)", [hoy]);
});
after(async () => { if (s) await s.cerrar(); });

test('resumen del día: ventas sin propina, costo, comisiones típicas, gastos y ganancia', async () => {
  const r = await ver(`/api/ganancias/resumen?desde=${hoy}&hasta=${hoy}`);
  const t = r.totales;
  assert.equal(t.ventas, 4000);
  assert.equal(t.propinas, 100);
  assert.equal(t.costo, 1600);
  // Tarjeta 3 % de 1100 = 33; PedidosYa 25 % de 1000 = 250
  assert.equal(t.comisiones, 283);
  assert.equal(t.ganancia_bruta, 2117);
  assert.equal(t.gastos, 500);
  assert.equal(t.ganancia, 1617);
  assert.equal(t.tickets, 3);
  assert.equal(r.periodos.length, 1);
  assert.equal(r.periodos[0].ganancia, 1617);
  assert.equal(r.comparacion.anterior.ventas, 0);
  assert.equal(r.comparacion.anterior.variacion_ventas, null, 'sin base no hay %');
});

test('agrupado por mes y semana; períodos sin ventas también aparecen', async () => {
  const mesPasado = fechaLocal(40).slice(0, 8) + '01';
  const r = await ver(`/api/ganancias/resumen?desde=${mesPasado}&hasta=${hoy}&agrupar=mes`);
  assert.ok(r.periodos.length >= 2);
  assert.equal(r.periodos.at(-1).periodo, hoy.slice(0, 7));
  assert.equal(r.periodos.at(-1).ventas, 4000);
  assert.equal(r.periodos[0].ventas, 0);
  const sem = await ver(`/api/ganancias/resumen?desde=${fechaLocal(13)}&hasta=${hoy}&agrupar=semana`);
  assert.ok(sem.periodos.every(p => new Date(p.periodo + 'T12:00:00Z').getUTCDay() === 1), 'las semanas empiezan el lunes');
  assert.equal((await s.llamar('GET', '/api/ganancias/resumen?agrupar=hora', null, s.tokenAdmin))[0], 400);
  assert.equal((await s.llamar('GET', `/api/ganancias/resumen?desde=${hoy}&hasta=2000-01-01`, null, s.tokenAdmin))[0], 400);
});

test('las comisiones se editan y se recalculan; valores fuera de rango no', async () => {
  const [st, cfg] = await s.llamar('PUT', '/api/ganancias/config', { comisiones: { tarjeta: 5, mercadopago: 6.5 } }, s.tokenAdmin);
  assert.equal(st, 200);
  assert.equal(cfg.comisiones.tarjeta, 5);
  assert.equal(cfg.comisiones.efectivo, 0, 'lo no cargado queda en el típico');
  assert.equal((await ver(`/api/ganancias/resumen?desde=${hoy}&hasta=${hoy}`)).totales.comisiones, 305);
  assert.equal((await s.llamar('PUT', '/api/ganancias/config', { comisiones: { tarjeta: 80 } }, s.tokenAdmin))[0], 400);
  assert.equal((await s.llamar('PUT', '/api/ganancias/config', { comisiones: { bitcoin: 1 } }, s.tokenAdmin))[0], 400);
  assert.equal((await s.llamar('PUT', '/api/ganancias/config', { comisiones: { tarjeta: 1 } }, s.tokenVendedor))[0], 403);
  await s.llamar('PUT', '/api/ganancias/config', { comisiones: { tarjeta: 3, mercadopago: 4 } }, s.tokenAdmin);
});

test('por plato: ganancia, margen, clase de menú y aviso de productos sin costo', async () => {
  await venta([{ producto_id: B.id, cantidad: 1 }], [{ metodo: 'efectivo', monto: 2000 }]);
  const r = await ver(`/api/ganancias/productos?desde=${hoy}&hasta=${hoy}`);
  const a = r.productos.find(p => p.producto_id === A.id), b = r.productos.find(p => p.producto_id === B.id);
  assert.deepEqual([a.unidades, a.ventas, a.costo, a.ganancia, a.margen_pct, a.ganancia_unidad], [4, 4000, 1600, 2400, 60, 600]);
  assert.equal(a.clase, 'caballo', 'se vende más pero deja menos por unidad que el promedio');
  assert.equal(b.clase, 'rompecabezas');
  assert.equal(b.sin_costo, true);
  assert.ok(r.clases.estrella.consejo);
  const res = await ver(`/api/ganancias/resumen?desde=${hoy}&hasta=${hoy}`);
  assert.equal(res.sin_costo[0].producto_id, undefined);
  assert.ok(res.sin_costo.some(x => x.unidades === 1 && x.ventas === 2000), 'avisa el producto vendido sin costo');
});

test('por canal, medio de pago, hora y mozo', async () => {
  const r = await ver(`/api/ganancias/canales?desde=${hoy}&hasta=${hoy}`);
  const pya = r.canales.find(c => c.clave === 'PedidosYa');
  assert.deepEqual([pya.ventas, pya.comisiones, pya.ganancia_bruta], [1000, 250, 350]);
  assert.equal(r.canales.find(c => c.clave === 'takeaway').nombre, 'Para llevar');
  const tarjeta = r.medios.find(m => m.metodo === 'tarjeta');
  assert.deepEqual([tarjeta.cobrado, tarjeta.comision, tarjeta.porcentaje], [1100, 33, 3]);
  assert.equal(r.horas.reduce((a, h) => a + h.tickets, 0), 4);
  assert.equal(r.mozos[0].nombre, 'Vendedor Test');
  assert.equal(r.mozos[0].propinas, 100);
  assert.equal(r.dias_semana.length, 1);
});

test('fugas: comisiones, descuentos, mermas valuadas al costo y cancelados aparte', async () => {
  await s.q("INSERT INTO movimientos_stock (producto_id, tipo, cantidad, motivo) VALUES (?, 'salida', 3, 'merma')", [A.id]);
  const [, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'takeaway', items: [{ producto_id: A.id, cantidad: 1 }] }, s.tokenVendedor);
  await s.q("UPDATE pedidos SET estado = 'cancelado', cerrado_en = CURRENT_TIMESTAMP WHERE id = ?", [p.id]);
  const r = await ver(`/api/ganancias/fugas?desde=${hoy}&hasta=${hoy}`);
  const item = k => r.items.find(x => x.clave === k).monto;
  assert.equal(item('comisiones_pago'), 33);
  assert.equal(item('comisiones_app'), 250);
  assert.equal(item('mermas'), 1200);
  assert.equal(r.total, 1483);
  assert.deepEqual(r.cancelados, { cantidad: 1, monto: 1000 });
});

test('punto de equilibrio con gastos fijos y ganancia estimada de hoy', async () => {
  let e = await ver('/api/ganancias/equilibrio');
  assert.equal(e.gastos_fijos, 0);
  assert.ok(e.sugerencia_fijos, 'sin fijos sugiere los gastos del mes anterior');
  await s.llamar('PUT', '/api/ganancias/config', { gastos_fijos: [{ concepto: 'Alquiler', monto: 300000 }, { concepto: 'Sueldos', monto: 700000 }] }, s.tokenAdmin);
  e = await ver('/api/ganancias/equilibrio');
  assert.equal(e.gastos_fijos, 1000000);
  // Ventas 6000, ganancia bruta 2117 + 2000 (B sin costo) = 4117: margen 68,6 %
  assert.equal(e.vendido, 6000);
  assert.equal(e.margen_contribucion_pct, 68.6);
  assert.equal(e.ventas_necesarias_mes, Math.round(1000000 / (4117 / 6000) * 100) / 100);
  assert.equal(e.alcanzado, false);
  assert.ok(e.falta_vender > 0);

  const h = await ver('/api/ganancias/hoy', s.tokenVendedor);
  assert.equal(h.ventas, 6000);
  assert.equal(h.ganancia_bruta, 4117);
  const dias = new Date(Date.UTC(+hoy.slice(0, 4), +hoy.slice(5, 7), 0)).getUTCDate();
  assert.equal(h.gastos_fijos_dia, Math.round(1000000 / dias * 100) / 100);
  assert.equal(h.ganancia_estimada, Math.round((4117 - h.gastos_fijos_dia) * 100) / 100);
  assert.equal((await s.llamar('PUT', '/api/ganancias/config', { gastos_fijos: [{ concepto: '', monto: 1 }] }, s.tokenAdmin))[0], 400);
});

test('IVA: con IVA discriminado la ganancia se calcula sobre la venta neta', async () => {
  await s.q('UPDATE configuracion SET tasa_iva = 21');
  const t = (await ver(`/api/ganancias/resumen?desde=${hoy}&hasta=${hoy}`)).totales;
  assert.equal(t.ventas, 6000);
  assert.equal(t.ventas_netas, Math.round(4000 / 1.21 * 100) / 100 + Math.round(2000 / 1.21 * 100) / 100);
  await s.q('UPDATE configuracion SET tasa_iva = 0');
});

test('plan Esencial: "cuánto gané hoy" sí, el detalle no; sin permiso de costos tampoco', async () => {
  assert.equal((await s.llamar('GET', `/api/ganancias/resumen`, null, s.tokenVendedor))[0], 403, 'el cajero no ve costos');
  await s.llamar('PUT', '/api/licencia', { licencia: firmarLicencia({ plan: 'esencial', vence: null }, privateKey) }, s.tokenAdmin);
  assert.equal((await s.llamar('GET', '/api/ganancias/resumen', null, s.tokenAdmin))[0], 402);
  assert.equal((await s.llamar('GET', '/api/ganancias/hoy', null, s.tokenAdmin))[0], 200);
});

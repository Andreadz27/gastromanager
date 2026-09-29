const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciarServidor } = require('./helpers');

let s, prod;
before(async () => {
  s = await iniciarServidor();
  [prod] = await s.q('SELECT id FROM productos WHERE activo = 1 ORDER BY id LIMIT 1');
  await s.q('UPDATE productos SET precio_venta = 1000, tracking_stock = 0 WHERE id = ?', [prod.id]);
});
after(async () => { await s.cerrar(); });

const vender = async (cantidad, metodo) => {
  const [, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'takeaway', items: [{ producto_id: prod.id, cantidad }] }, s.tokenVendedor);
  const [st] = await s.llamar('POST', `/api/pedidos/${p.id}/pagar`, { metodo, monto: cantidad * 1000 }, s.tokenVendedor);
  assert.equal(st, 200);
};

test('solo puede haber una caja abierta', async () => {
  const res = await Promise.all(Array.from({ length: 5 }, () => s.llamar('POST', '/api/caja/abrir', { monto_inicial: 5000 }, s.tokenVendedor)));
  assert.equal(res.filter(([st]) => st === 201).length, 1);
  assert.equal((await s.q("SELECT COUNT(*) c FROM caja WHERE estado = 'abierta'"))[0].c, 1);
});

test('arqueo: ventas por medio de pago, movimientos y efectivo esperado', async () => {
  await vender(3, 'efectivo');       // 3000 efectivo
  await vender(2, 'tarjeta');        // 2000 tarjeta
  await vender(1, 'mercadopago');    // 1000 MP
  assert.equal((await s.llamar('POST', '/api/caja/movimiento', { tipo: 'ingreso', monto: 500, concepto: 'Cambio' }, s.tokenVendedor))[0], 201);
  assert.equal((await s.llamar('POST', '/api/caja/movimiento', { tipo: 'egreso', monto: 1200, concepto: 'Proveedor' }, s.tokenVendedor))[0], 201);
  assert.equal((await s.llamar('POST', '/api/caja/movimiento', { tipo: 'egreso', monto: 0, concepto: 'x' }, s.tokenVendedor))[0], 400);
  assert.equal((await s.llamar('POST', '/api/caja/movimiento', { tipo: 'egreso', monto: 10 }, s.tokenVendedor))[0], 400);

  const [, caja] = await s.llamar('GET', '/api/caja/estado', undefined, s.tokenVendedor);
  const r = caja.resumen;
  assert.equal(r.total_ventas, 6000);
  assert.equal(r.cobros, 3);
  assert.deepEqual(Object.fromEntries(r.por_metodo.map(m => [m.metodo, m.total])), { efectivo: 3000, tarjeta: 2000, mercadopago: 1000 });
  // 5000 inicial + 3000 efectivo + 500 ingreso − 1200 egreso
  assert.equal(r.efectivo_esperado, 7300);
});

test('cierre con faltante: guarda esperado, contado y diferencia', async () => {
  assert.equal((await s.llamar('POST', '/api/caja/cerrar', {}, s.tokenVendedor))[0], 400, 'sin efectivo contado');
  const [st, cierre] = await s.llamar('POST', '/api/caja/cerrar', { monto_final_real: 7000, observaciones: 'Faltan 300' }, s.tokenVendedor);
  assert.equal(st, 200);
  assert.equal(cierre.efectivo_esperado, 7300);
  assert.equal(cierre.diferencia, -300);

  const [, historial] = await s.llamar('GET', '/api/caja/historial', undefined, s.tokenAdmin);
  assert.equal(historial[0].diferencia, -300);
  assert.equal(historial[0].ventas, 6000);
  const [, arqueo] = await s.llamar('GET', `/api/caja/${historial[0].id}/arqueo`, undefined, s.tokenAdmin);
  assert.equal(arqueo.observaciones_cierre, 'Faltan 300');
  assert.equal(arqueo.resumen.efectivo_esperado, 7300);
  assert.equal((await s.llamar('GET', '/api/caja/historial', undefined, s.tokenVendedor))[0], 403);
});

test('sin caja abierta no se registran movimientos', async () => {
  assert.equal((await s.llamar('POST', '/api/caja/movimiento', { tipo: 'ingreso', monto: 10, concepto: 'x' }, s.tokenVendedor))[0], 400);
});

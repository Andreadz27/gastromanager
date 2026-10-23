// Cobro en la mesa: cuenta dividida, pagos mixtos, propina, factura en el mismo paso y mozos que cobran
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciarServidor } = require('./helpers');

let s, prod, mesas, tokenMozo;
before(async () => {
  s = await iniciarServidor();
  [prod] = await s.q('SELECT id FROM productos WHERE activo = 1 ORDER BY id LIMIT 1');
  await s.q('UPDATE productos SET precio_venta = 1000, tracking_stock = 1, stock_actual = 100 WHERE id = ?', [prod.id]);
  mesas = (await s.q('SELECT id FROM mesas ORDER BY id LIMIT 6')).map(m => m.id);
  const hash = require('bcryptjs').hashSync('mozo1234', 4);
  await s.q("INSERT INTO usuarios (nombre, email, password, rol, debe_cambiar_password) VALUES ('Mozo Test', 'mozo@test.com', ?, 'mozo', 0)", [hash]);
  tokenMozo = s.token((await s.q("SELECT id FROM usuarios WHERE email = 'mozo@test.com'"))[0].id);
});
after(async () => { await s.cerrar(); });

const pedidoMesa = async (mesaId, cantidad = 3, token = s.tokenVendedor) => {
  const [st, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'salon', mesa_id: mesaId, items: [{ producto_id: prod.id, cantidad }] }, token);
  assert.equal(st, 201);
  return p;
};
const cobrar = (id, body, token = s.tokenVendedor) => s.llamar('POST', `/api/pedidos/${id}/cobro`, body, token);
const stock = async () => (await s.q('SELECT stock_actual s FROM productos WHERE id = ?', [prod.id]))[0].s;
const estadoMesa = async id => (await s.q('SELECT estado FROM mesas WHERE id = ?', [id]))[0].estado;

test('cuenta dividida en partes: queda abierta hasta cubrir el total y recién ahí cierra, libera la mesa y descuenta stock', async () => {
  const p = await pedidoMesa(mesas[0]); // 3000
  const stockAntes = await stock();

  const [st1, r1] = await cobrar(p.id, { pagos: [{ metodo: 'efectivo', monto: 1000 }] });
  assert.equal(st1, 200);
  assert.deepEqual([r1.cerrado, r1.saldo], [false, 2000]);
  const [, det] = await s.llamar('GET', `/api/pedidos/${p.id}`, null, s.tokenVendedor);
  assert.deepEqual([det.estado, det.pagado, det.saldo], ['abierto', 1000, 2000]);
  assert.equal(await estadoMesa(mesas[0]), 'ocupada');
  assert.equal(await stock(), stockAntes, 'el stock se descuenta al cerrar, no en cada parte');

  const [, r2] = await cobrar(p.id, { pagos: [{ metodo: 'tarjeta', monto: 1000 }] });
  assert.deepEqual([r2.cerrado, r2.saldo], [false, 1000]);
  const [, r3] = await cobrar(p.id, { pagos: [{ metodo: 'mercadopago', monto: 1000 }] });
  assert.deepEqual([r3.cerrado, r3.saldo], [true, 0]);

  const [{ estado, metodo_pago }] = await s.q('SELECT estado, metodo_pago FROM pedidos WHERE id = ?', [p.id]);
  assert.deepEqual([estado, metodo_pago], ['pagado', 'mixto']);
  assert.equal(await estadoMesa(mesas[0]), 'libre');
  assert.equal(stockAntes - await stock(), 3);
  const pagos = await s.q('SELECT metodo, monto FROM pagos WHERE pedido_id = ? ORDER BY id', [p.id]);
  assert.deepEqual(pagos.map(x => [x.metodo, x.monto]), [['efectivo', 1000], ['tarjeta', 1000], ['mercadopago', 1000]]);
});

test('pago mixto en un paso: efectivo con vuelto + tarjeta', async () => {
  const p = await pedidoMesa(mesas[1]); // 3000
  const [st, r] = await cobrar(p.id, { pagos: [
    { metodo: 'efectivo', monto: 1800, recibido: 2000 },
    { metodo: 'tarjeta', monto: 1200, referencia: 'cupón 123' }
  ] });
  assert.equal(st, 200);
  assert.deepEqual([r.cerrado, r.vuelto, r.cobrado], [true, 200, 3000]);
  assert.equal((await cobrar(p.id, { pagos: [{ metodo: 'efectivo', monto: 1 }] }))[0], 409, 'ya cobrado');
});

test('no se cobra de más: ni por monto ni con pagos simultáneos', async () => {
  const p = await pedidoMesa(mesas[2], 2); // 2000
  assert.equal((await cobrar(p.id, { pagos: [{ metodo: 'tarjeta', monto: 2500 }] }))[0], 400);
  const res = await Promise.all(Array.from({ length: 6 }, () => cobrar(p.id, { pagos: [{ metodo: 'tarjeta', monto: 2000 }] })));
  assert.equal(res.filter(([st]) => st === 200).length, 1);
  const [{ suma }] = await s.q('SELECT SUM(monto) suma FROM pagos WHERE pedido_id = ?', [p.id]);
  assert.equal(suma, 2000);
});

test('datos inválidos se rechazan sin cobrar nada', async () => {
  const p = await pedidoMesa(mesas[3], 1);
  for (const body of [{}, { pagos: [] }, { pagos: [{ metodo: 'bitcoin', monto: 100 }] }, { pagos: [{ metodo: 'efectivo', monto: -5 }] },
    { pagos: [{ metodo: 'efectivo', monto: 500, recibido: 100 }] },
    { pagos: [{ metodo: 'efectivo', monto: 1000 }], factura: { tipo_comprobante: 1, cuit_receptor: '123' } }]) {
    assert.equal((await cobrar(p.id, body))[0], 400, JSON.stringify(body));
  }
  assert.equal((await s.q('SELECT COUNT(*) c FROM pagos WHERE pedido_id = ?', [p.id]))[0].c, 0);
  assert.equal((await cobrar(999999, { pagos: [{ metodo: 'efectivo', monto: 1 }] }))[0], 404);
});

test('con una parte cobrada: no se cancela, el descuento no baja de lo cobrado y /pagar cobra solo el saldo', async () => {
  const p = await pedidoMesa(mesas[3], 3); // 3000
  await cobrar(p.id, { pagos: [{ metodo: 'efectivo', monto: 2000 }] });
  assert.equal((await s.llamar('PUT', `/api/pedidos/${p.id}/cancelar`, {}, s.tokenVendedor))[0], 400);
  assert.equal((await s.llamar('PUT', `/api/pedidos/${p.id}/descuento`, { descuento: 1500 }, s.tokenVendedor))[0], 400);
  const [{ total }] = await s.q('SELECT total FROM pedidos WHERE id = ?', [p.id]);
  assert.equal(total, 3000, 'el descuento rechazado no quedó guardado');
  const [st, r] = await s.llamar('POST', `/api/pedidos/${p.id}/pagar`, { metodo: 'efectivo', monto: 1500 }, s.tokenVendedor);
  assert.equal(st, 200);
  assert.equal(r.vuelto, 500);
  const [{ suma }] = await s.q('SELECT SUM(monto) suma FROM pagos WHERE pedido_id = ?', [p.id]);
  assert.equal(suma, 3000);
});

test('propina al cobrar: se suma al total del pedido', async () => {
  const p = await pedidoMesa(mesas[4], 2); // 2000
  assert.equal((await cobrar(p.id, { propina: 200, pagos: [{ metodo: 'tarjeta', monto: 2000 }] }))[1].saldo, 200);
  const [, r] = await cobrar(p.id, { pagos: [{ metodo: 'tarjeta', monto: 200 }] });
  assert.equal(r.cerrado, true);
  const [ped] = await s.q('SELECT propina, total FROM pedidos WHERE id = ?', [p.id]);
  assert.deepEqual([ped.propina, ped.total], [200, 2200]);
});

test('factura en el mismo paso: si AFIP falla, el cobro queda hecho y se avisa', async () => {
  const p = await pedidoMesa(mesas[5], 1);
  const [st, r] = await cobrar(p.id, { pagos: [{ metodo: 'tarjeta', monto: 1000 }], factura: { tipo_comprobante: 6 } });
  assert.equal(st, 200);
  assert.equal(r.cerrado, true);
  assert.equal(r.factura.ok, false);
  assert.match(r.factura.error, /no está activa/);
  assert.equal((await s.q('SELECT estado FROM pedidos WHERE id = ?', [p.id]))[0].estado, 'pagado');
});

test('mozos: cobran sus mesas solo si está activado, y nunca mostrador ni delivery', async () => {
  const p = await pedidoMesa(mesas[0], 1, tokenMozo);
  const pagoMozo = { pagos: [{ metodo: 'efectivo', monto: 1000 }] };
  assert.equal((await cobrar(p.id, pagoMozo, tokenMozo))[0], 403, 'apagado por defecto');
  assert.equal((await s.llamar('POST', '/api/integraciones/afip/facturar', { pedido_id: p.id, tipo_comprobante: 6 }, tokenMozo))[0], 403);

  const [stCfg] = await s.llamar('PUT', '/api/config', { mozo_cobra_mesa: 1 }, s.tokenAdmin);
  assert.equal(stCfg, 200);
  const [st, r] = await cobrar(p.id, pagoMozo, tokenMozo);
  assert.equal(st, 200);
  assert.equal(r.cerrado, true);

  const [, llevar] = await s.llamar('POST', '/api/pedidos', { tipo: 'takeaway', items: [{ producto_id: prod.id, cantidad: 1 }] }, tokenMozo);
  assert.equal((await cobrar(llevar.id, pagoMozo, tokenMozo))[0], 403);
  assert.equal((await s.llamar('POST', `/api/integraciones/mercadopago/link/${llevar.id}`, {}, tokenMozo))[0], 403);
  // Lo de siempre sigue reservado a la caja
  assert.equal((await s.llamar('POST', `/api/pedidos/${llevar.id}/pagar`, { metodo: 'efectivo', monto: 1000 }, tokenMozo))[0], 403);
  assert.equal((await s.llamar('PUT', `/api/pedidos/${llevar.id}/descuento`, { descuento: 100 }, tokenMozo))[0], 403);
  await s.llamar('PUT', '/api/config', { mozo_cobra_mesa: 0 }, s.tokenAdmin);
});

test('el arqueo de caja cuenta cada parte en su medio de pago y el efectivo esperado', async () => {
  assert.equal((await s.llamar('POST', '/api/caja/abrir', { monto_inicial: 5000 }, s.tokenVendedor))[0], 201);
  // El arqueo toma los cobros por horario: se compara contra lo que ya mostraba al abrir
  const resumen = async () => (await s.llamar('GET', '/api/caja/estado', null, s.tokenVendedor))[1].resumen;
  const de = (r, m) => (r.por_metodo.find(x => x.metodo === m) || { total: 0 }).total;
  const antes = await resumen();
  const p = await pedidoMesa(mesas[1], 3); // 3000
  await cobrar(p.id, { pagos: [{ metodo: 'efectivo', monto: 1000, recibido: 2000 }] });
  await cobrar(p.id, { pagos: [{ metodo: 'tarjeta', monto: 2000 }] });
  const despues = await resumen();
  assert.equal(de(despues, 'efectivo') - de(antes, 'efectivo'), 1000, 'entra lo cobrado, no lo recibido (el vuelto sale de la caja)');
  assert.equal(de(despues, 'tarjeta') - de(antes, 'tarjeta'), 2000);
  assert.equal(despues.efectivo_esperado - antes.efectivo_esperado, 1000);
});

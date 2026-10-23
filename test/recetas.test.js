// Recetas: costo del plato por sus ingredientes y descuento de stock de los ingredientes al vender
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciarServidor } = require('./helpers');

let s, pan, carne, queso, hamburguesa, gaseosa;
const crear = async (datos) => {
  const [st, r] = await s.llamar('POST', '/api/productos', { categoria_id: 1, ...datos }, s.tokenAdmin);
  assert.equal(st, 201, JSON.stringify(r));
  return r.id;
};
const prod = async id => (await s.q('SELECT * FROM productos WHERE id = ?', [id]))[0];
const receta = (id, lineas, token = s.tokenAdmin) => s.llamar('PUT', `/api/productos/${id}/receta`, { lineas }, token);
const vender = async (items) => {
  const [, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'takeaway', items }, s.tokenVendedor);
  const [{ total }] = await s.q('SELECT total FROM pedidos WHERE id = ?', [p.id]);
  assert.equal((await s.llamar('POST', `/api/pedidos/${p.id}/pagar`, { metodo: 'efectivo', monto: total }, s.tokenVendedor))[0], 200);
  return p;
};

before(async () => {
  s = await iniciarServidor();
  pan = await crear({ nombre: 'Pan de hamburguesa', precio_venta: 0, costo: 150, tracking_stock: 1, stock_actual: 100, unidad: 'unidad' });
  carne = await crear({ nombre: 'Carne picada', precio_venta: 0, costo: 8000, tracking_stock: 1, stock_actual: 10, unidad: 'kg' });
  queso = await crear({ nombre: 'Queso cheddar', precio_venta: 0, costo: 12000, tracking_stock: 1, stock_actual: 5, unidad: 'kg' });
  hamburguesa = await crear({ nombre: 'Hamburguesa completa', precio_venta: 6000, costo: 999, tracking_stock: 1, stock_actual: 50, es_plato: 1 });
  gaseosa = await crear({ nombre: 'Gaseosa lata', precio_venta: 1500, costo: 600, tracking_stock: 1, stock_actual: 24 });
});
after(async () => { await s.cerrar(); });

test('receta: costo del plato = suma de ingredientes, con margen; el mismo ingrediente dos veces se suma', async () => {
  const [st, r] = await receta(hamburguesa, [
    { ingrediente_id: pan, cantidad: 1 },
    { ingrediente_id: carne, cantidad: 0.1 },
    { ingrediente_id: carne, cantidad: 0.05 },
    { ingrediente_id: queso, cantidad: 0.03 }
  ]);
  assert.equal(st, 200, JSON.stringify(r));
  // 150 + 0.15 kg * 8000 + 0.03 kg * 12000 = 150 + 1200 + 360
  assert.equal(r.costo, 1710);
  assert.equal(r.lineas.length, 3);
  assert.equal((await prod(hamburguesa)).costo, 1710);
  const [, g] = await s.llamar('GET', `/api/productos/${hamburguesa}/receta`, null, s.tokenAdmin);
  assert.equal(g.margen, 71.5);
  assert.deepEqual(g.lineas.map(l => [l.nombre, l.cantidad, l.unidad]),
    [['Pan de hamburguesa', 1, 'unidad'], ['Carne picada', 0.15, 'kg'], ['Queso cheddar', 0.03, 'kg']]);
});

test('vender un plato con receta descuenta los ingredientes (no el plato); sin receta, como siempre', async () => {
  const antes = { pan: (await prod(pan)).stock_actual, carne: (await prod(carne)).stock_actual,
    queso: (await prod(queso)).stock_actual, hamb: (await prod(hamburguesa)).stock_actual, gas: (await prod(gaseosa)).stock_actual };
  const p = await vender([{ producto_id: hamburguesa, cantidad: 2 }, { producto_id: gaseosa, cantidad: 3 }]);
  assert.equal(antes.pan - (await prod(pan)).stock_actual, 2);
  assert.ok(Math.abs(antes.carne - (await prod(carne)).stock_actual - 0.3) < 1e-9);
  assert.ok(Math.abs(antes.queso - (await prod(queso)).stock_actual - 0.06) < 1e-9);
  assert.equal((await prod(hamburguesa)).stock_actual, antes.hamb, 'el plato no tiene stock propio');
  assert.equal(antes.gas - (await prod(gaseosa)).stock_actual, 3);
  const movs = await s.q("SELECT producto_id, cantidad, motivo FROM movimientos_stock WHERE motivo LIKE ? ORDER BY id", [`%${p.numero_pedido}%`]);
  assert.equal(movs.length, 4);
  assert.match(movs.find(m => m.producto_id === carne).motivo, /2 x Hamburguesa completa/);
});

test('el stock no se descuenta hasta cobrar, ni dos veces con pagos en partes', async () => {
  const [, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'salon', mesa_id: 1, items: [{ producto_id: hamburguesa, cantidad: 1 }] }, s.tokenVendedor);
  const panAntes = (await prod(pan)).stock_actual;
  await s.llamar('POST', `/api/pedidos/${p.id}/cobro`, { pagos: [{ metodo: 'efectivo', monto: 3000 }] }, s.tokenVendedor);
  assert.equal((await prod(pan)).stock_actual, panAntes);
  await s.llamar('POST', `/api/pedidos/${p.id}/cobro`, { pagos: [{ metodo: 'tarjeta', monto: 3000 }] }, s.tokenVendedor);
  assert.equal(panAntes - (await prod(pan)).stock_actual, 1);
});

test('si sube el costo de un ingrediente, se actualiza el costo del plato; el costo del plato no se pisa a mano', async () => {
  assert.equal((await s.llamar('PUT', `/api/productos/${carne}`, { costo: 10000 }, s.tokenAdmin))[0], 200);
  assert.equal((await prod(hamburguesa)).costo, 150 + 1500 + 360);
  await s.llamar('PUT', `/api/productos/${hamburguesa}`, { costo: 1, precio_venta: 6500 }, s.tokenAdmin);
  const h = await prod(hamburguesa);
  assert.deepEqual([h.costo, h.precio_venta], [2010, 6500]);
});

test('validaciones: sin recetas anidadas, sin sí mismo, ingredientes activos y cantidades válidas', async () => {
  for (const [lineas, error] of [
    [[{ ingrediente_id: gaseosa, cantidad: 1 }], /sí mismo/],
    [[{ ingrediente_id: 999999, cantidad: 1 }], /no existe/],
    [[{ ingrediente_id: pan, cantidad: 0 }], /Cantidad/],
    [[{ ingrediente_id: pan, cantidad: 'mucho' }], /Cantidad/]
  ]) {
    const [st, r] = await receta(gaseosa, lineas);
    assert.equal(st, 400);
    assert.match(r.error, error);
  }
  // La hamburguesa tiene receta: no puede ser ingrediente; el pan es ingrediente: no puede tener receta
  assert.match((await receta(gaseosa, [{ ingrediente_id: hamburguesa, cantidad: 1 }]))[1].error, /receta propia/);
  assert.match((await receta(pan, [{ ingrediente_id: queso, cantidad: 0.01 }]))[1].error, /ingrediente de otra receta/);
  assert.equal((await s.q('SELECT COUNT(*) c FROM recetas WHERE plato_id = ?', [gaseosa]))[0].c, 0, 'nada guardado a medias');
});

test('quitar la receta vuelve al stock del producto; permisos', async () => {
  const [st, r] = await receta(hamburguesa, []);
  assert.deepEqual([st, r.message], [200, 'Receta quitada']);
  const antes = (await prod(hamburguesa)).stock_actual;
  await vender([{ producto_id: hamburguesa, cantidad: 1 }]);
  assert.equal(antes - (await prod(hamburguesa)).stock_actual, 1);
  assert.equal((await receta(hamburguesa, [{ ingrediente_id: pan, cantidad: 1 }], s.tokenVendedor))[0], 403, 'el cajero no edita recetas');
  assert.equal((await s.llamar('GET', `/api/productos/${hamburguesa}/receta`, null, s.tokenVendedor))[0], 403);
});

test('contabilidad: el costo teórico de lo vendido usa el costo de la receta', async () => {
  await receta(hamburguesa, [{ ingrediente_id: pan, cantidad: 2 }]); // costo 300
  const desde = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
  const [st0, antes] = await s.llamar('GET', `/api/contabilidad/resultados?desde=${desde}&hasta=${desde}`, null, s.tokenAdmin);
  assert.equal(st0, 200, JSON.stringify(antes));
  await vender([{ producto_id: hamburguesa, cantidad: 3 }]);
  const [, despues] = await s.llamar('GET', `/api/contabilidad/resultados?desde=${desde}&hasta=${desde}`, null, s.tokenAdmin);
  const teorico = r => JSON.stringify(r).match(/"costo_teorico":([\d.]+)/);
  assert.ok(teorico(despues), 'el estado de resultados informa el costo teórico');
  assert.equal(Number(teorico(despues)[1]) - Number(teorico(antes)[1]), 900);
});

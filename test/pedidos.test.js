const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciarServidor } = require('./helpers');

let s, prod, prod2;
before(async () => {
  s = await iniciarServidor();
  [prod, prod2] = await s.q('SELECT id FROM productos WHERE activo = 1 ORDER BY id LIMIT 2');
  await s.q('UPDATE productos SET precio_venta = 1000, tracking_stock = 1, stock_actual = 100 WHERE id IN (?, ?)', [prod.id, prod2.id]);
});
after(async () => { await s.cerrar(); });

const crearPedido = (items, extra = {}) => s.llamar('POST', '/api/pedidos', { tipo: 'takeaway', items, ...extra }, s.tokenVendedor);
const contar = async tabla => (await s.q(`SELECT COUNT(*) c FROM ${tabla}`))[0].c;

test('el precio sale de la base, no del navegador', async () => {
  const [st, p] = await crearPedido([{ producto_id: prod.id, cantidad: 2, precio: 1 }]);
  assert.equal(st, 201);
  assert.equal(p.total, 2000);
});

test('un pedido inválido no deja nada guardado a medias', async () => {
  const antes = [await contar('pedidos'), await contar('pedido_items')];
  const [{ valor: seq }] = await s.q("SELECT valor FROM secuencias WHERE nombre = 'pedido'");
  const [st] = await crearPedido([{ producto_id: prod.id, cantidad: 1 }, { producto_id: 999999, cantidad: 1 }]);
  assert.equal(st, 400);
  assert.deepEqual([await contar('pedidos'), await contar('pedido_items')], antes);
  assert.equal((await s.q("SELECT valor FROM secuencias WHERE nombre = 'pedido'"))[0].valor, seq);
});

test('pedidos simultáneos: números únicos y totales correctos', async () => {
  const res = await Promise.all(Array.from({ length: 20 }, () => crearPedido([{ producto_id: prod.id, cantidad: 2 }])));
  assert.ok(res.every(([st]) => st === 201));
  assert.equal(new Set(res.map(([, p]) => p.numero_pedido)).size, 20);
  assert.ok(res.every(([, p]) => p.total === 2000));
});

test('cobro: monto insuficiente, vuelto y sin cobros duplicados', async () => {
  const [, p] = await crearPedido([{ producto_id: prod.id, cantidad: 2 }]);
  const pagar = monto => s.llamar('POST', `/api/pedidos/${p.id}/pagar`, { metodo: 'efectivo', monto }, s.tokenVendedor);
  assert.equal((await pagar(100))[0], 400);

  const [{ s: stockAntes }] = await s.q('SELECT stock_actual s FROM productos WHERE id = ?', [prod.id]);
  const res = await Promise.all(Array.from({ length: 10 }, () => pagar(3000)));
  const aceptados = res.filter(([st]) => st === 200);
  assert.equal(aceptados.length, 1);
  assert.equal(aceptados[0][1].vuelto, 1000);

  const pagos = await s.q('SELECT monto FROM pagos WHERE pedido_id = ?', [p.id]);
  assert.deepEqual(pagos.map(x => x.monto), [2000]);
  const [{ s: stockDespues }] = await s.q('SELECT stock_actual s FROM productos WHERE id = ?', [prod.id]);
  assert.equal(stockAntes - stockDespues, 2);

  assert.ok((await s.llamar('PUT', `/api/pedidos/${p.id}/cancelar`, {}, s.tokenVendedor))[0] >= 400, 'un pedido cobrado no se cancela');
});

test('agregar ítems y descuento recalculan el total', async () => {
  const [, p] = await crearPedido([{ producto_id: prod.id, cantidad: 1 }]);
  assert.equal((await s.llamar('POST', `/api/pedidos/${p.id}/items`, { producto_id: prod2.id, cantidad: 3, precio: 1 }, s.tokenVendedor))[0], 201);
  const [, conDesc] = await s.llamar('PUT', `/api/pedidos/${p.id}/descuento`, { descuento: 500 }, s.tokenVendedor);
  assert.equal(conDesc.total, 3500);
});

test('movimiento de stock numérico y validado', async () => {
  const [{ s: antes }] = await s.q('SELECT stock_actual s FROM productos WHERE id = ?', [prod2.id]);
  const [st, r] = await s.llamar('POST', '/api/stock/movimiento', { producto_id: prod2.id, tipo: 'entrada', cantidad: '5' }, s.tokenVendedor);
  assert.equal(st, 200);
  assert.equal(r.nuevo_stock, antes + 5);
  assert.equal((await s.llamar('POST', '/api/stock/movimiento', { producto_id: prod2.id, tipo: 'entrada', cantidad: 'abc' }, s.tokenVendedor))[0], 400);
});

// Encontrados por la prueba de fuego (npm run prueba:fuego): faltaban estos tests
test('cantidades inválidas se rechazan (negativas, cero, texto o exageradas)', async () => {
  for (const cantidad of [-1, 0, 'dos', 1001]) {
    const [st] = await crearPedido([{ producto_id: prod.id, cantidad }]);
    assert.equal(st, 400, `cantidad ${cantidad}`);
  }
});

test('el descuento nunca deja el total negativo ni supera el subtotal', async () => {
  const [st, p] = await crearPedido([{ producto_id: prod.id, cantidad: 1 }], { descuento: 5000 });
  assert.equal(st, 201);
  const [, ped] = await s.llamar('GET', `/api/pedidos/${p.id}`, undefined, s.tokenVendedor);
  assert.equal(ped.subtotal, 1000);
  assert.equal(ped.descuento, 1000, 'el descuento se limita al subtotal');
  assert.equal(ped.total, 0);
});

// Pedido desde el QR de la mesa: el cliente pide, llama al mozo o pide la cuenta;
// el mozo confirma (va a cocina), corrige o rechaza. También el modo directo y solo carta.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciarServidor } = require('./helpers');

let s, mozo, mesa, prod, prod2;
const publico = (metodo, ruta, body) => s.llamar(metodo, `/api/publico/mesa/${mesa.qr_token}${ruta}`, body);
const pedir = (items, extra = {}) => publico('POST', '/pedido', { items, ...extra });

before(async () => {
  s = await iniciarServidor();
  const hash = require('bcryptjs').hashSync('mozo1234', 4);
  await s.q("INSERT INTO usuarios (nombre, email, password, rol, debe_cambiar_password) VALUES ('Mozo QR', 'mozo-qr@test.com', ?, 'mozo', 0)", [hash]);
  mozo = s.token((await s.q("SELECT id FROM usuarios WHERE email = 'mozo-qr@test.com'"))[0].id);
  [mesa] = await s.q("SELECT id, nombre, qr_token FROM mesas WHERE estado = 'libre' ORDER BY id LIMIT 1");
  [prod, prod2] = await s.q('SELECT id, precio_venta FROM productos WHERE activo = 1 AND precio_venta > 0 ORDER BY id LIMIT 2');
});
after(() => s.cerrar());

test('cada mesa tiene su QR; uno inventado no sirve', async () => {
  assert.match(mesa.qr_token, /^[a-f0-9]{24}$/);
  const [{ n }] = await s.q('SELECT COUNT(*) n FROM mesas WHERE qr_token IS NULL');
  assert.equal(n, 0);
  assert.equal((await s.llamar('GET', '/api/publico/mesa/' + 'a'.repeat(24)))[0], 404);
  assert.equal((await s.llamar('GET', `/api/publico/mesa/${mesa.id}`))[0], 404, 'con el número de mesa no alcanza');
  const [st, est] = await publico('GET', '');
  assert.equal(st, 200);
  assert.deepEqual([est.mesa.nombre, est.modo, est.cuenta], [mesa.nombre, 'confirmar', null]);
});

test('el pedido espera al mozo; al confirmarlo abre la mesa y va a cocina con precios de la base', async () => {
  const [st, sol] = await pedir([{ producto_id: prod.id, cantidad: 2, precio: 1, notas: 'sin sal' }], { cliente: 'Ana', notas: 'cumpleaños' });
  assert.equal(st, 201, JSON.stringify(sol));
  assert.equal(sol.estado, 'pendiente');
  assert.equal(sol.items[0].precio, prod.precio_venta, 'el precio no sale del celular');
  assert.equal((await s.q("SELECT COUNT(*) n FROM pedidos WHERE mesa_id = ? AND estado = 'abierto'", [mesa.id]))[0].n, 0, 'todavía no hay pedido');

  const [, pendientes] = await s.llamar('GET', '/api/mesas/solicitudes', null, mozo);
  assert.deepEqual(pendientes.map(p => [p.id, p.mesa_nombre, p.tipo]), [[sol.id, mesa.nombre, 'pedido']]);
  const [, mesas] = await s.llamar('GET', '/api/mesas', null, mozo);
  assert.equal(mesas.find(m => m.id === mesa.id).solicitudes_pendientes, 1);
  assert.equal(mesas[0].qr_token, undefined, 'la lista de mesas no expone el QR');

  const [stC, conf] = await s.llamar('POST', `/api/mesas/solicitudes/${sol.id}/confirmar`, {}, mozo);
  assert.equal(stC, 200, JSON.stringify(conf));
  const [ped] = await s.q('SELECT * FROM pedidos WHERE id = ?', [conf.pedido_id]);
  assert.deepEqual([ped.estado, ped.mesa_id, ped.origen, ped.total, ped.cliente, ped.notas], ['abierto', mesa.id, 'qr_mesa', prod.precio_venta * 2, 'Ana', 'cumpleaños']);
  const [item] = await s.q('SELECT * FROM pedido_items WHERE pedido_id = ?', [ped.id]);
  assert.deepEqual([item.cantidad, item.notas], [2, 'sin sal']);
  assert.equal((await s.q('SELECT estado FROM mesas WHERE id = ?', [mesa.id]))[0].estado, 'ocupada');
  assert.equal((await s.llamar('POST', `/api/mesas/solicitudes/${sol.id}/confirmar`, {}, mozo))[0], 409, 'no se confirma dos veces');

  const [, est] = await publico('GET', '');
  assert.equal(est.solicitudes[0].estado, 'confirmada');
  assert.equal(est.cuenta.total, prod.precio_venta * 2);
});

test('un segundo pedido se suma al pedido abierto; el mozo puede corregirlo', async () => {
  const [, sol] = await pedir([{ producto_id: prod2.id, cantidad: 5 }]);
  const [st] = await s.llamar('POST', `/api/mesas/solicitudes/${sol.id}/confirmar`, { items: [{ producto_id: prod2.id, cantidad: 1 }] }, mozo);
  assert.equal(st, 200);
  const abiertos = await s.q("SELECT id, total FROM pedidos WHERE mesa_id = ? AND estado = 'abierto'", [mesa.id]);
  assert.equal(abiertos.length, 1, 'sigue habiendo un solo pedido por mesa');
  assert.equal(abiertos[0].total, prod.precio_venta * 2 + prod2.precio_venta);
});

test('dos mozos confirmando a la vez: el pedido entra una sola vez', async () => {
  const [, sol] = await pedir([{ producto_id: prod.id, cantidad: 1 }]);
  const antes = (await s.q('SELECT COUNT(*) n FROM pedido_items'))[0].n;
  const r = await Promise.all([1, 2].map(() => s.llamar('POST', `/api/mesas/solicitudes/${sol.id}/confirmar`, {}, mozo)));
  assert.deepEqual(r.map(x => x[0]).sort(), [200, 409]);
  assert.equal((await s.q('SELECT COUNT(*) n FROM pedido_items'))[0].n, antes + 1);
});

test('rechazar: no llega a cocina y el cliente ve el motivo', async () => {
  const [, sol] = await pedir([{ producto_id: prod.id, cantidad: 1 }]);
  const antes = (await s.q('SELECT COUNT(*) n FROM pedido_items'))[0].n;
  assert.equal((await s.llamar('POST', `/api/mesas/solicitudes/${sol.id}/rechazar`, { motivo: 'Se terminó' }, mozo))[0], 200);
  assert.equal((await s.q('SELECT COUNT(*) n FROM pedido_items'))[0].n, antes);
  const [, est] = await publico('GET', '');
  const r = est.solicitudes.find(x => x.id === sol.id);
  assert.deepEqual([r.estado, r.motivo], ['rechazada', 'Se terminó']);
});

test('llamar al mozo y pedir la cuenta: sin duplicados hasta que se atienden', async () => {
  const [, a] = await publico('POST', '/llamar', { tipo: 'mozo' });
  const [, b] = await publico('POST', '/llamar', { tipo: 'mozo' });
  assert.equal(a.id, b.id);
  const [, c] = await publico('POST', '/llamar', { tipo: 'cuenta' });
  assert.notEqual(c.id, a.id);
  assert.equal((await publico('POST', '/llamar', { tipo: 'otra' }))[0], 400);
  assert.equal((await s.llamar('POST', `/api/mesas/solicitudes/${a.id}/confirmar`, {}, mozo))[0], 400, 'un llamado no se confirma como pedido');
  assert.equal((await s.llamar('POST', `/api/mesas/solicitudes/${a.id}/atender`, {}, mozo))[0], 200);
  assert.equal((await s.llamar('POST', `/api/mesas/solicitudes/${c.id}/atender`, {}, mozo))[0], 200);
  const [, d] = await publico('POST', '/llamar', { tipo: 'mozo' });
  assert.notEqual(d.id, a.id, 'después de atendido se puede volver a llamar');
  await s.llamar('POST', `/api/mesas/solicitudes/${d.id}/atender`, {}, mozo);
});

test('topes: cantidades, productos inexistentes y pedidos sin confirmar acumulados', async () => {
  assert.equal((await pedir([]))[0], 400);
  assert.equal((await pedir([{ producto_id: prod.id, cantidad: 21 }]))[0], 400);
  assert.equal((await pedir([{ producto_id: 999999, cantidad: 1 }]))[0], 400);
  for (let i = 0; i < 3; i++) assert.equal((await pedir([{ producto_id: prod.id, cantidad: 1 }]))[0], 201);
  const [st, r] = await pedir([{ producto_id: prod.id, cantidad: 1 }]);
  assert.equal(st, 429);
  assert.match(r.error, /esperando al mozo/);
  for (const p of (await s.llamar('GET', '/api/mesas/solicitudes', null, mozo))[1])
    if (p.tipo === 'pedido') await s.llamar('POST', `/api/mesas/solicitudes/${p.id}/rechazar`, {}, mozo);
});

test('permisos: sin sesión o con cocina no se confirman pedidos', async () => {
  const [, sol] = await pedir([{ producto_id: prod.id, cantidad: 1 }]);
  assert.equal((await s.llamar('POST', `/api/mesas/solicitudes/${sol.id}/confirmar`, {}))[0], 401);
  const hash = require('bcryptjs').hashSync('cocina1234', 4);
  await s.q("INSERT INTO usuarios (nombre, email, password, rol, debe_cambiar_password) VALUES ('Cocina QR', 'cocina-qr@test.com', ?, 'cocina', 0)", [hash]);
  const cocina = s.token((await s.q("SELECT id FROM usuarios WHERE email = 'cocina-qr@test.com'"))[0].id);
  assert.equal((await s.llamar('POST', `/api/mesas/solicitudes/${sol.id}/confirmar`, {}, cocina))[0], 403);
  assert.equal((await s.llamar('GET', '/api/mesas/qr?base=http://192.168.0.10:3000', null, mozo))[0], 403, 'los QR los maneja el admin');
  await s.llamar('POST', `/api/mesas/solicitudes/${sol.id}/rechazar`, {}, mozo);
});

test('modo directo: el pedido va a cocina sin esperar; solo carta: no se puede pedir', async () => {
  assert.equal((await s.llamar('PUT', '/api/config', { qr_mesa_modo: 'cualquiera' }, s.tokenAdmin))[0], 400);
  const [otra] = await s.q("SELECT id, qr_token FROM mesas WHERE estado = 'libre' ORDER BY id LIMIT 1");
  try {
    await s.llamar('PUT', '/api/config', { qr_mesa_modo: 'directo' }, s.tokenAdmin);
    const [st, sol] = await s.llamar('POST', `/api/publico/mesa/${otra.qr_token}/pedido`, { items: [{ producto_id: prod.id, cantidad: 1 }] });
    assert.equal(st, 201, JSON.stringify(sol));
    assert.equal(sol.estado, 'confirmada');
    assert.equal((await s.q("SELECT COUNT(*) n FROM pedidos WHERE mesa_id = ? AND estado = 'abierto'", [otra.id]))[0].n, 1);

    await s.llamar('PUT', '/api/config', { qr_mesa_modo: 'solo_carta' }, s.tokenAdmin);
    assert.equal((await s.llamar('POST', `/api/publico/mesa/${otra.qr_token}/pedido`, { items: [{ producto_id: prod.id, cantidad: 1 }] }))[0], 403);
    assert.equal((await s.llamar('POST', `/api/publico/mesa/${otra.qr_token}/llamar`, { tipo: 'mozo' }))[0], 201, 'llamar al mozo sigue andando');
  } finally {
    await s.llamar('PUT', '/api/config', { qr_mesa_modo: 'confirmar' }, s.tokenAdmin);
  }
});

test('QR para imprimir y QR nuevo: el anterior deja de funcionar', async () => {
  assert.equal((await s.llamar('GET', '/api/mesas/qr?base=javascript:alert(1)', null, s.tokenAdmin))[0], 400);
  const [st, qrs] = await s.llamar('GET', '/api/mesas/qr?base=http://192.168.0.10:3000', null, s.tokenAdmin);
  assert.equal(st, 200);
  const q = qrs.find(x => x.id === mesa.id);
  assert.equal(q.url, `http://192.168.0.10:3000/pedido.html?mesa=${mesa.qr_token}`);
  assert.match(q.svg, /^<svg/);
  assert.equal((await s.llamar('POST', `/api/mesas/${mesa.id}/qr`, {}, s.tokenAdmin))[0], 200);
  assert.equal((await publico('GET', ''))[0], 404, 'el QR viejo ya no abre la mesa');
  [mesa] = await s.q('SELECT id, nombre, qr_token FROM mesas WHERE id = ?', [mesa.id]);
  assert.equal((await publico('GET', ''))[0], 200);
  // Una mesa nueva ya trae su QR
  const [, nueva] = await s.llamar('POST', '/api/mesas', { nombre: 'Mesa QR nueva' }, s.tokenAdmin);
  assert.match((await s.q('SELECT qr_token FROM mesas WHERE id = ?', [nueva.id]))[0].qr_token, /^[a-f0-9]{24}$/);
});

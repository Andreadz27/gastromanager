// Fidelización: puntos (ganar, canjear, devolver al cancelar, ajustes), cupones (vigencia, mínimo, usos)
// y gift cards (venta desde la caja, pago con saldo, sin usarla dos veces) con sus asientos contables.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciarServidor } = require('./helpers');
const { fechaLocal } = require('../src/tiempo');

let s, mozo, prod, cliente, otroCliente;
const hoy = fechaLocal();

async function pedido(cantidad = 5) {
  const [, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'takeaway', items: [{ producto_id: prod.id, cantidad }] }, s.tokenVendedor);
  return p;
}
const ver = async id => (await s.llamar('GET', `/api/pedidos/${id}`, null, s.tokenVendedor))[1];
const puntosDe = async id => (await s.q('SELECT puntos FROM clientes WHERE id = ?', [id]))[0].puntos;
const cobrar = (id, pagos, extra = {}) => s.llamar('POST', `/api/pedidos/${id}/cobro`, { pagos, ...extra }, s.tokenVendedor);

before(async () => {
  s = await iniciarServidor();
  const hash = require('bcryptjs').hashSync('clave1234', 4);
  await s.q("INSERT INTO usuarios (nombre, email, password, rol, debe_cambiar_password) VALUES ('Mozo F', 'mozo-f@test.com', ?, 'mozo', 0)", [hash]);
  mozo = s.token((await s.q("SELECT id FROM usuarios WHERE email = 'mozo-f@test.com'"))[0].id);
  [prod] = await s.q('SELECT id FROM productos WHERE activo = 1 ORDER BY id LIMIT 1');
  await s.q('UPDATE productos SET precio_venta = 1000 WHERE id = ?', [prod.id]);
  cliente = (await s.llamar('POST', '/api/clientes', { nombre: 'Ana Cliente', telefono: '1155550000' }, s.tokenAdmin))[1].id;
  otroCliente = (await s.llamar('POST', '/api/clientes', { nombre: 'Beto Cliente' }, s.tokenAdmin))[1].id;
});
after(() => s.cerrar());

test('puntos: apagados no suman; prendidos suman por el consumo sin propina', async () => {
  let p = await pedido();
  await s.llamar('PUT', `/api/pedidos/${p.id}/cliente`, { cliente_id: cliente }, mozo);
  assert.equal((await cobrar(p.id, [{ metodo: 'efectivo', monto: 5000 }]))[0], 200);
  assert.equal(await puntosDe(cliente), 0, 'programa apagado');

  assert.equal((await s.llamar('PUT', '/api/config', { puntos_cada: 0 }, s.tokenAdmin))[0], 400);
  await s.llamar('PUT', '/api/config', { puntos_activo: 1, puntos_cada: 1000, puntos_valor: 10, puntos_minimo: 50 }, s.tokenAdmin);
  p = await pedido();
  const [st, r] = await s.llamar('PUT', `/api/pedidos/${p.id}/cliente`, { cliente_id: cliente }, mozo);
  assert.equal(st, 200, JSON.stringify(r));
  assert.equal((await ver(p.id)).cliente, 'Ana Cliente');
  assert.equal((await cobrar(p.id, [{ metodo: 'tarjeta', monto: 5500 }], { propina: 500 }))[0], 200);
  assert.equal(await puntosDe(cliente), 5, '$5000 de consumo (la propina no suma)');
  const [, movs] = await s.llamar('GET', `/api/clientes/${cliente}/puntos`, null, mozo);
  assert.deepEqual(movs.map(m => [m.tipo, m.puntos]), [['gana', 5]]);
});

test('los puntos no se editan a mano: solo con un ajuste del encargado, con motivo', async () => {
  await s.llamar('PUT', `/api/clientes/${cliente}`, { nombre: 'Ana Cliente', puntos: 99999 }, mozo);
  assert.equal(await puntosDe(cliente), 5, 'el campo puntos se ignora');
  assert.equal((await s.llamar('POST', `/api/clientes/${cliente}/puntos`, { puntos: 100, motivo: 'x' }, mozo))[0], 403);
  assert.equal((await s.llamar('POST', `/api/clientes/${cliente}/puntos`, { puntos: 100 }, s.tokenAdmin))[0], 400, 'sin motivo');
  assert.equal((await s.llamar('POST', `/api/clientes/${cliente}/puntos`, { puntos: -10, motivo: 'x' }, s.tokenAdmin))[0], 400, 'no queda negativo');
  assert.equal((await s.llamar('POST', `/api/clientes/${cliente}/puntos`, { puntos: 100, motivo: 'Cumpleaños' }, s.tokenAdmin))[0], 200);
  assert.equal(await puntosDe(cliente), 105);
});

test('canjear puntos: mínimo, tope del consumo, sacar el canje y devolución al cancelar', async () => {
  const p = await pedido(1); // $1000
  assert.equal((await s.llamar('POST', `/api/pedidos/${p.id}/puntos`, { puntos: 60 }, s.tokenVendedor))[0], 400, 'sin cliente');
  await s.llamar('PUT', `/api/pedidos/${p.id}/cliente`, { cliente_id: cliente }, s.tokenVendedor);
  assert.equal((await s.llamar('POST', `/api/pedidos/${p.id}/puntos`, { puntos: 30 }, s.tokenVendedor))[0], 400, 'menos del mínimo');
  assert.equal((await s.llamar('POST', `/api/pedidos/${p.id}/puntos`, { puntos: 200 }, s.tokenVendedor))[0], 400, 'más de los que tiene');
  const [st, c] = await s.llamar('POST', `/api/pedidos/${p.id}/puntos`, { puntos: 60 }, s.tokenVendedor);
  assert.equal(st, 200, JSON.stringify(c));
  assert.equal(c.descuento, 600);
  let d = await ver(p.id);
  assert.deepEqual([d.total, d.descuento_puntos, d.puntos_canjeados], [400, 600, 60]);
  assert.equal(await puntosDe(cliente), 45);
  assert.equal((await s.llamar('POST', `/api/pedidos/${p.id}/puntos`, { puntos: 50 }, s.tokenVendedor))[0], 409, 'un canje por pedido');
  assert.equal((await s.llamar('PUT', `/api/pedidos/${p.id}/cliente`, { cliente_id: otroCliente }, s.tokenVendedor))[0], 400, 'no se cambia el cliente con canje');

  assert.equal((await s.llamar('DELETE', `/api/pedidos/${p.id}/puntos`, null, s.tokenVendedor))[0], 200);
  assert.equal(await puntosDe(cliente), 105);
  assert.equal((await ver(p.id)).total, 1000);

  // 110 puntos = $1100 > $1000 de consumo: no deja saldo a favor
  await s.llamar('POST', `/api/clientes/${cliente}/puntos`, { puntos: 5, motivo: 'test' }, s.tokenAdmin);
  assert.equal((await s.llamar('POST', `/api/pedidos/${p.id}/puntos`, { puntos: 110 }, s.tokenVendedor))[0], 400);
  await s.llamar('POST', `/api/pedidos/${p.id}/puntos`, { puntos: 100 }, s.tokenVendedor);
  assert.equal((await ver(p.id)).total, 0);
  assert.equal(await puntosDe(cliente), 10);
  assert.equal((await s.llamar('PUT', `/api/pedidos/${p.id}/cancelar`, {}, s.tokenAdmin))[0], 200);
  assert.equal(await puntosDe(cliente), 110, 'cancelado: vuelven los puntos');
});

test('cupones: código único, vigencia, mínimo, una vez por cliente; se libera al cancelar', async () => {
  const nuevo = body => s.llamar('POST', '/api/fidelizacion/cupones', body, s.tokenAdmin);
  assert.equal((await s.llamar('POST', '/api/fidelizacion/cupones', { codigo: 'X', tipo: 'porcentaje', valor: 10 }, mozo))[0], 403);
  assert.equal((await nuevo({ codigo: 'MAL', tipo: 'porcentaje', valor: 150 }))[0], 400);
  const [st, cup] = await nuevo({ codigo: 'bienvenida', tipo: 'porcentaje', valor: 10, minimo: 2000, usos_por_cliente: 1 });
  assert.equal(st, 201, JSON.stringify(cup));
  assert.equal(cup.codigo, 'BIENVENIDA');
  assert.equal((await nuevo({ codigo: 'BIENVENIDA', tipo: 'monto', valor: 100 }))[0], 409);
  await nuevo({ codigo: 'VENCIDO', tipo: 'monto', valor: 100, hasta: fechaLocal(1) });

  const p = await pedido(1);
  assert.equal((await s.llamar('POST', `/api/pedidos/${p.id}/cupon`, { codigo: 'NOEXISTE' }, s.tokenVendedor))[0], 404);
  assert.equal((await s.llamar('POST', `/api/pedidos/${p.id}/cupon`, { codigo: 'vencido' }, s.tokenVendedor))[0], 400);
  assert.equal((await s.llamar('POST', `/api/pedidos/${p.id}/cupon`, { codigo: 'BIENVENIDA' }, s.tokenVendedor))[0], 400, 'menos del mínimo');
  const p2 = await pedido(3);
  assert.equal((await s.llamar('POST', `/api/pedidos/${p2.id}/cupon`, { codigo: 'BIENVENIDA' }, s.tokenVendedor))[0], 400, 'pide cliente');
  await s.llamar('PUT', `/api/pedidos/${p2.id}/cliente`, { cliente_id: otroCliente }, s.tokenVendedor);
  const [stA, a] = await s.llamar('POST', `/api/pedidos/${p2.id}/cupon`, { codigo: 'bienvenida' }, s.tokenVendedor);
  assert.equal(stA, 200, JSON.stringify(a));
  const d = await ver(p2.id);
  assert.deepEqual([d.descuento_cupon, d.total, d.cupon_codigo], [300, 2700, 'BIENVENIDA']);

  const p3 = await pedido(3);
  await s.llamar('PUT', `/api/pedidos/${p3.id}/cliente`, { cliente_id: otroCliente }, s.tokenVendedor);
  assert.equal((await s.llamar('POST', `/api/pedidos/${p3.id}/cupon`, { codigo: 'BIENVENIDA' }, s.tokenVendedor))[0], 400, 'ya lo usó');
  await s.llamar('PUT', `/api/pedidos/${p2.id}/cancelar`, {}, s.tokenAdmin);
  assert.equal((await s.llamar('POST', `/api/pedidos/${p3.id}/cupon`, { codigo: 'BIENVENIDA' }, s.tokenVendedor))[0], 200, 'el cancelado no cuenta');
  const [, lista] = await s.llamar('GET', '/api/fidelizacion/cupones', null, s.tokenAdmin);
  assert.equal(lista.find(c => c.codigo === 'BIENVENIDA').usos, 1);
});

let gift;
test('gift card: se vende desde la caja y se paga con su saldo, sin pasarse ni usarla dos veces', async () => {
  const vender = body => s.llamar('POST', '/api/fidelizacion/gift-cards', body, s.tokenVendedor);
  assert.equal((await s.llamar('POST', '/api/fidelizacion/gift-cards', { monto: 3000, medio: 'efectivo' }, mozo))[0], 403);
  const [stC, c] = await vender({ monto: 3000, medio: 'efectivo' });
  assert.equal(stC, 400, 'sin caja abierta');
  assert.match(c.error, /caja abierta/);
  await s.llamar('POST', '/api/caja/abrir', { monto_inicial: 0 }, s.tokenAdmin);
  const [st, g] = await vender({ monto: 3000, medio: 'efectivo', comprador: 'Carla', destinatario: 'Dani' });
  assert.equal(st, 201, JSON.stringify(g));
  assert.match(g.codigo, /^GM-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  gift = g;
  const [mov] = await s.q('SELECT tipo, monto FROM movimientos_caja WHERE id = ?', [g.caja_movimiento_id]);
  assert.deepEqual([mov.tipo, mov.monto], ['ingreso', 3000]);

  const p = await pedido(1);
  const [stP, r] = await cobrar(p.id, [{ metodo: 'giftcard', monto: 1000, referencia: g.codigo.toLowerCase() }]);
  assert.equal(stP, 200, JSON.stringify(r));
  const [{ referencia }] = await s.q('SELECT referencia FROM pagos WHERE pedido_id = ?', [p.id]);
  assert.equal(referencia, `GC-${g.codigo}`);
  const [, saldo] = await s.llamar('GET', `/api/fidelizacion/gift-cards/${g.codigo}`, null, s.tokenVendedor);
  assert.equal(saldo.saldo, 2000);

  // Más que el saldo: no cobra nada (ni el otro pago)
  const p2 = await pedido(3);
  const [stX, x] = await cobrar(p2.id, [{ metodo: 'efectivo', monto: 500 }, { metodo: 'giftcard', monto: 2500, referencia: g.codigo }]);
  assert.equal(stX, 400);
  assert.match(x.error, /saldo/);
  assert.equal((await s.q('SELECT COUNT(*) n FROM pagos WHERE pedido_id = ?', [p2.id]))[0].n, 0);
  assert.equal((await cobrar(p2.id, [{ metodo: 'giftcard', monto: 3000, referencia: 'GM-NADA-NADA' }]))[0], 400);

  // Dos cajas cobrando a la vez con la misma tarjeta: solo una puede usar el saldo
  const [a, b] = [await pedido(2), await pedido(2)];
  const rs = await Promise.all([a, b].map(x => cobrar(x.id, [{ metodo: 'giftcard', monto: 2000, referencia: g.codigo }])));
  assert.deepEqual(rs.map(x => x[0]).sort(), [200, 400]);
  assert.equal((await s.q('SELECT saldo FROM gift_cards WHERE id = ?', [g.id]))[0].saldo, 0);
});

test('contabilidad: vender la gift card es deuda con el cliente; usarla es venta', async () => {
  const [, libro] = await s.llamar('GET', `/api/contabilidad/libro-diario?desde=${hoy}&hasta=${hoy}`, null, s.tokenAdmin);
  const venta = libro.asientos.find(a => a.concepto === `Venta de gift card ${gift.codigo}`);
  assert.deepEqual(venta.lineas.map(l => [l.codigo, l.debe, l.haber]), [['1.1.01', 3000, 0], ['2.1.04', 0, 3000]]);
  assert.ok(!libro.asientos.some(a => /Caja: Venta de gift card/.test(a.concepto)), 'no se asienta además como ingreso suelto');
  assert.equal(libro.balance.find(c => c.codigo === '2.1.04').saldo, 0, 'se vendieron $3000 y se usaron $3000');
  assert.equal(libro.total_debe, libro.total_haber);
});

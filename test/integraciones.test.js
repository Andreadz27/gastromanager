// Mercado Pago y Tienda Nube contra APIs simuladas (no se usan cuentas reales)
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { iniciarServidor } = require('./helpers');

// API falsa: responde según "rutas" y guarda cada petición recibida
function apiFalsa(rutas) {
  const peticiones = [];
  const server = http.createServer((req, res) => {
    let cuerpo = '';
    req.on('data', d => { cuerpo += d; });
    req.on('end', () => {
      const pet = { metodo: req.method, ruta: req.url, headers: req.headers, body: cuerpo ? JSON.parse(cuerpo) : null };
      peticiones.push(pet);
      const manejador = rutas.find(([m, patron]) => m === req.method && patron.test(req.url));
      const [estado, respuesta] = manejador ? manejador[2](pet) : [404, { message: 'no encontrado' }];
      res.writeHead(estado, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(respuesta));
    });
  });
  return new Promise(ok => server.listen(0, '127.0.0.1', () => ok({
    url: `http://127.0.0.1:${server.address().port}`, peticiones,
    cerrar: () => new Promise(r => server.close(r))
  })));
}

// Estado simulado de Mercado Pago
const pagosMP = {};
let idProductoTN = 1000;
const ordenesTN = {};

let s, mp, tn;
before(async () => {
  mp = await apiFalsa([
    ['GET', /^\/v1\/payment_methods/, pet => pet.headers.authorization === 'Bearer TEST-token-valido' ? [200, []] : [401, { message: 'invalid token' }]],
    ['POST', /^\/checkout\/preferences/, () => [201, { id: 'pref-123', init_point: 'https://mp.test/prod', sandbox_init_point: 'https://mp.test/sandbox' }]],
    ['GET', /^\/v1\/payments\/(\w+)/, pet => {
      const pago = pagosMP[pet.ruta.split('/').pop()];
      return pago ? [200, pago] : [404, { message: 'payment not found' }];
    }]
  ]);
  tn = await apiFalsa([
    ['GET', /^\/1234\/products/, pet => pet.headers.authentication === 'bearer tn-token' ? [200, []] : [401, { description: 'Invalid access token' }]],
    ['POST', /^\/1234\/products$/, pet => { const id = ++idProductoTN; return [201, { id, name: pet.body.name, variants: [{ id: id * 10 }] }]; }],
    ['PUT', /^\/1234\/products\/\d+/, () => [200, {}]],
    ['GET', /^\/1234\/orders\/(\d+)/, pet => {
      const orden = ordenesTN[pet.ruta.split('/').pop()];
      return orden ? [200, orden] : [404, { description: 'Not found' }];
    }]
  ]);
  process.env.GM_MP_API_URL = mp.url;
  process.env.GM_TN_API_URL = tn.url;
  process.env.GM_TN_PAUSA_MS = '0';
  s = await iniciarServidor();
});
after(async () => {
  await s.cerrar();
  await mp.cerrar();
  await tn.cerrar();
});

const [admin, cajero] = [() => s.tokenAdmin, () => s.tokenVendedor];
const pedidoAbierto = async () => {
  const [p] = await s.q('SELECT id FROM productos WHERE activo = 1 AND precio_venta > 0 LIMIT 1');
  const [, pedido] = await s.llamar('POST', '/api/pedidos', { tipo: 'takeaway', items: [{ producto_id: p.id, cantidad: 2 }] }, cajero());
  return pedido;
};

test('Mercado Pago: probar conexión con token válido e inválido', async () => {
  await s.llamar('PUT', '/api/integraciones/config/mercadopago', { access_token: 'TEST-token-malo', activa: true }, admin());
  const [, malo] = await s.llamar('POST', '/api/integraciones/test/mercadopago', undefined, admin());
  assert.equal(malo.ok, false);
  assert.match(malo.message, /401/);
  await s.llamar('PUT', '/api/integraciones/config/mercadopago', { access_token: 'TEST-token-valido', activa: true }, admin());
  const [, bueno] = await s.llamar('POST', '/api/integraciones/test/mercadopago', undefined, admin());
  assert.equal(bueno.ok, true);
});

test('Mercado Pago: link de pago y cobro automático por webhook (idempotente)', async () => {
  const pedido = await pedidoAbierto();
  const [st, link] = await s.llamar('POST', `/api/integraciones/mercadopago/link/${pedido.id}`, undefined, cajero());
  assert.equal(st, 200);
  assert.equal(link.link, 'https://mp.test/sandbox', 'en modo prueba usa el checkout de sandbox');
  const pref = mp.peticiones.find(p => p.ruta === '/checkout/preferences');
  assert.equal(pref.body.external_reference, String(pedido.id));
  assert.equal(pref.body.items[0].unit_price, pedido.total);

  // Pago rechazado: no cierra el pedido
  pagosMP['111'] = { id: 111, status: 'rejected', external_reference: String(pedido.id), transaction_amount: pedido.total };
  assert.equal((await s.llamar('POST', '/api/mp/notificacion', { type: 'payment', data: { id: '111' } }))[0], 200);
  assert.equal((await s.q('SELECT estado FROM pedidos WHERE id = ?', [pedido.id]))[0].estado, 'abierto');

  // Pago aprobado: cobra una sola vez aunque MP reenvíe la notificación
  pagosMP['222'] = { id: 222, status: 'approved', external_reference: String(pedido.id), transaction_amount: pedido.total };
  for (let i = 0; i < 3; i++) assert.equal((await s.llamar('POST', '/api/mp/notificacion', { type: 'payment', data: { id: '222' } }))[0], 200);
  const [p] = await s.q('SELECT estado, metodo_pago, mp_payment_id FROM pedidos WHERE id = ?', [pedido.id]);
  assert.deepEqual({ ...p }, { estado: 'pagado', metodo_pago: 'mercadopago', mp_payment_id: '222' });
  const pagos = await s.q('SELECT metodo, monto, referencia FROM pagos WHERE pedido_id = ?', [pedido.id]);
  assert.deepEqual(pagos.map(x => ({ ...x })), [{ metodo: 'mercadopago', monto: pedido.total, referencia: 'MP-222' }]);

  // Notificación con formato IPN (por query string) y pago inexistente: MP reintentará
  assert.equal((await s.llamar('POST', '/api/mp/notificacion?topic=payment&id=999', {}))[0], 500);
  // Notificaciones que no son de pagos se ignoran
  assert.equal((await s.llamar('POST', '/api/mp/notificacion', { type: 'merchant_order', data: { id: '1' } }))[0], 200);
});

test('Tienda Nube: conexión, sincronización de productos y actualización', async () => {
  await s.llamar('PUT', '/api/integraciones/config/tiendanube', { store_id: '1234', access_token: 'tn-token', activa: true }, admin());
  const [, prueba] = await s.llamar('POST', '/api/integraciones/test/tiendanube', undefined, admin());
  assert.equal(prueba.ok, true);

  const [{ n: conPrecio }] = await s.q('SELECT COUNT(*) n FROM productos WHERE activo = 1 AND precio_venta > 0');
  const [, sync1] = await s.llamar('POST', '/api/integraciones/tiendanube/sync-productos', undefined, admin());
  assert.equal(sync1.ok, true, sync1.message);
  assert.equal(sync1.creados, conPrecio);
  const alta = tn.peticiones.find(p => p.metodo === 'POST' && p.ruta === '/1234/products');
  assert.ok(alta.body.name.es && alta.body.variants[0].price);
  const [{ n: vinculados }] = await s.q('SELECT COUNT(*) n FROM productos WHERE tn_product_id IS NOT NULL AND tn_variant_id IS NOT NULL');
  assert.equal(vinculados, conPrecio);

  // Segunda sincronización: actualiza en lugar de duplicar
  const [, sync2] = await s.llamar('POST', '/api/integraciones/tiendanube/sync-productos', undefined, admin());
  assert.equal(sync2.creados, 0);
  assert.equal(sync2.actualizados, conPrecio);
});

test('Tienda Nube: webhook de pedido nuevo (valida tienda y no duplica)', async () => {
  const [prod] = await s.q('SELECT id, nombre, tn_product_id FROM productos WHERE tn_product_id IS NOT NULL LIMIT 1');
  ordenesTN['555'] = {
    id: 555, number: 1042, total: '15000', contact_name: 'Carla Díaz', contact_phone: '1166667777',
    shipping_address: { address: 'Belgrano', number: '100', city: 'CABA' }, shipping_cost_customer: '1000', shipping_pickup_type: 'ship',
    products: [{ product_id: prod.tn_product_id, name: prod.nombre, price: '7000', quantity: 2 }]
  };
  const webhook = body => s.llamar('POST', '/api/tiendanube/webhook', body);
  assert.equal((await webhook({ store_id: 9999, event: 'order/created', id: 555 }))[0], 200);
  assert.equal((await s.q("SELECT COUNT(*) n FROM entregas WHERE plataforma = 'Tienda Nube'"))[0].n, 0, 'otra tienda: se ignora');

  for (let i = 0; i < 2; i++) assert.equal((await webhook({ store_id: 1234, event: 'order/created', id: 555 }))[0], 200);
  const entregas = await s.q("SELECT * FROM entregas WHERE plataforma = 'Tienda Nube'");
  assert.equal(entregas.length, 1, 'el reintento no duplica el pedido');
  assert.equal(entregas[0].direccion, 'Belgrano 100 CABA');
  const [pedido] = await s.q('SELECT * FROM pedidos WHERE id = ?', [entregas[0].pedido_id]);
  assert.equal(pedido.origen, 'tiendanube');
  assert.equal(pedido.cliente, 'Carla Díaz');
  assert.equal(pedido.total, 15000);
  const items = await s.q('SELECT producto_id, cantidad, precio_unitario FROM pedido_items WHERE pedido_id = ?', [pedido.id]);
  assert.deepEqual(items.map(i => ({ ...i })), [{ producto_id: prod.id, cantidad: 2, precio_unitario: 7000 }], 'vinculado al producto sincronizado');

  // Pedido inexistente en la tienda: error para que Tienda Nube reintente
  assert.equal((await webhook({ store_id: 1234, event: 'order/created', id: 777 }))[0], 500);
});

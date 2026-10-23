// Pago desde la mesa: el cliente paga toda la cuenta o su parte con propina por Mercado Pago,
// el pago se verifica contra la API (simulada) al volver y por la notificación, el mozo recibe el aviso
// y el comprobante sale por WhatsApp (simulado) al cerrarse la cuenta.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { iniciarServidor, esperar } = require('./helpers');

// Mercado Pago y Meta (WhatsApp) simulados en un mismo servidor
const externo = { preferencias: [], pagos: {}, mensajes: [] };
const servidorExterno = http.createServer((req, res) => {
  let cuerpo = '';
  req.on('data', d => { cuerpo += d; });
  req.on('end', () => {
    const responder = (obj, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.method === 'POST' && req.url.startsWith('/checkout/preferences')) {
      externo.preferencias.push(JSON.parse(cuerpo));
      return responder({ id: `pref-${externo.preferencias.length}`, init_point: 'https://mp.test/prod', sandbox_init_point: 'https://mp.test/sandbox' }, 201);
    }
    const pago = req.method === 'GET' && /^\/v1\/payments\/(\w+)/.exec(req.url);
    if (pago) return externo.pagos[pago[1]] ? responder(externo.pagos[pago[1]]) : responder({ message: 'payment not found' }, 404);
    if (req.method === 'POST' && /\/messages$/.test(req.url)) {
      externo.mensajes.push(JSON.parse(cuerpo));
      return responder({ messaging_product: 'whatsapp', messages: [{ id: `wamid.${externo.mensajes.length}` }] });
    }
    responder({ message: 'no encontrado' }, 404);
  });
});

let s, mesa, otraMesa, prod;
const publico = (m, metodo, ruta, body) => s.llamar(metodo, `/api/publico/mesa/${m.qr_token}${ruta}`, body);
const ultimaPreferencia = () => externo.preferencias[externo.preferencias.length - 1];
const aprobar = (id, intento, monto, status = 'approved') => {
  externo.pagos[id] = { id: Number(id), status, external_reference: `${intento.pedido_id}-T${intento.id}`, transaction_amount: monto };
};
const notificar = id => s.llamar('POST', '/api/mp/notificacion', { type: 'payment', data: { id } });

// Abre la cuenta de una mesa desde el QR (pedido confirmado por el mozo) por $2420
async function cuentaAbierta(m) {
  const [, sol] = await publico(m, 'POST', '/pedido', { items: [{ producto_id: prod.id, cantidad: 2 }] });
  const [st, conf] = await s.llamar('POST', `/api/mesas/solicitudes/${sol.id}/confirmar`, {}, s.tokenAdmin);
  assert.equal(st, 200, JSON.stringify(conf));
  return conf.pedido_id;
}

before(async () => {
  await new Promise(ok => servidorExterno.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${servidorExterno.address().port}`;
  s = await iniciarServidor({ BASE_URL: 'https://local.test', GM_MP_API_URL: url, GM_WA_API_URL: url });
  [mesa, otraMesa] = await s.q('SELECT id, nombre, qr_token FROM mesas ORDER BY id LIMIT 2');
  [prod] = await s.q('SELECT id FROM productos WHERE activo = 1 ORDER BY id LIMIT 1');
  await s.q('UPDATE productos SET precio_venta = 1210 WHERE id = ?', [prod.id]);
});
after(async () => {
  await s.cerrar();
  await new Promise(ok => servidorExterno.close(ok));
});

test('sin Mercado Pago configurado no se ofrece pagar desde la mesa', async () => {
  await cuentaAbierta(mesa);
  const [, est] = await publico(mesa, 'GET', '');
  assert.deepEqual(est.pago, { mercadopago: false, whatsapp: false });
  const [st, r] = await publico(mesa, 'POST', '/pagar', { partes: 1 });
  assert.equal(st, 400);
  assert.match(r.error, /pedile la cuenta al mozo/);
});

test('pagar la mitad con propina: link correcto, se acredita al volver, la propina va a la cuenta y el mozo se entera', async () => {
  await s.llamar('PUT', '/api/integraciones/config/mercadopago', { access_token: 'TEST-token', activa: true }, s.tokenAdmin);
  const [, est] = await publico(mesa, 'GET', '');
  assert.equal(est.pago.mercadopago, true);
  assert.deepEqual([est.cuenta.total, est.cuenta.saldo], [2420, 2420]);

  const [st, link] = await publico(mesa, 'POST', '/pagar', { partes: 2, propina: 121 });
  assert.equal(st, 201, JSON.stringify(link));
  assert.deepEqual([link.monto, link.propina, link.total, link.link], [1210, 121, 1331, 'https://mp.test/sandbox']);
  const [intento] = await s.q('SELECT * FROM pagos_mesa WHERE id = ?', [link.id]);
  const pref = ultimaPreferencia();
  assert.equal(pref.items[0].unit_price, 1331);
  assert.equal(pref.external_reference, `${intento.pedido_id}-T${intento.id}`);
  assert.equal(pref.notification_url, 'https://local.test/api/mp/notificacion');
  assert.equal(pref.back_urls.success, `https://local.test/pedido.html?mesa=${mesa.qr_token}&pago=${intento.id}`);
  assert.equal(pref.auto_return, 'approved');

  // Vuelve de Mercado Pago antes de que llegue la notificación
  aprobar('9001', intento, 1331);
  const [stV, ver] = await publico(mesa, 'POST', `/pago/${intento.id}/verificar`, { payment_id: '9001' });
  assert.equal(stV, 200, JSON.stringify(ver));
  assert.deepEqual([ver.estado, ver.cuenta_cerrada], ['aprobado', false]);
  const [ped] = await s.q('SELECT estado, propina, total FROM pedidos WHERE id = ?', [intento.pedido_id]);
  assert.deepEqual([ped.estado, ped.propina, ped.total], ['abierto', 121, 2541], 'la propina se suma a la cuenta');
  // Llega también la notificación (y se repite): no se cobra dos veces
  for (let i = 0; i < 2; i++) await notificar('9001');
  await publico(mesa, 'POST', `/pago/${intento.id}/verificar`, { payment_id: '9001' });
  const pagos = await s.q('SELECT monto, referencia FROM pagos WHERE pedido_id = ?', [intento.pedido_id]);
  assert.deepEqual(pagos.map(p => [p.monto, p.referencia]), [[1331, 'MP-9001']]);

  const [, est2] = await publico(mesa, 'GET', '');
  assert.deepEqual([est2.cuenta.pagado, est2.cuenta.saldo], [1331, 1210]);
  const [, pendientes] = await s.llamar('GET', '/api/mesas/solicitudes', null, s.tokenAdmin);
  const aviso = pendientes.find(p => p.tipo === 'pago' && p.mesa_id === mesa.id);
  assert.match(aviso.notas, /Pagó \$1331 con Mercado Pago \(propina \$121\) - falta \$1210/);
  assert.equal((await s.llamar('POST', `/api/mesas/solicitudes/${aviso.id}/atender`, {}, s.tokenAdmin))[0], 200);
});

test('la otra mitad por la notificación cierra la mesa y el comprobante pedido sale por WhatsApp', async () => {
  await s.llamar('PUT', '/api/integraciones/config/whatsapp', { activa: true, phone_number_id: '123', access_token: 'EAAG' }, s.tokenAdmin);
  const [primero] = await s.q("SELECT * FROM pagos_mesa WHERE mesa_id = ? AND estado = 'aprobado'", [mesa.id]);
  assert.equal((await publico(mesa, 'POST', `/pago/${primero.id}/comprobante`, { telefono: '123' }))[0], 400, 'teléfono inválido');
  const [, c] = await publico(mesa, 'POST', `/pago/${primero.id}/comprobante`, { telefono: '11 1234-5678' });
  assert.equal(c.comprobante, 'al cerrar la cuenta');
  assert.equal(externo.mensajes.length, 0, 'todavía no: la cuenta sigue abierta');

  const [, link] = await publico(mesa, 'POST', '/pagar', { partes: 1 });
  assert.equal(link.monto, 1210);
  const [intento] = await s.q('SELECT * FROM pagos_mesa WHERE id = ?', [link.id]);
  aprobar('9002', intento, 1210);
  assert.equal((await notificar('9002'))[0], 200);
  const [ped] = await s.q('SELECT estado FROM pedidos WHERE id = ?', [intento.pedido_id]);
  assert.equal(ped.estado, 'pagado');
  assert.equal((await s.q('SELECT estado FROM mesas WHERE id = ?', [mesa.id]))[0].estado, 'libre');
  for (let t = 0; t < 40 && !externo.mensajes.length; t++) await esperar(50);
  assert.equal(externo.mensajes.length, 1);
  assert.equal(externo.mensajes[0].to, '5491112345678');
  assert.equal((await publico(mesa, 'POST', `/pago/${primero.id}/comprobante`, { telefono: '11 1234-5678' }))[0], 409, 'una sola vez');
});

test('seguridad: el pago tiene que ser de esta mesa y de este intento; topes de partes y propina', async () => {
  const pedidoId = await cuentaAbierta(otraMesa);
  assert.equal((await publico(otraMesa, 'POST', '/pagar', { partes: 0 }))[0], 400);
  assert.equal((await publico(otraMesa, 'POST', '/pagar', { partes: 21 }))[0], 400);
  assert.equal((await publico(otraMesa, 'POST', '/pagar', { partes: 1, propina: 2000 }))[0], 400, 'propina de más de la mitad');
  const [, link] = await publico(otraMesa, 'POST', '/pagar', { partes: 1 });
  const [intento] = await s.q('SELECT * FROM pagos_mesa WHERE id = ?', [link.id]);
  // Un pago aprobado de otra mesa no sirve para esta
  const [viejo] = await s.q("SELECT * FROM pagos_mesa WHERE mesa_id = ? AND estado = 'aprobado' LIMIT 1", [mesa.id]);
  externo.pagos['9100'] = { id: 9100, status: 'approved', external_reference: `${viejo.pedido_id}-T${viejo.id}`, transaction_amount: 2420 };
  assert.equal((await publico(otraMesa, 'POST', `/pago/${intento.id}/verificar`, { payment_id: '9100' }))[0], 400);
  assert.equal((await publico(otraMesa, 'POST', `/pago/${intento.id}/verificar`, { payment_id: 'abc' }))[0], 400);
  assert.equal((await publico(mesa, 'POST', `/pago/${intento.id}/verificar`, { payment_id: '9100' }))[0], 404, 'intento de otra mesa');
  assert.equal((await s.q('SELECT estado FROM pedidos WHERE id = ?', [pedidoId]))[0].estado, 'abierto');

  // Rechazado: queda marcado y la cuenta sigue igual
  aprobar('9101', intento, 2420, 'rejected');
  const [, ver] = await publico(otraMesa, 'POST', `/pago/${intento.id}/verificar`, { payment_id: '9101' });
  assert.equal(ver.estado, 'rechazado');
  assert.equal((await s.q('SELECT COUNT(*) n FROM pagos WHERE pedido_id = ?', [pedidoId]))[0].n, 0);
});

test('si se pagó menos que la parte con propina, la propina no se suma', async () => {
  const [, link] = await publico(otraMesa, 'POST', '/pagar', { partes: 2, propina: 100 });
  const [intento] = await s.q('SELECT * FROM pagos_mesa WHERE id = ?', [link.id]);
  aprobar('9200', intento, 500);
  await notificar('9200');
  const [ped] = await s.q('SELECT propina, total, estado FROM pedidos WHERE id = ?', [intento.pedido_id]);
  assert.deepEqual([ped.propina, ped.total, ped.estado], [0, 2420, 'abierto']);
});

test('pedir la cuenta diciendo con qué paga', async () => {
  const [, c] = await publico(otraMesa, 'POST', '/llamar', { tipo: 'cuenta', forma: 'efectivo' });
  assert.equal(c.notas, 'Paga en efectivo');
  const [, c2] = await publico(otraMesa, 'POST', '/llamar', { tipo: 'cuenta', forma: 'tarjeta' });
  assert.deepEqual([c2.id, c2.notas], [c.id, 'Paga con tarjeta'], 'cambia la forma sin duplicar el llamado');
});

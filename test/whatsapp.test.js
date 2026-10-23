// WhatsApp Business contra una API de Meta simulada (GM_WA_API_URL): comprobantes, avisos de pedido,
// recordatorios de reservas, webhook firmado y permisos
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const http = require('http');
const { iniciarServidor, esperar } = require('./helpers');
const { normalizarTelefono } = require('../src/servicios/whatsapp');

// ---- API de Meta simulada ----
const meta = { envios: [], fallar: null };
const servidorMeta = http.createServer((req, res) => {
  let cuerpo = '';
  req.on('data', d => { cuerpo += d; });
  req.on('end', () => {
    const responder = (obj, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (meta.fallar) return responder({ error: { message: meta.fallar, code: 131026 } }, 400);
    meta.envios.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(cuerpo || '{}') });
    responder({ messaging_product: 'whatsapp', messages: [{ id: `wamid.${meta.envios.length}` }] });
  });
});

const APP_SECRET = 'secreto-de-la-app';
const CONFIG = {
  activa: true, phone_number_id: '1234567890', access_token: 'EAAG-token', app_secret: APP_SECRET,
  verify_token: 'verificar-gm', avisar_pedidos: true, recordatorio_horas: 3
};
let s, prod, tokenMozo;
const esperarEnvios = async (n, ms = 4000) => {
  for (let t = 0; t < ms / 50 && meta.envios.length < n; t++) await esperar(50);
  return meta.envios;
};
const ultimo = () => meta.envios[meta.envios.length - 1].body;
const parametros = b => b.template.components[0].parameters.map(p => p.text);
// Fecha y hora del negocio dentro de N horas, como las guarda una reserva
const localEn = horas => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(Date.now() + horas * 3600e3)).map(x => [x.type, x.value]));
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}` };
};

before(async () => {
  await new Promise(ok => servidorMeta.listen(0, '127.0.0.1', ok));
  s = await iniciarServidor({ GM_WA_API_URL: `http://127.0.0.1:${servidorMeta.address().port}`, GM_WA_INTERVALO_MS: '300' });
  [prod] = await s.q('SELECT id FROM productos WHERE activo = 1 ORDER BY id LIMIT 1');
  await s.q('UPDATE productos SET precio_venta = 1210 WHERE id = ?', [prod.id]);
  await s.llamar('PUT', '/api/config', { nombre_negocio: 'La Buena Mesa' }, s.tokenAdmin);
  const hash = require('bcryptjs').hashSync('mozo1234', 4);
  await s.q("INSERT INTO usuarios (nombre, email, password, rol, debe_cambiar_password) VALUES ('Mozo', 'mozo-wa@test.com', ?, 'mozo', 0)", [hash]);
  tokenMozo = s.token((await s.q("SELECT id FROM usuarios WHERE email = 'mozo-wa@test.com'"))[0].id);
});
after(async () => {
  await s.cerrar();
  await new Promise(ok => servidorMeta.close(ok));
});

test('teléfonos argentinos al formato de WhatsApp (549 + característica + número)', () => {
  for (const [entrada, esperado] of [
    ['11 1234-5678', '5491112345678'], ['011 15-1234-5678', '5491112345678'], ['+54 9 11 1234-5678', '5491112345678'],
    ['5491112345678', '5491112345678'], ['0351 15 555-1234', '5493515551234'], ['(02966) 15-41-2345', '5492966412345'],
    ['54 11 1234 5678', '5491112345678'], ['1234', null], ['', null], ['hola', null]
  ]) assert.equal(normalizarTelefono(entrada), esperado, entrada);
});

test('configuración: se guarda, los secretos no vuelven al navegador y queda conectada', async () => {
  const [st] = await s.llamar('PUT', '/api/integraciones/config/whatsapp', CONFIG, s.tokenAdmin);
  assert.equal(st, 200);
  const [, cfg] = await s.llamar('GET', '/api/integraciones/config', null, s.tokenAdmin);
  assert.doesNotMatch(JSON.stringify(cfg.whatsapp), /EAAG-token|secreto-de-la-app/);
  assert.equal(cfg.whatsapp.plantillas.comprobante, 'comprobante_compra');
  const [, estado] = await s.llamar('GET', '/api/integraciones/estado', null, s.tokenAdmin);
  assert.equal(estado.whatsapp, 'conectada');
  // Guardar sin tocar los secretos enmascarados los conserva
  await s.llamar('PUT', '/api/integraciones/config/whatsapp', { ...cfg.whatsapp, recordatorio_horas: 3 }, s.tokenAdmin);
  const [, prueba] = await s.llamar('POST', '/api/whatsapp/prueba', { telefono: '11 5555-0000' }, s.tokenAdmin);
  assert.equal(prueba.ok, true);
  assert.equal(meta.envios.at(-1).auth, 'Bearer EAAG-token');
  assert.match(meta.envios.at(-1).url, /\/v21\.0\/1234567890\/messages$/);
  assert.equal(ultimo().template.name, 'hello_world');
});

test('comprobante por WhatsApp después de cobrar', async () => {
  const [, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'takeaway', cliente: 'Ana', items: [{ producto_id: prod.id, cantidad: 1 }] }, s.tokenVendedor);
  const enviar = (tel, token = s.tokenVendedor) => s.llamar('POST', `/api/whatsapp/comprobante/${p.id}`, { telefono: tel }, token);
  assert.match((await enviar('11 1234-5678'))[1].error, /no está cobrado/);
  await s.llamar('POST', `/api/pedidos/${p.id}/pagar`, { metodo: 'tarjeta', monto: 1210 }, s.tokenVendedor);
  assert.match((await enviar('123'))[1].error, /teléfono no es válido/);

  const [st, r] = await enviar('011 15-1234-5678');
  assert.equal(st, 200, JSON.stringify(r));
  const b = ultimo();
  assert.deepEqual([b.to, b.template.name, b.template.language.code], ['5491112345678', 'comprobante_compra', 'es_AR']);
  const [cliente, negocio, total, comprobante] = parametros(b);
  assert.deepEqual([cliente, negocio], ['Ana', 'La Buena Mesa']);
  assert.match(total, /1\.210/);
  assert.match(comprobante, /^Pedido P-/);
  const [m] = await s.q('SELECT * FROM whatsapp_mensajes WHERE id = ?', [r.id]);
  assert.deepEqual([m.estado, m.motivo, m.referencia, m.wa_message_id], ['enviado', 'comprobante', p.id, r.wa_message_id]);
});

test('si Meta rechaza, queda el error en el registro y se informa', async () => {
  const [, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'takeaway', items: [{ producto_id: prod.id, cantidad: 1 }] }, s.tokenVendedor);
  await s.llamar('POST', `/api/pedidos/${p.id}/pagar`, { metodo: 'efectivo', monto: 1210 }, s.tokenVendedor);
  meta.fallar = 'Message undeliverable';
  try {
    const [st, r] = await s.llamar('POST', `/api/whatsapp/comprobante/${p.id}`, { telefono: '1112345678' }, s.tokenVendedor);
    assert.equal(st, 502);
    assert.match(r.error, /undeliverable/);
  } finally { meta.fallar = null; }
  const [m] = await s.q("SELECT estado, error FROM whatsapp_mensajes WHERE motivo = 'comprobante' AND referencia = ?", [p.id]);
  assert.equal(m.estado, 'error');
  assert.match(m.error, /undeliverable/);
});

test('pedido para llevar listo en cocina: avisa una sola vez; delivery en camino también', async () => {
  const [, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'takeaway', cliente: 'Juan', telefono: '351 555-1234',
    items: [{ producto_id: prod.id, cantidad: 1 }] }, s.tokenVendedor);
  const antes = meta.envios.length;
  await s.llamar('PUT', `/api/cocina/${p.id}/listo`, {}, s.tokenAdmin);
  await s.llamar('PUT', `/api/cocina/${p.id}/listo`, {}, s.tokenAdmin);
  await esperarEnvios(antes + 1);
  await esperar(300);
  assert.equal(meta.envios.length, antes + 1, 'un solo aviso aunque lo marquen dos veces');
  assert.deepEqual([ultimo().to, ultimo().template.name], ['5493515551234', 'estado_pedido']);
  assert.deepEqual(parametros(ultimo()).slice(0, 1).concat(parametros(ultimo()).slice(2)), ['Juan', 'La Buena Mesa', 'listo para retirar']);

  const [, d] = await s.llamar('POST', '/api/pedidos', { tipo: 'delivery', cliente: 'Eva', telefono: '11 4444-5555', direccion: 'Calle 1',
    items: [{ producto_id: prod.id, cantidad: 1 }] }, s.tokenVendedor);
  await s.llamar('PUT', `/api/delivery/pedidos/${d.id}/estado`, { estado_envio: 'en_camino', cadete: 'Leo' }, s.tokenVendedor);
  await esperarEnvios(antes + 2);
  assert.equal(parametros(ultimo())[3], 'en camino');

  // Sin teléfono o con los avisos apagados, no se manda nada
  const [, sinTel] = await s.llamar('POST', '/api/pedidos', { tipo: 'takeaway', items: [{ producto_id: prod.id, cantidad: 1 }] }, s.tokenVendedor);
  await s.llamar('PUT', `/api/cocina/${sinTel.id}/listo`, {}, s.tokenAdmin);
  await esperar(400);
  assert.equal(meta.envios.length, antes + 2);
});

test('recordatorio de reservas: solo las próximas N horas, una vez cada una', async () => {
  const mesa = (await s.q('SELECT id FROM mesas ORDER BY id LIMIT 1'))[0].id;
  const reservar = (cliente, horas, telefono = '11 2222-3333') =>
    s.llamar('POST', '/api/reservas', { mesa_id: mesa, cliente, telefono, personas: 4, ...localEn(horas) }, s.tokenVendedor);
  const [st, enUnaHora] = await reservar('Cena en una hora', 1);
  assert.ok(st < 300, JSON.stringify(enUnaHora));
  await reservar('Mañana', 26);
  await reservar('Ya pasó', -2);
  await reservar('Sin teléfono', 1, '');

  for (let t = 0; t < 80; t++) {
    if ((await s.q("SELECT COUNT(*) c FROM whatsapp_mensajes WHERE motivo = 'recordatorio_reserva'"))[0].c) break;
    await esperar(50);
  }
  await esperar(900); // varias pasadas más del revisor: no repite
  const recordatorios = meta.envios.filter(e => e.body.template.name === 'recordatorio_reserva');
  assert.equal(recordatorios.length, 1);
  const [cliente, negocio, fecha, hora, personas] = parametros(recordatorios[0].body);
  const { fecha: f, hora: h } = localEn(1);
  assert.deepEqual([cliente, negocio, fecha, hora, personas], ['Cena en una hora', 'La Buena Mesa', f.split('-').reverse().join('/'), h, '4']);
});

test('webhook: verificación de Meta, firma obligatoria, estados en orden y mensajes recibidos', async () => {
  const verificar = token => fetch(`${s.base}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=12345`);
  const ok = await verificar('verificar-gm');
  assert.deepEqual([ok.status, await ok.text()], [200, '12345']);
  assert.equal((await verificar('otro')).status, 403);

  const [{ wa_message_id: waId, id }] = await s.q("SELECT id, wa_message_id FROM whatsapp_mensajes WHERE estado = 'enviado' ORDER BY id LIMIT 1");
  const enviarWebhook = (cuerpo, firma) => {
    const crudo = JSON.stringify(cuerpo);
    return fetch(`${s.base}/api/whatsapp/webhook`, { method: 'POST', body: crudo, headers: { 'Content-Type': 'application/json',
      ...(firma !== null ? { 'X-Hub-Signature-256': firma || 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(crudo).digest('hex') } : {}) } });
  };
  const estado = st => ({ entry: [{ changes: [{ value: { statuses: [{ id: waId, status: st }] } }] }] });
  assert.equal((await enviarWebhook(estado('read'), null)).status, 401, 'sin firma');
  assert.equal((await enviarWebhook(estado('read'), 'sha256=' + '0'.repeat(64))).status, 401, 'firma falsa');

  assert.equal((await enviarWebhook(estado('read'))).status, 200);
  assert.equal((await enviarWebhook(estado('delivered'))).status, 200);
  assert.equal((await s.q('SELECT estado FROM whatsapp_mensajes WHERE id = ?', [id]))[0].estado, 'leido', '"entregado" tarde no pisa "leído"');

  const entrante = { entry: [{ changes: [{ value: {
    contacts: [{ wa_id: '5491112345678', profile: { name: 'Ana' } }],
    messages: [{ id: 'wamid.entrante1', from: '5491112345678', type: 'text', text: { body: '¿Tienen mesa para 4 hoy?' } }]
  } }] }] };
  await enviarWebhook(entrante);
  await enviarWebhook(entrante); // Meta reintenta: no se duplica
  const recibidos = await s.q('SELECT telefono, nombre, texto FROM whatsapp_entrantes');
  assert.deepEqual(recibidos, [{ telefono: '5491112345678', nombre: 'Ana', texto: '¿Tienen mesa para 4 hoy?' }]);
  const [, log] = await s.llamar('GET', '/api/whatsapp/mensajes', null, s.tokenAdmin);
  assert.equal(log.recibidos.length, 1);
});

test('permisos: el mozo envía comprobantes solo con cobro en la mesa y de sus mesas; la prueba es del admin', async () => {
  const [, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'takeaway', items: [{ producto_id: prod.id, cantidad: 1 }] }, s.tokenVendedor);
  await s.llamar('POST', `/api/pedidos/${p.id}/pagar`, { metodo: 'efectivo', monto: 1210 }, s.tokenVendedor);
  const enviar = () => s.llamar('POST', `/api/whatsapp/comprobante/${p.id}`, { telefono: '1112345678' }, tokenMozo);
  assert.equal((await enviar())[0], 403);
  await s.llamar('PUT', '/api/config', { mozo_cobra_mesa: 1 }, s.tokenAdmin);
  assert.equal((await enviar())[0], 403, 'un pedido para llevar no es de su mesa');
  assert.equal((await s.llamar('POST', '/api/whatsapp/prueba', { telefono: '1112345678' }, s.tokenVendedor))[0], 403);
  assert.equal((await s.llamar('GET', '/api/whatsapp/mensajes', null, s.tokenVendedor))[0], 403);
});

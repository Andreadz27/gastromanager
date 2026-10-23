// Asistente IA por WhatsApp contra una API de Claude simulada (GM_ANTHROPIC_URL) y una de Meta simulada (GM_WA_API_URL).
// Lo que se prueba es lo que no depende del modelo: el teléfono sale de WhatsApp, los precios de la base,
// sin confirmación no hay pedido, la conversación solo crece (nunca se edita), pausa al derivar, topes y permisos.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const http = require('http');
const { iniciarServidor, esperar } = require('./helpers');

const TEL = '5491155551234';
const APP_SECRET = 'secreto-de-la-app';

// ---- APIs simuladas ----
const meta = { envios: [] };
const claude = { pedidos: [], guion: [] };
const json = (res, obj, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const servidor = fn => http.createServer((req, res) => {
  let cuerpo = '';
  req.on('data', d => { cuerpo += d; });
  req.on('end', () => fn(req, res, cuerpo ? JSON.parse(cuerpo) : {}));
});
const servidorMeta = servidor((req, res, body) => {
  meta.envios.push(body);
  json(res, { messaging_product: 'whatsapp', messages: [{ id: `wamid.r${meta.envios.length}` }] });
});
const servidorClaude = servidor((req, res, body) => {
  claude.pedidos.push({ url: req.url, headers: req.headers, body });
  const paso = claude.guion.shift();
  if (!paso) return json(res, { type: 'error', error: { type: 'api_error', message: 'sin guion' } }, 500);
  json(res, { id: 'msg_' + claude.pedidos.length, type: 'message', role: 'assistant', model: body.model, stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50 }, ...paso });
});
const texto = t => ({ content: [{ type: 'text', text: t }], stop_reason: 'end_turn' });
const herramienta = (name, input, id = 'tu_' + Math.random().toString(36).slice(2)) =>
  ({ content: [{ type: 'thinking', thinking: '', signature: 'firma' }, { type: 'tool_use', id, name, input }], stop_reason: 'tool_use' });

let s, prod;
async function escribe(textoCliente, { tel = TEL, id = 'wamid.in' + Math.random() } = {}) {
  const cuerpo = JSON.stringify({ entry: [{ changes: [{ value: {
    contacts: [{ wa_id: tel, profile: { name: 'Lucía' } }],
    messages: [{ id, from: tel, type: 'text', timestamp: String(Math.floor(Date.now() / 1000)), text: { body: textoCliente } }]
  } }] }] });
  const firma = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(cuerpo).digest('hex');
  const r = await fetch(s.base + '/api/whatsapp/webhook', { method: 'POST', body: cuerpo,
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': firma } });
  assert.equal(r.status, 200);
}
const esperarRespuestas = async (n, ms = 8000) => {
  for (let t = 0; t < ms && meta.envios.length < n; t += 50) await esperar(50);
  return meta.envios;
};
const ultimaRespuesta = () => meta.envios[meta.envios.length - 1].text.body;
const resultadoDe = pedido => pedido.body.messages[pedido.body.messages.length - 1].content.find(b => b.type === 'tool_result');
const configurar = cfg => s.llamar('PUT', '/api/integraciones/config/asistente', cfg, s.tokenAdmin);
const CFG = { activa: true, api_key: 'sk-ant-prueba-1234', pedidos: true, reservas: true, max_personas: 8,
  horarios: 'Martes a domingo de 20 a 24', instrucciones: 'No hacemos envíos a más de 3 km.' };

before(async () => {
  await Promise.all([servidorMeta, servidorClaude].map(x => new Promise(ok => x.listen(0, '127.0.0.1', ok))));
  s = await iniciarServidor({
    GM_WA_API_URL: `http://127.0.0.1:${servidorMeta.address().port}`,
    GM_ANTHROPIC_URL: `http://127.0.0.1:${servidorClaude.address().port}`
  });
  [prod] = await s.q('SELECT id, nombre FROM productos WHERE activo = 1 ORDER BY id LIMIT 1');
  await s.q('UPDATE productos SET precio_venta = 4500, tracking_stock = 0 WHERE id = ?', [prod.id]);
  await s.llamar('PUT', '/api/integraciones/config/whatsapp', { activa: true, phone_number_id: '123', access_token: 'EAAG', app_secret: APP_SECRET }, s.tokenAdmin);
  await configurar(CFG);
});
after(async () => {
  await s.cerrar();
  await Promise.all([servidorMeta, servidorClaude].map(x => new Promise(ok => x.close(ok))));
});
beforeEach(async () => {
  meta.envios = []; claude.pedidos = []; claude.guion = [];
  await s.q('DELETE FROM asistente_conversaciones');
});

test('contesta con la carta real: modelo, fallbacks, esfuerzo y herramientas; la clave no vuelve al navegador', async () => {
  claude.guion.push(herramienta('ver_carta', {}), texto('¡Hola Lucía! Tenemos ' + prod.nombre + ' a $ 4.500.'));
  await escribe('hola, qué tienen?');
  await esperarRespuestas(1);
  assert.match(ultimaRespuesta(), /Hola Lucía/);
  assert.equal(meta.envios[0].to, TEL);
  assert.equal(meta.envios[0].type, 'text');

  const [p1, p2] = claude.pedidos;
  assert.equal(p1.body.model, 'claude-opus-5-5');
  assert.equal(p1.body.fallbacks, 'default');
  assert.match(p1.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.equal(p1.headers['x-api-key'], 'sk-ant-prueba-1234');
  assert.deepEqual(p1.body.output_config, { effort: 'low' });
  assert.deepEqual(p1.body.tools.map(t => t.name).sort(), ['crear_pedido', 'crear_reserva', 'derivar_a_persona', 'info_local', 'mis_pedidos', 'ver_carta']);
  assert.match(p1.body.messages[0].content, /nombre en WhatsApp: Lucía\]\nhola, qué tienen\?$/);
  const carta = JSON.parse(resultadoDe(p2).content).carta;
  assert.ok(carta.includes(`id ${prod.id} | ${prod.nombre} | $ 4.500`), carta);

  const [, cfg] = await s.llamar('GET', '/api/integraciones/config', null, s.tokenAdmin);
  assert.equal(cfg.asistente.api_key, '••••••••1234');
  const [st] = await s.llamar('GET', '/api/integraciones/config', null, s.tokenVendedor);
  assert.equal(st, 403);
});

test('la conversación solo crece: cada pedido a Claude empieza con todo lo anterior tal cual', async () => {
  claude.guion.push(texto('¿Para cuántos?'));
  await escribe('quiero reservar');
  await esperarRespuestas(1);
  claude.guion.push(herramienta('info_local', {}), texto('Abrimos de martes a domingo de 20 a 24.'));
  await escribe('para 4, ¿qué horarios tienen?');
  await esperarRespuestas(2);
  const [a, b, c] = claude.pedidos;
  const anterior = [...a.body.messages, { role: 'assistant', content: [{ type: 'text', text: '¿Para cuántos?' }] }];
  assert.deepEqual(b.body.messages.slice(0, anterior.length), anterior);
  assert.deepEqual(c.body.messages.slice(0, b.body.messages.length), b.body.messages);
  assert.equal(b.body.system, a.body.system, 'el system no cambia');
  const info = JSON.parse(resultadoDe(c).content);
  assert.equal(info.horarios, 'Martes a domingo de 20 a 24');
  assert.equal(info.indicaciones_del_local, 'No hacemos envíos a más de 3 km.');
});

test('pedido: sin confirmación no se crea; confirmado, entra con el teléfono de WhatsApp y el precio de la base', async () => {
  claude.guion.push(herramienta('crear_pedido', { items: [{ producto_id: prod.id, cantidad: 2, notas: '' }], tipo: 'takeaway', direccion: '',
    nombre: 'Lucía', notas: '', confirmado_por_cliente: false }), texto('¿Confirmás 2 por $ 9.000?'));
  await escribe('dame 2');
  await esperarRespuestas(1);
  const r1 = resultadoDe(claude.pedidos[1]);
  assert.equal(r1.is_error, true);
  assert.equal((await s.q("SELECT COUNT(*) AS n FROM pedidos WHERE origen = 'whatsapp'"))[0].n, 0);

  claude.guion.push(herramienta('crear_pedido', { items: [{ producto_id: prod.id, cantidad: 2, notas: 'sin cebolla' }], tipo: 'takeaway',
    direccion: '', nombre: 'Lucía', notas: '', confirmado_por_cliente: true }), texto('¡Listo! Pedido confirmado.'));
  await escribe('sí');
  await esperarRespuestas(2);
  const r2 = JSON.parse(resultadoDe(claude.pedidos[3]).content);
  assert.equal(r2.ok, true);
  assert.equal(r2.total, '$ 9.000');
  const [p] = await s.q("SELECT * FROM pedidos WHERE origen = 'whatsapp' ORDER BY id DESC LIMIT 1");
  assert.equal(p.total, 9000);
  assert.equal(p.numero_pedido, r2.numero_pedido);
  assert.equal((await s.q('SELECT telefono FROM entregas WHERE pedido_id = ?', [p.id]))[0].telefono, TEL);
  assert.equal((await s.q('SELECT notas FROM pedido_items WHERE pedido_id = ?', [p.id]))[0].notas, 'sin cebolla');

  // mis_pedidos: solo los de este número
  claude.guion.push(herramienta('mis_pedidos', {}), texto('Tu pedido está en preparación.'));
  await escribe('¿cómo va mi pedido?');
  await esperarRespuestas(3);
  const mios = JSON.parse(resultadoDe(claude.pedidos[5]).content).pedidos;
  assert.equal(mios.length, 1);
  assert.equal(mios[0].numero, p.numero_pedido);
  assert.equal(mios[0].estado, 'en preparación');
});

test('reservas: valida fecha y personas; la válida queda con el teléfono de WhatsApp', async () => {
  const pasado = { fecha: '2020-01-01', hora: '21:00', personas: 2, nombre: 'Lucía', notas: '', confirmado_por_cliente: true };
  const manana = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(Date.now() + 86400e3));
  claude.guion.push(herramienta('crear_reserva', pasado), herramienta('crear_reserva', { ...pasado, fecha: manana, personas: 20 }),
    herramienta('crear_reserva', { ...pasado, fecha: manana, notas: 'cumpleaños' }), texto('¡Reservado!'));
  await escribe('reservá mañana 21 para 2');
  await esperarRespuestas(1);
  assert.match(JSON.parse(resultadoDe(claude.pedidos[1]).content).error, /ya pasaron/);
  assert.match(JSON.parse(resultadoDe(claude.pedidos[2]).content).error, /más de 8 personas/);
  const ok = JSON.parse(resultadoDe(claude.pedidos[3]).content);
  assert.equal(ok.ok, true);
  const [r] = await s.q('SELECT * FROM reservas WHERE id = ?', [ok.reserva]);
  assert.equal(r.telefono, TEL);
  assert.equal(r.fecha, manana);
  assert.match(r.notas, /cumpleaños \(por WhatsApp, asistente\)/);
});

test('derivar a una persona: avisa y el asistente no contesta por un rato; se puede reactivar', async () => {
  claude.guion.push(herramienta('derivar_a_persona', { motivo: 'Reclamo por demora' }), texto('Ya le aviso al encargado.'));
  await escribe('el pedido llegó frío, quiero hablar con alguien');
  await esperarRespuestas(1);
  await escribe('hola??');
  await esperar(600);
  assert.equal(claude.pedidos.length, 2, 'no se llamó a Claude con la conversación derivada');
  assert.equal(meta.envios.length, 1);
  const [, estado] = await s.llamar('GET', '/api/asistente/estado', null, s.tokenAdmin);
  assert.deepEqual(estado.derivadas.map(d => d.telefono), [TEL]);

  await s.llamar('POST', '/api/asistente/reactivar', { telefono: TEL }, s.tokenAdmin);
  claude.guion.push(texto('¡Hola de nuevo!'));
  await escribe('hola');
  await esperarRespuestas(2);
  assert.equal(ultimaRespuesta(), '¡Hola de nuevo!');
});

test('si Claude se niega, se pasa a una persona y la conversación arranca de cero', async () => {
  claude.guion.push({ content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: null, explanation: '' } });
  await escribe('algo raro');
  await esperarRespuestas(1);
  assert.match(ultimaRespuesta(), /Te paso con alguien del local/);
  assert.equal((await s.q('SELECT mensajes FROM asistente_conversaciones WHERE telefono = ?', [TEL]))[0].mensajes, '[]');
});

test('prueba desde Integraciones: misma IA, pero no crea pedidos; solo admin', async () => {
  claude.guion.push(herramienta('crear_pedido', { items: [{ producto_id: prod.id, cantidad: 1, notas: '' }], tipo: 'takeaway', direccion: '',
    nombre: 'Prueba', notas: '', confirmado_por_cliente: true }), texto('Pedido PRUEBA confirmado.'));
  const antes = (await s.q('SELECT COUNT(*) AS n FROM pedidos'))[0].n;
  const [st, r] = await s.llamar('POST', '/api/asistente/probar', { texto: 'quiero 1', reiniciar: true }, s.tokenAdmin);
  assert.equal(st, 200, JSON.stringify(r));
  assert.equal(r.respuesta, 'Pedido PRUEBA confirmado.');
  assert.equal((await s.q('SELECT COUNT(*) AS n FROM pedidos'))[0].n, antes);
  assert.equal(meta.envios.length, 0, 'la prueba no manda WhatsApp');
  assert.equal((await s.llamar('POST', '/api/asistente/probar', { texto: 'hola' }, s.tokenVendedor))[0], 403);
});

test('apagado no contesta; registra el uso del día', async () => {
  const [, est] = await s.llamar('GET', '/api/asistente/estado', null, s.tokenAdmin);
  assert.ok(est.uso[0].respuestas >= 1);
  assert.ok(est.uso[0].tokens_cache > 0);
  await configurar({ ...CFG, api_key: '••••••••1234', activa: false });
  await escribe('hola');
  await esperar(600);
  assert.equal(claude.pedidos.length, 0);
  assert.equal(meta.envios.length, 0);
  await configurar({ ...CFG, api_key: '••••••••1234' }); // la clave enmascarada conserva la guardada
  claude.guion.push(texto('¡Hola!'));
  await escribe('hola');
  await esperarRespuestas(1);
  assert.equal(claude.pedidos[0].headers['x-api-key'], 'sk-ant-prueba-1234');
});

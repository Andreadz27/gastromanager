// Morfi Nube etapa 2: la carta online vive en la nube (/l/<cliente>) y el local trae los pedidos.
// Nube real + local real: el pedido entra por la nube, el local lo carga con sus precios y el cliente ve el número.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const sqlite3 = require('sqlite3');
const { iniciarServidor, esperar } = require('./helpers');

const RAIZ = path.join(__dirname, '..');
let nube, nubeBase, datosNube, s, prod, dbNube;

const puertoLibre = () => new Promise(ok => { const x = net.createServer(); x.listen(0, () => { const { port } = x.address(); x.close(() => ok(port)); }); });
const alta = (...args) => execFileSync(process.execPath, [path.join(RAIZ, 'nube', 'alta.js'), ...args],
  { env: { ...process.env, NUBE_DATOS: datosNube }, encoding: 'utf8' });
async function aNube(metodo, ruta, body) {
  const r = await fetch(nubeBase + ruta, { method: metodo, body: body && JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
  const tipo = r.headers.get('content-type') || '';
  return [r.status, tipo.includes('json') ? await r.json() : await r.text()];
}
const qNube = (sql, p = []) => new Promise((ok, mal) => dbNube.all(sql, p, (e, r) => e ? mal(e) : ok(r)));
const esperarQue = async (cond, ms = 15000) => { for (let t = 0; t < ms; t += 200) { if (await cond()) return true; await esperar(200); } return false; };
const pedir = (cliente, items, extra = {}) => aNube('POST', `/l/${cliente}/api/publico/pedido`,
  { cliente: 'Lucía', telefono: '1155551234', tipo: 'takeaway', items, ...extra });
const estadoDe = async codigo => (await aNube('GET', `/l/centro/api/publico/pedido/${codigo}`))[1];

before(async () => {
  datosNube = fs.mkdtempSync(path.join(os.tmpdir(), 'morfi-nube-'));
  const token = alta('local', '--cuenta', 'La Buena Mesa', '--nombre', 'Centro', '--cliente', 'centro').match(/NUBE_TOKEN=(\S+)/)[1];
  alta('local', '--cuenta', 'La Buena Mesa', '--nombre', 'Palermo', '--cliente', 'palermo');
  const port = await puertoLibre();
  nubeBase = `http://127.0.0.1:${port}`;
  nube = spawn(process.execPath, [path.join(RAIZ, 'nube', 'servidor.js')], { env: { ...process.env, NUBE_DATOS: datosNube, PORT: String(port) }, stdio: 'ignore' });
  assert.ok(await esperarQue(async () => { try { return (await fetch(nubeBase + '/api/salud')).ok; } catch (e) { return false; } }), 'la nube no arrancó');
  dbNube = new sqlite3.Database(path.join(datosNube, 'nube.db'));
  dbNube.configure('busyTimeout', 10000);

  s = await iniciarServidor({ NUBE_URL: nubeBase, NUBE_TOKEN: token, NUBE_SEGUNDOS: '1', NUBE_PEDIDOS_SEGUNDOS: '1' });
  [prod] = await s.q('SELECT id, nombre FROM productos WHERE activo = 1 ORDER BY id LIMIT 1');
  await s.q('UPDATE productos SET precio_venta = 1000 WHERE id = ?', [prod.id]);
  await s.q("UPDATE configuracion SET nombre_negocio = 'La Buena Mesa', telefono = '11 4444-5555' WHERE id = 1");
});
after(async () => {
  if (s) await s.cerrar();
  if (dbNube) await new Promise(r => dbNube.close(r));
  if (nube) { nube.kill(); await new Promise(r => nube.exitCode !== null ? r() : nube.once('exit', r)); }
  fs.rmSync(datosNube, { recursive: true, force: true });
});

test('la carta del local se publica en la nube con link fijo y la página es la del local', async () => {
  assert.ok(await esperarQue(async () => {
    const [st, m] = await aNube('GET', '/l/centro/api/publico/menu');
    return st === 200 && m.productos.some(p => p.id === prod.id && p.precio_venta === 1000);
  }), 'la carta no llegó (o sin el precio actualizado)');
  const [, info] = await aNube('GET', '/l/centro/api/publico/info');
  assert.equal(info.nombre, 'La Buena Mesa');
  assert.equal(info.recibe_pedidos, true);
  assert.match(info.links.carta, /\/l\/centro\/pedido\.html$/);

  const [stHtml, html] = await aNube('GET', '/l/centro/pedido.html');
  assert.equal(stHtml, 200);
  assert.match(html, /js\/pedido\.js/);
  assert.equal((await aNube('GET', '/l/centro/js/pedido.js'))[0], 200);
  assert.equal((await aNube('GET', '/vendor/fontawesome/css/all.min.css'))[0], 200);
  // Solo se sirven los archivos de la carta, nada más del sistema
  assert.equal((await aNube('GET', '/l/centro/js/app.js'))[0], 404);
  assert.equal((await aNube('GET', '/l/centro/..%2f..%2fpackage.json'))[0], 404);
  assert.equal((await aNube('GET', '/l/no-existe/api/publico/menu'))[0], 404);
});

test('un pedido por la nube llega al local con sus precios y el cliente ve el número; la nube borra sus datos', async () => {
  const [st, r] = await pedir('centro', [{ producto_id: prod.id, cantidad: 3, notas: 'sin sal' }]);
  assert.equal(st, 201, JSON.stringify(r));
  assert.equal(r.pendiente, true);
  assert.equal(r.total, 3000);
  assert.ok(await esperarQue(async () => (await estadoDe(r.codigo)).estado === 'recibido'), 'el local no lo trajo');
  const e = await estadoDe(r.codigo);

  const [p] = await s.q('SELECT * FROM pedidos WHERE numero_pedido = ?', [e.numero_pedido]);
  assert.ok(p, 'el pedido está en el local');
  assert.equal(p.total, 3000);
  assert.equal(p.cliente, 'Lucía (1155551234)');
  assert.equal(p.tipo, 'takeaway');
  const [item] = await s.q('SELECT * FROM pedido_items WHERE pedido_id = ?', [p.id]);
  assert.equal(item.notas, 'sin sal');
  assert.equal((await s.q('SELECT telefono FROM entregas WHERE pedido_id = ?', [p.id]))[0].telefono, '1155551234');
  const [enNube] = await qNube('SELECT datos, total FROM pedidos_online WHERE codigo = ?', [r.codigo]);
  assert.equal(enNube.datos, null, 'nombre y teléfono no quedan en la nube');
  assert.equal(enNube.total, 3000);
});

test('si el local se corta después de cargarlo y antes de avisar, no se duplica', async () => {
  const [, r] = await pedir('centro', [{ producto_id: prod.id, cantidad: 1 }]);
  assert.ok(await esperarQue(async () => (await estadoDe(r.codigo)).estado === 'recibido'));
  const antes = (await s.q('SELECT COUNT(*) AS n FROM pedidos'))[0].n;
  // La nube "no se enteró": vuelve a pendiente con los datos
  await qNube("UPDATE pedidos_online SET estado = 'pendiente', numero = NULL, datos = ? WHERE codigo = ?",
    [JSON.stringify({ cliente: 'Lucía', telefono: '1155551234', tipo: 'takeaway', items: [{ producto_id: prod.id, cantidad: 1 }] }), r.codigo]);
  assert.ok(await esperarQue(async () => (await estadoDe(r.codigo)).estado === 'recibido'));
  assert.equal((await s.q('SELECT COUNT(*) AS n FROM pedidos'))[0].n, antes, 'no se cargó dos veces');
});

test('lo que el local no puede tomar se rechaza y el cliente lo ve; lo que no está en la carta ni entra', async () => {
  assert.equal((await pedir('centro', [{ producto_id: 999999, cantidad: 1 }]))[0], 400);
  assert.equal((await pedir('centro', [{ producto_id: prod.id, cantidad: 1 }], { tipo: 'delivery' }))[0], 400, 'delivery sin dirección');
  assert.equal((await pedir('centro', [{ producto_id: prod.id, cantidad: 1 }], { telefono: '' }))[0], 400);
  // Un producto que el local dio de baja recién (la nube todavía tenía la carta vieja)
  const [{ id: localId }] = await qNube("SELECT id FROM locales WHERE cliente = 'centro'");
  await qNube("INSERT INTO pedidos_online (local_id, codigo, datos, total) VALUES (?, 'codigo-de-prueba-baja', ?, 100)",
    [localId, JSON.stringify({ cliente: 'Beto', telefono: '11', tipo: 'takeaway', items: [{ producto_id: 999999, cantidad: 1 }] })]);
  assert.ok(await esperarQue(async () => (await estadoDe('codigo-de-prueba-baja')).estado === 'rechazado'));
  assert.match((await estadoDe('codigo-de-prueba-baja')).mensaje, /Producto no disponible/);
});

test('si el local no está conectado, la nube no toma pedidos y avisa con el teléfono; soporte ve los trabados', async () => {
  // Palermo tiene carta pero nunca vino a buscar pedidos
  const [{ id: palermo }] = await qNube("SELECT id FROM locales WHERE cliente = 'palermo'");
  await qNube('INSERT INTO cartas (local_id, datos) VALUES (?, ?)', [palermo,
    JSON.stringify({ info: { nombre: 'Palermo', telefono: '11 2222-3333' }, categorias: [], productos: [{ id: 1, nombre: 'Café', precio_venta: 500 }] })]);
  const [, info] = await aNube('GET', '/l/palermo/api/publico/info');
  assert.equal(info.recibe_pedidos, false);
  const [st, r] = await pedir('palermo', [{ producto_id: 1, cantidad: 1 }]);
  assert.equal(st, 503);
  assert.match(r.error, /11 2222-3333/);

  await qNube("INSERT INTO pedidos_online (local_id, codigo, datos, creado_en) VALUES (?, 'trabado-1', '{}', datetime('now', '-5 minutes'))", [palermo]);
  alta('soporte', '--nombre', 'Soporte', '--email', 'sop@morfi.test', '--password', 'clave-segura-2');
  const { token } = (await aNube('POST', '/api/login', { email: 'sop@morfi.test', password: 'clave-segura-2' }))[1];
  const lista = await (await fetch(nubeBase + '/api/soporte/locales', { headers: { Authorization: 'Bearer ' + token } })).json();
  const p = lista.find(l => l.cliente === 'palermo');
  assert.ok(p.alertas.includes('1 pedido(s) online sin recibir en el local'), JSON.stringify(p.alertas));
  assert.equal(p.carta_online, '/l/palermo');
});

test('el pedido online directo al local sigue funcionando igual', async () => {
  const [st, r] = await s.llamar('POST', '/api/publico/pedido', { cliente: 'Ana', telefono: '1144', tipo: 'takeaway', items: [{ producto_id: prod.id, cantidad: 2 }] });
  assert.equal(st, 201);
  assert.equal(r.total, 2000);
  assert.ok(r.numero_pedido);
  const [p] = await s.q('SELECT nube_pedido_id FROM pedidos WHERE id = ?', [r.id]);
  assert.equal(p.nube_pedido_id, null);
});

test('los links de la carta del local (QR, WhatsApp, Instagram) pasan a ser los fijos de la nube', async () => {
  const [, info] = await s.llamar('GET', '/api/publico/info');
  assert.equal(info.links.carta, `${nubeBase}/l/centro/pedido.html`);
  assert.equal(info.links.whatsapp, `${nubeBase}/l/centro/pedido.html?origen=whatsapp`);
});

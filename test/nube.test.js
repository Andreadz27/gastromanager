// Morfi Nube: el local manda sus ventas y su estado; el dueño ve solo sus locales; soporte ve todos.
// Se levanta la nube real (nube/servidor.js) en una carpeta temporal y un local real que sincroniza con ella.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { iniciarServidor, esperar } = require('./helpers');
const { fechaLocal } = require('../src/tiempo');

const RAIZ = path.join(__dirname, '..');
let nube, nubeBase, datosNube, s, tokenLocal, tokenOtro, prod;
const hoy = fechaLocal();

const puertoLibre = () => new Promise(ok => { const x = net.createServer(); x.listen(0, () => { const { port } = x.address(); x.close(() => ok(port)); }); });
const alta = (...args) => execFileSync(process.execPath, [path.join(RAIZ, 'nube', 'alta.js'), ...args],
  { env: { ...process.env, NUBE_DATOS: datosNube }, encoding: 'utf8' });
async function aNube(metodo, ruta, body, token) {
  const r = await fetch(nubeBase + ruta, { method: metodo, body: body && JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) } });
  return [r.status, await r.json().catch(() => null)];
}
const ingresar = async (email, password) => (await aNube('POST', '/api/login', { email, password }))[1].token;
const esperarQue = async (cond, ms = 15000) => { for (let t = 0; t < ms; t += 200) { if (await cond()) return true; await esperar(200); } return false; };

before(async () => {
  datosNube = fs.mkdtempSync(path.join(os.tmpdir(), 'morfi-nube-'));
  tokenLocal = alta('local', '--cuenta', 'La Buena Mesa', '--nombre', 'Centro', '--cliente', 'buena-mesa-centro').match(/NUBE_TOKEN=(\S+)/)[1];
  tokenOtro = alta('local', '--cuenta', 'Otro Dueño', '--nombre', 'Bar Ajeno', '--cliente', 'bar-ajeno').match(/NUBE_TOKEN=(\S+)/)[1];
  alta('local', '--cuenta', 'Otro Dueño', '--nombre', 'Sucursal Nueva', '--cliente', 'sin-conectar');
  alta('usuario', '--cuenta', 'La Buena Mesa', '--nombre', 'Ana', '--email', 'Ana@BuenaMesa.com', '--password', 'clave-segura-1');
  alta('soporte', '--nombre', 'Soporte', '--email', 'soporte@morfi.test', '--password', 'clave-segura-2');

  const port = await puertoLibre();
  nubeBase = `http://127.0.0.1:${port}`;
  nube = spawn(process.execPath, [path.join(RAIZ, 'nube', 'servidor.js')], { env: { ...process.env, NUBE_DATOS: datosNube, PORT: String(port) }, stdio: 'ignore' });
  assert.ok(await esperarQue(async () => { try { return (await fetch(nubeBase + '/api/salud')).ok; } catch (e) { return false; } }), 'la nube no arrancó');

  s = await iniciarServidor({ NUBE_URL: nubeBase, NUBE_TOKEN: tokenLocal, NUBE_SEGUNDOS: '1' });
  [prod] = await s.q('SELECT id, nombre FROM productos WHERE activo = 1 ORDER BY id LIMIT 1');
  await s.q('UPDATE productos SET precio_venta = 1000 WHERE id = ?', [prod.id]);
});
after(async () => {
  if (s) await s.cerrar();
  if (nube) { nube.kill(); await new Promise(r => nube.exitCode !== null ? r() : nube.once('exit', r)); }
  fs.rmSync(datosNube, { recursive: true, force: true });
});

async function venta(cantidad, propina = 0) {
  const [, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'takeaway', items: [{ producto_id: prod.id, cantidad }] }, s.tokenVendedor);
  const [st] = await s.llamar('POST', `/api/pedidos/${p.id}/cobro`, { pagos: [{ metodo: 'efectivo', monto: cantidad * 1000 + propina }], propina }, s.tokenVendedor);
  assert.equal(st, 200);
  return p;
}

test('las ventas cerradas llegan a la nube y el dueño las ve (sin propina en las ventas)', async () => {
  await venta(3, 300);
  await venta(2);
  const ana = await ingresar('ana@buenamesa.com', 'clave-segura-1');
  assert.ok(await esperarQue(async () => (await aNube('GET', '/api/panel/resumen', null, ana))[1].total.tickets === 2), 'no llegaron las ventas');
  const [, r] = await aNube('GET', `/api/panel/resumen?desde=${hoy}&hasta=${hoy}`, null, ana);
  assert.equal(r.total.ventas, 5000);
  assert.equal(r.total.propinas, 300);
  assert.equal(r.total.ticket_promedio, 2500);
  assert.deepEqual(r.locales.map(l => l.nombre), ['Centro'], 'solo los locales de su cuenta');
  assert.equal(r.productos[0].producto, prod.nombre);
  assert.equal(r.productos[0].cantidad, 5);
  assert.equal((await s.q("SELECT COUNT(*) AS n FROM pedidos WHERE estado = 'pagado' AND sincronizado_nube IS NULL"))[0].n, 0);
});

test('el estado del local llega: versión, caja, facturas en espera; sin datos de clientes', async () => {
  await s.llamar('POST', '/api/caja/abrir', { monto_inicial: 0 }, s.tokenAdmin);
  const ana = await ingresar('ana@buenamesa.com', 'clave-segura-1');
  assert.ok(await esperarQue(async () => (await aNube('GET', '/api/panel/locales', null, ana))[1][0].estado.caja_abierta === true));
  const [, [local]] = await aNube('GET', '/api/panel/locales', null, ana);
  assert.equal(local.estado.version, require('../package.json').version);
  assert.equal(local.estado.facturas_en_espera, 0);
  assert.ok(local.minutos_sin_sync <= 1);
  // Lo que se guarda de cada venta: importes y productos; nada del cliente
  const sqlite3 = require('sqlite3');
  const db = new sqlite3.Database(path.join(datosNube, 'nube.db'));
  const cols = await new Promise((ok, mal) => db.all('PRAGMA table_info(ventas)', (e, r) => e ? mal(e) : ok(r)));
  await new Promise(r => db.close(r));
  assert.ok(!cols.some(c => /cliente|telefono|cuit|email/.test(c.name)));
});

test('un pedido cancelado se manda con su estado y no suma ventas', async () => {
  const [, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'takeaway', items: [{ producto_id: prod.id, cantidad: 9 }] }, s.tokenVendedor);
  assert.equal((await s.llamar('PUT', `/api/pedidos/${p.id}/cancelar`, { motivo: 'prueba' }, s.tokenAdmin))[0], 200);
  assert.ok(await esperarQue(async () => (await s.q('SELECT sincronizado_nube FROM pedidos WHERE id = ?', [p.id]))[0].sincronizado_nube === 'cancelado'));
  const ana = await ingresar('ana@buenamesa.com', 'clave-segura-1');
  assert.equal((await aNube('GET', '/api/panel/resumen', null, ana))[1].total.ventas, 5000);
});

test('reenviar una venta no la duplica (idempotente) y un token ajeno no escribe en otro local', async () => {
  const v = { pedido_id: 9001, numero: 'X-1', fecha: hoy, hora: '12:00', estado: 'pagado', total: 1000, items: [{ producto: 'Café', cantidad: 1, subtotal: 1000 }] };
  for (let i = 0; i < 2; i++) assert.equal((await aNube('POST', '/api/sync/ventas', { ventas: [v] }, tokenOtro))[0], 200);
  assert.equal((await aNube('POST', '/api/sync/ventas', { ventas: [v] }, 'mnl_falso'))[0], 401);
  assert.equal((await aNube('POST', '/api/sync/ventas', { ventas: [{ ...v, fecha: 'ayer' }] }, tokenOtro))[0], 400);

  const sop = await ingresar('soporte@morfi.test', 'clave-segura-2');
  const [, r] = await aNube('GET', `/api/panel/resumen?desde=${hoy}&hasta=${hoy}`, null, sop);
  const ajeno = r.locales.find(l => l.nombre === 'Bar Ajeno');
  assert.equal(ajeno.tickets, 1);
  assert.equal(ajeno.ventas, 1000);
  // El dueño de La Buena Mesa no ve el bar ajeno
  const ana = await ingresar('ana@buenamesa.com', 'clave-segura-1');
  assert.ok(!(await aNube('GET', '/api/panel/resumen', null, ana))[1].locales.some(l => l.nombre === 'Bar Ajeno'));
});

test('soporte ve todos los locales con alertas; el dueño no entra a soporte', async () => {
  const ana = await ingresar('ana@buenamesa.com', 'clave-segura-1');
  assert.equal((await aNube('GET', '/api/soporte/locales', null, ana))[0], 403);
  const sop = await ingresar('soporte@morfi.test', 'clave-segura-2');
  const [st, lista] = await aNube('GET', '/api/soporte/locales', null, sop);
  assert.equal(st, 200);
  assert.equal(lista.length, 3);
  assert.deepEqual(lista[0].alertas, ['Nunca se conectó a la nube'], 'el local que nunca se conectó va primero');
  assert.equal(lista[0].cliente, 'sin-conectar');
  const centro = lista.find(l => l.cliente === 'buena-mesa-centro');
  assert.ok(!centro.alertas.some(a => /Sin noticias|Nunca/.test(a)), 'el local que sincroniza no figura como caído');
});

test('login: contraseña incorrecta y panel sin sesión se rechazan', async () => {
  assert.equal((await aNube('POST', '/api/login', { email: 'ana@buenamesa.com', password: 'mala' }))[0], 400);
  assert.equal((await aNube('GET', '/api/panel/resumen'))[0], 401);
  assert.equal((await aNube('GET', '/api/panel/resumen?desde=2026-02-10&hasta=2026-02-01', null, await ingresar('ana@buenamesa.com', 'clave-segura-1')))[0], 400);
});

test('sin nube (se cayó o no hay internet) el local sigue cobrando y manda todo cuando vuelve', async () => {
  nube.kill();
  await new Promise(r => nube.exitCode !== null ? r() : nube.once('exit', r));
  const p = await venta(1);
  await esperar(2500);
  assert.equal((await s.q('SELECT sincronizado_nube FROM pedidos WHERE id = ?', [p.id]))[0].sincronizado_nube, null, 'queda pendiente');

  nube = spawn(process.execPath, [path.join(RAIZ, 'nube', 'servidor.js')], { env: { ...process.env, NUBE_DATOS: datosNube, PORT: new URL(nubeBase).port }, stdio: 'ignore' });
  assert.ok(await esperarQue(async () => (await s.q('SELECT sincronizado_nube FROM pedidos WHERE id = ?', [p.id]))[0].sincronizado_nube === 'pagado'),
    'al volver la nube se manda lo pendiente');
  const ana = await ingresar('ana@buenamesa.com', 'clave-segura-1');
  assert.equal((await aNube('GET', '/api/panel/resumen', null, ana))[1].total.ventas, 6000);
});

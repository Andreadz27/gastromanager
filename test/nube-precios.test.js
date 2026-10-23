// Morfi Nube etapa 3: precios centrales para cadenas. Nube real + dos sucursales reales de la misma cuenta.
// El dueño cambia un precio en el panel y cada sucursal lo aplica, con auditoría; soporte no toca precios.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { iniciarServidor, esperar } = require('./helpers');

const RAIZ = path.join(__dirname, '..');
let nube, nubeBase, datosNube, centro, palermo, prod, duenio, otroDuenio, soporte;

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
const precioEn = async (s, id) => (await s.q('SELECT precio_venta FROM productos WHERE id = ?', [id]))[0].precio_venta;
const filaDe = async nombre => (await aNube('GET', '/api/panel/carta', null, duenio))[1].productos.find(p => p.producto === nombre);

before(async () => {
  datosNube = fs.mkdtempSync(path.join(os.tmpdir(), 'morfi-nube-'));
  const tCentro = alta('local', '--cuenta', 'La Buena Mesa', '--nombre', 'Centro', '--cliente', 'centro').match(/NUBE_TOKEN=(\S+)/)[1];
  const tPalermo = alta('local', '--cuenta', 'La Buena Mesa', '--nombre', 'Palermo', '--cliente', 'palermo').match(/NUBE_TOKEN=(\S+)/)[1];
  alta('local', '--cuenta', 'Otro Dueño', '--nombre', 'Bar Ajeno', '--cliente', 'bar-ajeno');
  alta('usuario', '--cuenta', 'La Buena Mesa', '--nombre', 'Ana', '--email', 'ana@x.com', '--password', 'clave-segura-1');
  alta('usuario', '--cuenta', 'Otro Dueño', '--nombre', 'Beto', '--email', 'beto@x.com', '--password', 'clave-segura-3');
  alta('soporte', '--nombre', 'Soporte', '--email', 'sop@x.com', '--password', 'clave-segura-2');
  const port = await puertoLibre();
  nubeBase = `http://127.0.0.1:${port}`;
  nube = spawn(process.execPath, [path.join(RAIZ, 'nube', 'servidor.js')], { env: { ...process.env, NUBE_DATOS: datosNube, PORT: String(port) }, stdio: 'ignore' });
  assert.ok(await esperarQue(async () => { try { return (await fetch(nubeBase + '/api/salud')).ok; } catch (e) { return false; } }), 'la nube no arrancó');

  const env = t => ({ NUBE_URL: nubeBase, NUBE_TOKEN: t, NUBE_SEGUNDOS: '1', NUBE_PEDIDOS_SEGUNDOS: '1' });
  [centro, palermo] = await Promise.all([iniciarServidor(env(tCentro)), iniciarServidor(env(tPalermo))]);
  [prod] = await centro.q('SELECT id, nombre FROM productos WHERE activo = 1 AND precio_venta > 0 ORDER BY id LIMIT 1');
  await centro.q('UPDATE productos SET precio_venta = 1000 WHERE id = ?', [prod.id]);
  await palermo.q('UPDATE productos SET precio_venta = 1100 WHERE nombre = ?', [prod.nombre]);
  [duenio, otroDuenio, soporte] = await Promise.all([ingresar('ana@x.com', 'clave-segura-1'), ingresar('beto@x.com', 'clave-segura-3'), ingresar('sop@x.com', 'clave-segura-2')]);
  assert.ok(await esperarQue(async () => {
    const f = await filaDe(prod.nombre);
    return f && f.precios.length === 2 && f.precios.some(x => x.precio === 1100) && f.precios.some(x => x.precio === 1000);
  }), 'no llegaron las cartas de las dos sucursales');
});
after(async () => {
  await Promise.all([centro, palermo].filter(Boolean).map(s => s.cerrar()));
  if (nube) { nube.kill(); await new Promise(r => nube.exitCode !== null ? r() : nube.once('exit', r)); }
  fs.rmSync(datosNube, { recursive: true, force: true });
});

test('el dueño ve cada producto con el precio de cada sucursal y cuáles difieren', async () => {
  const f = await filaDe(prod.nombre);
  assert.equal(f.distinto, true);
  assert.deepEqual(f.precios.map(x => x.local).sort(), ['Centro', 'Palermo']);
});

test('un precio nuevo se aplica en todas las sucursales, queda en la auditoría y la nube lo muestra', async () => {
  const [st, r] = await aNube('POST', '/api/panel/precios', { producto: prod.nombre, precio: 1250.5 }, duenio);
  assert.equal(st, 201, JSON.stringify(r));
  assert.equal(r.sucursales, 2);
  assert.ok(await esperarQue(async () => await precioEn(centro, prod.id) === 1250.5 && await precioEn(palermo, prod.id) === 1250.5),
    'las sucursales no aplicaron el precio');
  const [aud] = await centro.q("SELECT detalle FROM auditoria WHERE accion = 'precio_desde_nube' ORDER BY id DESC LIMIT 1");
  assert.match(aud.detalle, /\$1\.000 → \$1\.250,5 \(Ana, desde Morfi Nube\)/);
  assert.ok(await esperarQue(async () => {
    const f = await filaDe(prod.nombre);
    return f.precios.every(x => x.precio === 1250.5 && x.precio_nuevo === null) && !f.distinto;
  }), 'la carta de la nube no se actualizó');
  // La carta online también tiene el precio nuevo
  const [, menu] = await aNube('GET', '/l/centro/api/publico/menu');
  assert.equal(menu.productos.find(p => p.id === prod.id).precio_venta, 1250.5);
});

test('se puede cambiar solo en algunas sucursales', async () => {
  const f = await filaDe(prod.nombre);
  const idPalermo = f.precios.find(x => x.local === 'Palermo').local_id;
  assert.equal((await aNube('POST', '/api/panel/precios', { producto: prod.nombre, precio: 1400, locales: [idPalermo] }, duenio))[0], 201);
  assert.ok(await esperarQue(async () => await precioEn(palermo, prod.id) === 1400));
  await esperar(1500);
  assert.equal(await precioEn(centro, prod.id), 1250.5, 'Centro no cambia');
});

test('si el producto ya no está activo en una sucursal, se avisa en el panel', async () => {
  // El dueño pidió el cambio con la carta vieja y Palermo dio de baja el producto en el medio
  const [otro] = await palermo.q('SELECT id, nombre FROM productos WHERE activo = 1 AND precio_venta > 0 AND nombre <> ? ORDER BY id LIMIT 1', [prod.nombre]);
  await palermo.q('UPDATE productos SET activo = 0 WHERE id = ?', [otro.id]);
  const sqlite3 = require('sqlite3');
  const db = new sqlite3.Database(path.join(datosNube, 'nube.db'));
  await new Promise((ok, mal) => db.run(`INSERT INTO cambios_precio (local_id, producto_id, producto, precio)
    SELECT id, ?, ?, 777 FROM locales WHERE cliente = 'palermo'`, [otro.id, otro.nombre], e => e ? mal(e) : ok()));
  await new Promise(r => db.close(r));
  assert.ok(await esperarQue(async () => {
    const p = (await aNube('GET', '/api/panel/locales', null, duenio))[1].find(l => l.nombre === 'Palermo');
    return p.alertas.includes('1 cambio(s) de precio que el local no pudo aplicar');
  }), 'no aparece el aviso');
  assert.notEqual(await precioEn(palermo, otro.id), 777);
});

test('soporte no cambia precios, otro dueño no ve ni toca esta cadena, y se valida el precio', async () => {
  assert.equal((await aNube('GET', '/api/panel/carta', null, soporte))[0], 403);
  assert.equal((await aNube('POST', '/api/panel/precios', { producto: prod.nombre, precio: 1 }, soporte))[0], 403);
  const [, ajena] = await aNube('GET', '/api/panel/carta', null, otroDuenio);
  assert.equal(ajena.productos.length, 0);
  assert.equal((await aNube('POST', '/api/panel/precios', { producto: prod.nombre, precio: 1 }, otroDuenio))[0], 404);
  assert.equal((await aNube('POST', '/api/panel/precios', { producto: prod.nombre, precio: 0 }, duenio))[0], 400);
  assert.equal((await aNube('POST', '/api/panel/precios', { producto: prod.nombre, precio: 'mucho' }, duenio))[0], 400);
  assert.equal((await aNube('POST', '/api/panel/precios', { producto: 'No existe', precio: 10 }, duenio))[0], 404);
  assert.equal((await aNube('POST', '/api/sync/cambios/1', {}, 'mnl_falso'))[0], 401);
});

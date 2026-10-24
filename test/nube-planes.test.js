// Planes desde Morfi Nube: soporte asigna el plan, el local recibe la licencia firmada y la nube aplica el mismo plan
// al panel del dueño y a la carta online.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { iniciarServidor, esperar } = require('./helpers');

const RAIZ = path.join(__dirname, '..');
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const PUBLICA = publicKey.export({ type: 'spki', format: 'pem' });
const PRIVADA = privateKey.export({ type: 'pkcs8', format: 'pem' });
let nube, nubeBase, datosNube, s;

const puertoLibre = () => new Promise(ok => { const x = net.createServer(); x.listen(0, () => { const { port } = x.address(); x.close(() => ok(port)); }); });
const alta = (...args) => execFileSync(process.execPath, [path.join(RAIZ, 'nube', 'alta.js'), ...args],
  { env: { ...process.env, NUBE_DATOS: datosNube }, encoding: 'utf8' });
async function aNube(metodo, ruta, body, token) {
  const r = await fetch(nubeBase + ruta, { method: metodo, body: body && JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) } });
  return [r.status, await r.json().catch(() => null)];
}
const esperarQue = async (cond, ms = 15000) => { for (let t = 0; t < ms; t += 200) { if (await cond()) return true; await esperar(200); } return false; };
const planLocal = async () => (await s.llamar('GET', '/api/licencia', null, s.tokenAdmin))[1];

before(async () => {
  datosNube = fs.mkdtempSync(path.join(os.tmpdir(), 'morfi-nube-'));
  const salida = alta('local', '--cuenta', 'Bar Chico', '--nombre', 'Centro', '--cliente', 'bar-chico', '--plan', 'esencial');
  assert.match(salida, /plan Esencial, sin vencimiento/);
  const token = salida.match(/NUBE_TOKEN=(\S+)/)[1];
  alta('usuario', '--cuenta', 'Bar Chico', '--nombre', 'Leo', '--email', 'leo@bar.com', '--password', 'clave-segura-1');

  const port = await puertoLibre();
  nubeBase = `http://127.0.0.1:${port}`;
  nube = spawn(process.execPath, [path.join(RAIZ, 'nube', 'servidor.js')],
    { env: { ...process.env, NUBE_DATOS: datosNube, PORT: String(port), NUBE_CLAVE_LICENCIAS: PRIVADA }, stdio: 'ignore' });
  assert.ok(await esperarQue(async () => { try { return (await fetch(nubeBase + '/api/salud')).ok; } catch (e) { return false; } }), 'la nube no arrancó');
  s = await iniciarServidor({ NUBE_URL: nubeBase, NUBE_TOKEN: token, NUBE_SEGUNDOS: '1', MORFI_LICENCIA_PUBLICA: PUBLICA });
});
after(async () => {
  if (s) await s.cerrar();
  if (nube) { nube.kill(); await new Promise(r => nube.exitCode !== null ? r() : nube.once('exit', r)); }
  fs.rmSync(datosNube, { recursive: true, force: true });
});

test('el local recibe el plan Esencial de la nube y la nube no da panel ni carta online', async () => {
  assert.ok(await esperarQue(async () => (await planLocal()).origen === 'licencia'), 'no llegó la licencia');
  const e = await planLocal();
  assert.equal(e.plan, 'esencial');
  assert.equal(e.cliente, 'bar-chico');
  assert.equal((await s.llamar('GET', '/api/contabilidad/gastos', null, s.tokenAdmin))[0], 402);

  const leo = (await aNube('POST', '/api/login', { email: 'leo@bar.com', password: 'clave-segura-1' }))[1].token;
  const [st, r] = await aNube('GET', '/api/panel/resumen', null, leo);
  assert.equal(st, 402);
  assert.match(r.error, /Pro/);
  assert.equal((await aNube('GET', '/api/panel/carta', null, leo))[0], 402, 'precios centrales: plan Cadenas');
  // La carta llega a la nube igual, pero no se publica
  assert.ok(await esperarQue(async () => (await aNube('GET', '/l/bar-chico/api/publico/menu'))[0] === 404));
});

test('soporte pasa el local a Pro: en unos segundos el local y el panel lo tienen', async () => {
  assert.match(alta('plan', '--cliente', 'bar-chico', '--plan', 'pro', '--vence', '2099-01-31'), /plan Pro, vence el 2099-01-31/);
  assert.ok(await esperarQue(async () => (await planLocal()).plan === 'pro'), 'el local no recibió el plan nuevo');
  assert.equal((await planLocal()).vence, '2099-01-31');
  assert.equal((await s.llamar('GET', '/api/contabilidad/gastos', null, s.tokenAdmin))[0], 200);
  const leo = (await aNube('POST', '/api/login', { email: 'leo@bar.com', password: 'clave-segura-1' }))[1].token;
  assert.equal((await aNube('GET', '/api/panel/resumen', null, leo))[0], 200);
  assert.equal((await aNube('GET', '/l/bar-chico/api/publico/menu'))[0], 200);
});

test('plan o extra inválidos no se asignan', () => {
  assert.throws(() => alta('plan', '--cliente', 'bar-chico', '--plan', 'oro'), /Plan inválido/);
  assert.throws(() => alta('plan', '--cliente', 'bar-chico', '--plan', 'pro', '--extras', 'robot'), /Extra inválido/);
  assert.throws(() => alta('plan', '--cliente', 'no-existe', '--plan', 'pro'), /No existe el local/);
});

// Utilidades para los tests: levantan un servidor real sobre una base nueva
// en una carpeta temporal (nunca se toca data/gastromanager.db).
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3');

const RAIZ = path.join(__dirname, '..');
const SECRET_KEY = 'clave-de-test-' + 'x'.repeat(40);

const puertoLibre = () => new Promise((ok, mal) => {
  const s = net.createServer();
  s.listen(0, () => { const { port } = s.address(); s.close(() => ok(port)); });
  s.on('error', mal);
});

const esperar = ms => new Promise(r => setTimeout(r, ms));

async function iniciarServidor() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-test-'));
  const env = { ...process.env, GM_DATA_DIR: dataDir, SECRET_KEY, NODE_ENV: 'test' };
  execFileSync(process.execPath, [path.join(RAIZ, 'init-db.js')], { env, stdio: 'ignore' });

  const port = await puertoLibre();
  const proc = spawn(process.execPath, [path.join(RAIZ, 'server.js')], { env: { ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  proc.stdout.on('data', d => { log += d; });
  proc.stderr.on('data', d => { log += d; });
  const base = `http://127.0.0.1:${port}`;

  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + '/')).ok) break; } catch (e) {}
    if (proc.exitCode !== null) throw new Error('El servidor no arrancó:\n' + log);
    await esperar(100);
  }

  const db = new sqlite3.Database(path.join(dataDir, 'gastromanager.db'));
  db.configure('busyTimeout', 10000);
  const q = (sql, p = []) => new Promise((ok, mal) => db.all(sql, p, (e, r) => e ? mal(e) : ok(r)));

  // Admin sin cambio de contraseña pendiente + un vendedor
  await q('UPDATE usuarios SET debe_cambiar_password = 0');
  const admin = (await q("SELECT id FROM usuarios WHERE rol = 'admin' LIMIT 1"))[0];
  const tokenAdmin = jwt.sign({ id: admin.id }, SECRET_KEY);
  const rv = await llamar(base, 'POST', '/api/usuarios', { nombre: 'Vendedor Test', email: 'vendedor@test.com', password: 'vendedor123', rol: 'vendedor' }, tokenAdmin);
  await q('UPDATE usuarios SET debe_cambiar_password = 0');
  const tokenVendedor = jwt.sign({ id: rv[1].id }, SECRET_KEY);

  return {
    base, dataDir, q, tokenAdmin, tokenVendedor, vendedorId: rv[1].id,
    token: id => jwt.sign({ id }, SECRET_KEY),
    llamar: (metodo, ruta, body, token, headers) => llamar(base, metodo, ruta, body, token, headers),
    log: () => log,
    async cerrar() {
      await new Promise(r => db.close(r));
      proc.kill();
      await new Promise(r => proc.exitCode !== null ? r() : proc.once('exit', r));
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  };
}

// Devuelve [status, json]
async function llamar(base, metodo, ruta, body, token, headers = {}) {
  const h = { 'Content-Type': 'application/json', ...headers };
  if (token) h.Authorization = 'Bearer ' + token;
  const r = await fetch(base + ruta, {
    method: metodo, headers: h,
    body: body === undefined || body === null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body))
  });
  let json = null;
  try { json = await r.json(); } catch (e) {}
  return [r.status, json];
}

module.exports = { iniciarServidor, SECRET_KEY, esperar };

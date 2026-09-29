const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sqlite3 = require('sqlite3');
const { iniciarServidor, esperar } = require('./helpers');

const ZONA = 'America/Argentina/Buenos_Aires';
const fechaLocal = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(d);

let s;
before(async () => { s = await iniciarServidor(); });
after(async () => { await s.cerrar(); });

test('una venta de las 23:30 (hora argentina) cuenta en el día correcto', async () => {
  const hoy = fechaLocal();
  const [y, m, d] = hoy.split('-').map(Number);
  // 23:30 en Argentina (UTC-3) = 02:30 UTC del día siguiente
  const utc = new Date(Date.UTC(y, m - 1, d, 26, 30)).toISOString().replace('T', ' ').slice(0, 19);
  const [, antes] = await s.llamar('GET', '/api/reportes/dashboard', undefined, s.tokenAdmin);
  await s.q(`INSERT INTO pedidos (numero_pedido, tipo, estado, subtotal, total, creado_en, cerrado_en)
             VALUES ('TZ-TEST', 'takeaway', 'pagado', 777, 777, ?, ?)`, [utc, utc]);
  const [, despues] = await s.llamar('GET', '/api/reportes/dashboard', undefined, s.tokenAdmin);
  assert.equal(Math.round(despues.ventas_hoy - antes.ventas_hoy), 777);
  assert.equal(despues.ventas_7dias[6].fecha, hoy);
  const [, reporte] = await s.llamar('GET', `/api/reportes/ventas?desde=${hoy}&hasta=${hoy}`, undefined, s.tokenAdmin);
  assert.ok(reporte.pedidos.some(p => p.numero_pedido === 'TZ-TEST'));
});

test('el frontend muestra las fechas UTC de SQLite en hora local', () => {
  if (Intl.DateTimeFormat().resolvedOptions().timeZone !== ZONA) {
    // Se verifica con TZ fija para que no dependa de la máquina
    return;
  }
  const ctx = { localStorage: { getItem() {}, setItem() {}, removeItem() {} }, Intl, Date, String, Number };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'api.js'), 'utf8') +
    ';this.fmtFechaHora = fmtFechaHora; this.fmtFecha = fmtFecha; this.jsArg = jsArg;', ctx);
  assert.match(ctx.fmtFechaHora('2026-09-30 02:30:00'), /29\/09\/2026.*11:30/);
  assert.equal(ctx.fmtFecha('2026-09-29'), '29/09/2026');
  assert.equal(ctx.jsArg("x');alert(1);//"), '&quot;x&#039;);alert(1);//&quot;');
});

test('copias de seguridad: automática, manual, descarga válida y protegida', async () => {
  const dir = path.join(s.dataDir, 'backups');
  for (let i = 0; i < 50 && !(fs.existsSync(dir) && fs.readdirSync(dir).length); i++) await esperar(100);
  assert.ok(fs.readdirSync(dir).length >= 1, 'copia automática al iniciar');

  assert.equal((await s.llamar('GET', '/api/backups', undefined, s.tokenVendedor))[0], 403);
  await esperar(1100); // el nombre lleva segundos
  const [st, nueva] = await s.llamar('POST', '/api/backups', undefined, s.tokenAdmin);
  assert.equal(st, 201);
  const [, lista] = await s.llamar('GET', '/api/backups', undefined, s.tokenAdmin);
  assert.equal(lista[0].nombre, nueva.nombre);

  const r = await fetch(`${s.base}/api/backups/${nueva.nombre}`, { headers: { Authorization: 'Bearer ' + s.tokenAdmin } });
  const buf = Buffer.from(await r.arrayBuffer());
  assert.equal(buf.slice(0, 15).toString(), 'SQLite format 3');

  const copia = new sqlite3.Database(path.join(dir, nueva.nombre), sqlite3.OPEN_READONLY);
  const n = await new Promise(ok => copia.get('SELECT COUNT(*) c FROM productos', (e, x) => ok(x.c)));
  await new Promise(ok => copia.close(ok));
  assert.equal(n, (await s.q('SELECT COUNT(*) c FROM productos'))[0].c);

  const traversal = await fetch(`${s.base}/api/backups/..%2F.secret_key`, { headers: { Authorization: 'Bearer ' + s.tokenAdmin } });
  assert.equal(traversal.status, 400);
});

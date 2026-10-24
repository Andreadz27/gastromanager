// Chequeos estáticos del código (no levantan el servidor)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');

test('ningún módulo usa funciones compartidas sin importarlas', () => {
  const salida = execFileSync(process.execPath, [path.join(RAIZ, 'scripts', 'verificar-nombres.js'), RAIZ], { encoding: 'utf8' });
  assert.match(salida, /Sin nombres sin definir/);
});

test('todas las rutas de la API exigen sesión, salvo las públicas y los webhooks', () => {
  const PUBLICAS = ['POST /api/auth/login', 'GET /api/publico/menu', 'GET /api/publico/info', 'POST /api/publico/pedido',
    'POST /api/webhooks/:plataforma', 'POST /api/mp/notificacion', 'POST /api/tiendanube/webhook', 'GET /api/salud',
    'GET /api/whatsapp/webhook', 'POST /api/whatsapp/webhook',
    // QR de la mesa: el cliente pide sin login; la clave de la mesa va en la ruta (test/mesa-qr.test.js)
    'GET /api/publico/mesa/:token', 'POST /api/publico/mesa/:token/pedido', 'POST /api/publico/mesa/:token/llamar',
    // Pago desde la mesa (test/pago-mesa.test.js)
    'POST /api/publico/mesa/:token/pagar', 'POST /api/publico/mesa/:token/pago/:id/verificar', 'POST /api/publico/mesa/:token/pago/:id/comprobante',
    // Imagen QR para <img src> (sin token): solo dibuja el texto que recibe (test/sin-conexion.test.js)
    'GET /api/publico/qr.svg'];
  const sinSesion = [];
  for (const archivo of fs.readdirSync(path.join(RAIZ, 'src', 'rutas'))) {
    const codigo = fs.readFileSync(path.join(RAIZ, 'src', 'rutas', archivo), 'utf8');
    for (const [, metodo, ruta, resto] of codigo.matchAll(/^app\.(get|post|put|delete)\('([^']+)',([^\n]*)/gm)) {
      const clave = `${metodo.toUpperCase()} ${ruta}`;
      if (!/\bautenticar\b/.test(resto) && !PUBLICAS.includes(clave)) sinSesion.push(`${archivo}: ${clave}`);
    }
  }
  assert.deepEqual(sinSesion, []);
});

test('el frontend no tiene páginas de diagnóstico ni credenciales escritas', () => {
  const publicas = fs.readdirSync(path.join(RAIZ, 'public'));
  for (const f of ['diag.html', 'diagnostico.html', 'test_scripts.html', 'demo.html']) assert.ok(!publicas.includes(f), f);
  const archivos = [...publicas.filter(f => f.endsWith('.html')).map(f => path.join('public', f)),
    ...fs.readdirSync(path.join(RAIZ, 'public', 'js')).map(f => path.join('public', 'js', f))];
  for (const rel of archivos) {
    const texto = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    // Contraseña de fábrica, "123456" como contraseña por defecto o la clave de sesión
    assert.doesNotMatch(texto, /admin123|password[^\n]{0,40}['"`]123456['"`]|SECRET_KEY/i, rel);
  }
});

// Demo pública: una ruta nueva de administrador tiene que decidirse a propósito (bloquearla en src/demo.js
// o anotarla acá como segura), así nadie tiene que acordarse de revisarlo.
test('demo pública: toda acción de administrador está bloqueada o declarada segura', () => {
  const { BLOQUEADAS } = require('../src/demo');
  const SEGURAS_EN_DEMO = ['PUT /api/config', 'PUT /api/delivery/plataformas', 'POST /api/delivery/plataformas',
    'DELETE /api/delivery/plataformas/:id', 'PUT /api/ganancias/config'];
  const sinDecidir = [];
  for (const archivo of fs.readdirSync(path.join(RAIZ, 'src', 'rutas'))) {
    const codigo = fs.readFileSync(path.join(RAIZ, 'src', 'rutas', archivo), 'utf8');
    for (const [, metodo, ruta] of codigo.matchAll(/^app\.(post|put|delete)\('([^']+)',[^\n]*\besAdmin\b/gm)) {
      const clave = `${metodo.toUpperCase()} ${ruta}`;
      const ejemplo = ruta.replace(/:[^/]+/g, '1');
      const bloqueada = BLOQUEADAS.some(([re, metodos]) => re.test(ejemplo) && metodos.includes(metodo.toUpperCase()));
      if (!bloqueada && !SEGURAS_EN_DEMO.includes(clave)) sinDecidir.push(`${archivo}: ${clave}`);
    }
  }
  assert.deepEqual(sinDecidir, []);
});

// El service worker servía todo desde la caché: después de una actualización los celulares seguían con el JS viejo
test('service worker: con red sirve la versión nueva; sin red, la copia guardada', async () => {
  const vm = require('vm');
  const guardado = new Map([['/js/pos.js', 'viejo']]);
  const handlers = {};
  let hayRed = true;
  const ctx = {
    URL, Promise, Response: { error: () => 'error' },
    self: { location: { origin: 'http://local' }, addEventListener: (ev, fn) => { handlers[ev] = fn; }, skipWaiting() {}, clients: { claim() {} } },
    fetch: async req => { if (!hayRed) throw new Error('offline'); return { status: 200, type: 'basic', cuerpo: 'nuevo', clone() { return this; } }; },
    caches: {
      match: async req => { const c = guardado.get(new URL(req.url || req).pathname); return c && { cuerpo: c }; },
      open: async () => ({ put: async (req, r) => guardado.set(new URL(req.url).pathname, r.cuerpo), add: async () => {} }),
      keys: async () => []
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(RAIZ, 'public', 'sw.js'), 'utf8'), ctx);
  const pedir = ruta => new Promise(ok => handlers.fetch({
    request: { url: 'http://local' + ruta, method: 'GET', mode: 'cors' }, respondWith: p => Promise.resolve(p).then(ok)
  }));
  assert.equal((await pedir('/js/pos.js')).cuerpo, 'nuevo');
  await new Promise(r => setTimeout(r, 10));
  assert.equal(guardado.get('/js/pos.js'), 'nuevo', 'actualiza la copia');
  hayRed = false;
  assert.equal((await pedir('/js/pos.js')).cuerpo, 'nuevo', 'sin red usa la copia');
});

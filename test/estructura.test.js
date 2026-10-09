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
    'POST /api/webhooks/:plataforma', 'POST /api/mp/notificacion', 'POST /api/tiendanube/webhook'];
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
    'DELETE /api/delivery/plataformas/:id'];
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

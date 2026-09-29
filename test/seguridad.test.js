const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { iniciarServidor, SECRET_KEY } = require('./helpers');

let s;
before(async () => { s = await iniciarServidor(); });
after(async () => { await s.cerrar(); });

test('el rol se toma de la base, no del token', async () => {
  const falso = jwt.sign({ id: s.vendedorId, rol: 'admin' }, SECRET_KEY);
  assert.equal((await s.llamar('GET', '/api/usuarios', undefined, falso))[0], 403);
});

test('un usuario desactivado pierde el acceso en el momento', async () => {
  await s.q('UPDATE usuarios SET activo = 0 WHERE id = ?', [s.vendedorId]);
  assert.equal((await s.llamar('GET', '/api/productos', undefined, s.tokenVendedor))[0], 401);
  await s.q('UPDATE usuarios SET activo = 1 WHERE id = ?', [s.vendedorId]);
  assert.equal((await s.llamar('GET', '/api/productos', undefined, s.tokenVendedor))[0], 200);
});

test('contraseña pendiente de cambio: solo /auth/me y /auth/password', async () => {
  await s.q('UPDATE usuarios SET debe_cambiar_password = 1 WHERE id = ?', [s.vendedorId]);
  const [st, body] = await s.llamar('GET', '/api/productos', undefined, s.tokenVendedor);
  assert.equal(st, 403);
  assert.equal(body.cambiar_password, true);
  assert.equal((await s.llamar('GET', '/api/auth/me', undefined, s.tokenVendedor))[0], 200);
  await s.q('UPDATE usuarios SET debe_cambiar_password = 0 WHERE id = ?', [s.vendedorId]);
});

test('JSON mal formado responde 400', async () => {
  assert.equal((await s.llamar('POST', '/api/auth/login', '{malo'))[0], 400);
});

test('el login se bloquea después de 10 intentos fallidos', async () => {
  const estados = [];
  for (let i = 0; i < 11; i++) {
    estados.push((await s.llamar('POST', '/api/auth/login', { email: 'nadie@test.com', password: 'mal' }))[0]);
  }
  assert.equal(estados[9], 400);
  assert.equal(estados[10], 429);
});

test('Socket.IO rechaza conexiones sin sesión', async () => {
  const conectar = async token => {
    const t = await (await fetch(s.base + '/socket.io/?EIO=4&transport=polling')).text();
    const sid = JSON.parse(t.slice(1)).sid;
    await fetch(`${s.base}/socket.io/?EIO=4&transport=polling&sid=${sid}`, { method: 'POST', body: '40' + JSON.stringify(token ? { token } : {}) });
    return (await fetch(`${s.base}/socket.io/?EIO=4&transport=polling&sid=${sid}`)).text();
  };
  assert.match(await conectar(null), /^44/);
  assert.match(await conectar(s.tokenVendedor), /^40/);
});

test('los tokens de integraciones no vuelven al navegador y solo el admin los maneja', async () => {
  assert.equal((await s.llamar('GET', '/api/integraciones/config', undefined, s.tokenVendedor))[0], 403);
  assert.equal((await s.llamar('PUT', '/api/integraciones/config/mercadopago', { access_token: 'x' }, s.tokenVendedor))[0], 403);
  await s.llamar('PUT', '/api/integraciones/config/mercadopago', { access_token: 'APP_USR-secreto', activa: true }, s.tokenAdmin);
  const [, cfg] = await s.llamar('GET', '/api/integraciones/config', undefined, s.tokenAdmin);
  assert.ok(!JSON.stringify(cfg).includes('APP_USR-secreto'));
  // Guardar de nuevo con el valor enmascarado conserva el token real
  await s.llamar('PUT', '/api/integraciones/config/mercadopago', { ...cfg.mercadopago }, s.tokenAdmin);
  const [fila] = await s.q("SELECT valor FROM integraciones_config WHERE clave = 'mercadopago'");
  assert.equal(JSON.parse(fila.valor).access_token, 'APP_USR-secreto');
});

test('webhook de delivery: API key obligatoria y nunca expuesta', async () => {
  const [plat] = await s.q('SELECT * FROM plataformas_delivery ORDER BY id LIMIT 1');
  const slug = plat.nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
  await s.q('UPDATE plataformas_delivery SET activa = 1, config = ? WHERE id = ?', ['{"modo":"manual"}', plat.id]);
  const pedido = { items: [{ nombre: 'Test', cantidad: 1, precio: 10 }] };
  assert.equal((await s.llamar('POST', `/api/webhooks/${slug}`, pedido))[0], 403, 'modo manual');

  await s.llamar('PUT', `/api/delivery/plataformas/${plat.id}/integracion`, { modo: 'api', api_key: 'CLAVE-secreta-123' }, s.tokenAdmin);
  assert.equal((await s.llamar('POST', `/api/webhooks/${slug}`, pedido, null, { 'x-api-key': 'mala' }))[0], 401);
  assert.equal((await s.llamar('POST', `/api/webhooks/${slug}`, pedido))[0], 401);
  assert.equal((await s.llamar('POST', `/api/webhooks/${slug}`, pedido, null, { 'x-api-key': 'CLAVE-secreta-123' }))[0], 201);

  const [, lista] = await s.llamar('GET', '/api/delivery/plataformas', undefined, s.tokenVendedor);
  assert.ok(!JSON.stringify(lista).includes('CLAVE-secreta'));
  assert.equal((await s.llamar('GET', `/api/delivery/plataformas/${plat.id}/integracion`, undefined, s.tokenVendedor))[0], 403);

  // Guardar el listado de plataformas no borra la API key
  await s.llamar('PUT', '/api/delivery/plataformas', { plataformas: lista }, s.tokenAdmin);
  const [fila] = await s.q('SELECT config FROM plataformas_delivery WHERE id = ?', [plat.id]);
  assert.equal(JSON.parse(fila.config).api_key, 'CLAVE-secreta-123');

  // La prueba de conexión usa el propio servidor aunque el Host sea otro
  const [, prueba] = await s.llamar('POST', `/api/delivery/plataformas/${plat.id}/integracion/test`,
    { modo: 'api', api_key: 'CLAVE-secreta-123' }, s.tokenAdmin, { Host: 'evil.example.com' });
  assert.equal(prueba.ok, true);
});

test('la pantalla de cocina exige sesión', async () => {
  assert.equal((await s.llamar('GET', '/api/cocina/display'))[0], 401);
});

test('las páginas de diagnóstico no se publican', async () => {
  for (const f of ['diag.html', 'diagnostico.html', 'test_scripts.html', 'demo.html']) {
    assert.equal((await fetch(`${s.base}/${f}`)).status, 404, f);
  }
});

test('cabeceras de seguridad (CSP)', async () => {
  const csp = (await fetch(s.base + '/')).headers.get('content-security-policy') || '';
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'self'/);
  assert.doesNotMatch(csp, /upgrade-insecure-requests/);
});

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const path = require('path');
const { iniciarServidor, SECRET_KEY } = require('./helpers');

// npm run usuario:prueba: crea un usuario que entra directo, sin cambio de contraseña pendiente
let s;
before(async () => { s = await iniciarServidor(); });
after(async () => { await s.cerrar(); });

const crear = (...args) => execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'crear-usuario-prueba.js'), ...args],
  { env: { ...process.env, GM_DATA_DIR: s.dataDir, SECRET_KEY }, encoding: 'utf8' });

test('el usuario de prueba entra y opera sin cambiar la contraseña', async () => {
  assert.match(crear(), /creado/);
  const [st, r] = await s.llamar('POST', '/api/auth/login', { email: 'prueba@gastromanager.com', password: 'Prueba2026!' });
  assert.equal(st, 200);
  const [st2] = await s.llamar('GET', '/api/usuarios', undefined, r.token);
  assert.equal(st2, 200, 'es administrador y no tiene cambio de clave pendiente');
});

test('correrlo de nuevo no duplica: reactiva y resetea la clave', async () => {
  await s.q("UPDATE usuarios SET activo = 0, debe_cambiar_password = 1 WHERE email = 'prueba@gastromanager.com'");
  assert.match(crear(), /actualizado/);
  const filas = await s.q("SELECT activo, debe_cambiar_password FROM usuarios WHERE email = 'prueba@gastromanager.com'");
  assert.deepEqual(filas.map(f => [f.activo, f.debe_cambiar_password]), [[1, 0]]);
});

test('otro rol y otra clave por parámetro; rechaza datos inválidos', async () => {
  crear('--email', 'mozo.qa@test.com', '--clave', 'MozoQa1234', '--rol', 'mozo', '--nombre', 'Mozo QA');
  const [st, r] = await s.llamar('POST', '/api/auth/login', { email: 'mozo.qa@test.com', password: 'MozoQa1234' });
  assert.equal(st, 200);
  assert.equal((await s.llamar('GET', '/api/usuarios', undefined, r.token))[0], 403, 'un mozo no administra usuarios');
  assert.throws(() => crear('--rol', 'superusuario'));
  assert.throws(() => crear('--clave', 'corta'));
});

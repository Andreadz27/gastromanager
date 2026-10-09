const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciarServidor } = require('./helpers');

// Un test por cada bug que ya pasó (ver historial de git), para que no vuelva sin avisar.
// Los demás bugs viejos ya tienen su test en flujos, productos, roles y fechas-backups (ver docs/MAPA-DE-RIESGOS.md).
let s;
before(async () => { s = await iniciarServidor(); });
after(async () => { await s.cerrar(); });

// c47e298: el asistente de primer ingreso mandaba solo algunos campos y PUT /api/config dejaba el resto en NULL
test('configuración: guardar un solo campo no borra los demás', async () => {
  const completo = { nombre_negocio: 'La Esquina', direccion: 'Corrientes 1234', telefono: '1140001234', cuit: '20-12345678-9', tasa_iva: 21 };
  assert.equal((await s.llamar('PUT', '/api/config', completo, s.tokenAdmin))[0], 200);
  const [st, cfg] = await s.llamar('PUT', '/api/config', { tipo_negocio: 'bar', modulos_activos: ['mesas', 'cocina'] }, s.tokenAdmin);
  assert.equal(st, 200);
  for (const [k, v] of Object.entries(completo)) assert.equal(cfg[k], v, k);
  assert.deepEqual(cfg.modulos_activos, ['mesas', 'cocina']);
});

// 509aa8b: editar un producto sin mandar activo/stock los dejaba en NULL y desaparecía del POS
test('productos: editar solo el precio no lo saca del POS ni le borra el stock', async () => {
  const [prod] = await s.q('SELECT id, stock_actual FROM productos WHERE activo = 1 LIMIT 1');
  assert.equal((await s.llamar('PUT', `/api/productos/${prod.id}`, { precio_venta: 4321 }, s.tokenAdmin))[0], 200);
  const [despues] = await s.q('SELECT activo, stock_actual, precio_venta FROM productos WHERE id = ?', [prod.id]);
  assert.equal(despues.activo, 1);
  assert.equal(despues.stock_actual, prod.stock_actual);
  assert.equal(despues.precio_venta, 4321);
  const [, lista] = await s.llamar('GET', '/api/productos', undefined, s.tokenVendedor);
  assert.ok(lista.some(p => p.id === prod.id), 'sigue apareciendo para vender');
});

// Encontrado en esta revisión: una copia manual mientras el local opera fallaba con
// "cannot VACUUM - SQL statements in progress" (usaba la conexión compartida)
test('copia de seguridad con el sistema en uso', async () => {
  const lecturas = Array.from({ length: 30 }, () => s.llamar('GET', '/api/productos', undefined, s.tokenVendedor));
  const [[st, copia]] = await Promise.all([s.llamar('POST', '/api/backups', undefined, s.tokenAdmin), Promise.all(lecturas)]);
  assert.equal(st, 201);
  assert.match(copia.nombre, /^gastromanager_/);
});

// Encontrado por la prueba de fuego: ningún test de API verificaba que una clave incorrecta no entre
test('login: clave incorrecta o email inexistente no entran; la correcta sí', async () => {
  const [st1, r1] = await s.llamar('POST', '/api/auth/login', { email: 'vendedor@test.com', password: 'otra-clave' });
  assert.equal(st1, 400);
  assert.equal(r1.token, undefined);
  assert.equal((await s.llamar('POST', '/api/auth/login', { email: 'nadie@test.com', password: 'vendedor123' }))[0], 400);
  assert.equal((await s.llamar('POST', '/api/auth/login', { email: 'vendedor@test.com' }))[0], 400);
  const [st, r] = await s.llamar('POST', '/api/auth/login', { email: 'vendedor@test.com', password: 'vendedor123' });
  assert.equal(st, 200);
  assert.ok(r.token);
});

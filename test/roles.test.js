const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciarServidor } = require('./helpers');

let s, t = {}, producto;
before(async () => {
  s = await iniciarServidor();
  for (const rol of ['encargado', 'mozo', 'cocina']) {
    const [st, r] = await s.llamar('POST', '/api/usuarios', { nombre: `Test ${rol}`, email: `${rol}@test.com`, password: 'clave1234', rol }, s.tokenAdmin);
    assert.equal(st, 201);
    t[rol] = s.token(r.id);
  }
  await s.q('UPDATE usuarios SET debe_cambiar_password = 0');
  t.cajero = s.tokenVendedor;
  t.admin = s.tokenAdmin;
  [producto] = await s.q('SELECT id FROM productos WHERE activo = 1 LIMIT 1');
});
after(async () => { await s.cerrar(); });

const status = async (rol, metodo, ruta, body) => (await s.llamar(metodo, ruta, body, t[rol]))[0];
const pedidoNuevo = async (rol = 'cajero', extra = {}) =>
  s.llamar('POST', '/api/pedidos', { tipo: 'salon', mesa_id: 2, items: [{ producto_id: producto.id, cantidad: 1 }], ...extra }, t[rol]);

test('el antiguo rol "vendedor" queda como cajero y la sesión trae sus permisos', async () => {
  const [{ rol }] = await s.q('SELECT rol FROM usuarios WHERE id = ?', [s.vendedorId]);
  assert.equal(rol, 'cajero');
  const [, yo] = await s.llamar('GET', '/api/auth/me', undefined, t.cajero);
  assert.equal(yo.rol_nombre, 'Cajero');
  assert.ok(yo.permisos.includes('pedidos.cobrar') && !yo.permisos.includes('admin'));
  const [, roles] = await s.llamar('GET', '/api/roles', undefined, t.mozo);
  assert.deepEqual(roles.map(r => r.id), ['admin', 'encargado', 'cajero', 'mozo', 'cocina']);
});

test('mozo: toma pedidos, pero no cobra, no descuenta, no cancela ni ve ventas', async () => {
  const [st, p] = await pedidoNuevo('mozo');
  assert.equal(st, 201);
  assert.equal(await status('mozo', 'POST', `/api/pedidos/${p.id}/items`, { producto_id: producto.id, cantidad: 1 }), 201);
  assert.equal(await status('mozo', 'GET', '/api/mesas'), 200);
  assert.equal(await status('mozo', 'PUT', '/api/mesas/3/estado', { estado: 'ocupada' }), 200);
  assert.equal(await status('mozo', 'POST', `/api/pedidos/${p.id}/imprimir/ticket`), 400, 'precuenta permitida (400 = no hay impresora)');
  assert.equal(await status('mozo', 'POST', `/api/pedidos/${p.id}/pagar`, { metodo: 'efectivo', monto: 99999 }), 403);
  assert.equal(await status('mozo', 'PUT', `/api/pedidos/${p.id}/descuento`, { descuento: 100 }), 403);
  assert.equal((await pedidoNuevo('mozo', { descuento: 500 }))[0], 403, 'tampoco con descuento al crear');
  assert.equal(await status('mozo', 'PUT', `/api/pedidos/${p.id}/cancelar`, {}), 403);
  assert.equal(await status('mozo', 'GET', '/api/caja/estado'), 403);
  assert.equal(await status('mozo', 'GET', '/api/reportes/dashboard'), 403);
  assert.equal(await status('mozo', 'POST', '/api/productos', { nombre: 'x', precio_venta: 1 }), 403);
  // El cajero sí puede cobrar ese pedido
  assert.equal(await status('cajero', 'POST', `/api/pedidos/${p.id}/pagar`, { metodo: 'efectivo', monto: 99999 }), 200);
});

test('cocina: solo la pantalla de cocina y consultar stock', async () => {
  assert.equal(await status('cocina', 'GET', '/api/cocina'), 200);
  assert.equal(await status('cocina', 'GET', '/api/cocina/display'), 200);
  assert.equal(await status('cocina', 'GET', '/api/stock'), 200);
  assert.equal(await status('cocina', 'POST', '/api/stock/movimiento', { producto_id: producto.id, tipo: 'entrada', cantidad: 1 }), 403);
  assert.equal((await pedidoNuevo('cocina'))[0], 403);
  assert.equal(await status('cocina', 'GET', '/api/pedidos'), 403);
  assert.equal(await status('cocina', 'GET', '/api/clientes'), 403);
});

test('cajero: opera la caja pero no edita la carta ni ve costos', async () => {
  assert.equal(await status('cajero', 'GET', '/api/caja/estado'), 200);
  assert.equal(await status('cajero', 'GET', '/api/reportes/dashboard'), 200);
  assert.equal(await status('cajero', 'GET', '/api/reportes/rentabilidad'), 403);
  assert.equal(await status('cajero', 'GET', '/api/caja/historial'), 403);
  assert.equal(await status('cajero', 'POST', '/api/productos', { nombre: 'x', precio_venta: 1 }), 403);
  assert.equal(await status('cajero', 'POST', '/api/integraciones/tiendanube/sync-productos'), 403);
});

test('encargado: carta, historial de caja y costos, pero no administración', async () => {
  assert.equal(await status('encargado', 'POST', '/api/productos', { nombre: 'Plato del día', precio_venta: 5000 }), 201);
  assert.equal(await status('encargado', 'POST', '/api/mesas', { nombre: 'Mesa 50' }), 201);
  assert.equal(await status('encargado', 'GET', '/api/caja/historial'), 200);
  assert.equal(await status('encargado', 'GET', '/api/reportes/rentabilidad'), 200);
  assert.equal(await status('encargado', 'GET', '/api/usuarios'), 403);
  assert.equal(await status('encargado', 'PUT', '/api/config', { nombre_negocio: 'x' }), 403);
  assert.equal(await status('encargado', 'GET', '/api/integraciones/config'), 403);
  assert.equal(await status('encargado', 'GET', '/api/impresoras'), 403);
  assert.equal(await status('encargado', 'GET', '/api/backups'), 403);
  assert.equal(await status('encargado', 'GET', '/api/auditoria'), 403);
});

test('usuarios: rol válido, edición parcial y siempre queda un administrador', async () => {
  assert.equal(await status('admin', 'POST', '/api/usuarios', { nombre: 'X', email: 'x@test.com', password: 'clave1234', rol: 'superusuario' }), 400);
  const [{ id: idMozo }] = await s.q("SELECT id FROM usuarios WHERE email = 'mozo@test.com'");
  assert.equal(await status('admin', 'PUT', `/api/usuarios/${idMozo}`, { nombre: 'Mozo Renombrado' }), 200);
  const [mozo] = await s.q('SELECT nombre, rol, activo FROM usuarios WHERE id = ?', [idMozo]);
  assert.deepEqual({ ...mozo }, { nombre: 'Mozo Renombrado', rol: 'mozo', activo: 1 }, 'lo que no se envía se conserva');

  const [{ id: idAdmin }] = await s.q("SELECT id FROM usuarios WHERE rol = 'admin'");
  assert.equal(await status('admin', 'PUT', `/api/usuarios/${idAdmin}`, { rol: 'cajero' }), 400);
  assert.equal(await status('admin', 'DELETE', `/api/usuarios/${idAdmin}`), 400);
  // Con un segundo administrador activo sí se puede
  await s.llamar('POST', '/api/usuarios', { nombre: 'Admin 2', email: 'admin2@test.com', password: 'clave1234', rol: 'admin' }, t.admin);
  assert.equal(await status('admin', 'PUT', `/api/usuarios/${idAdmin}`, { rol: 'encargado' }), 200);
  // Y el cambio de rol tiene efecto inmediato en la sesión abierta
  assert.equal(await status('admin', 'GET', '/api/usuarios'), 403);
});

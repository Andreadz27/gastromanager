const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciarServidor } = require('./helpers');

// Demo pública (GM_DEMO=1): se bloquea lo que deja afuera a otros visitantes o conecta el servidor con otras direcciones
let s, demo;
before(async () => {
  s = await iniciarServidor({ GM_DEMO: '1', GM_DEMO_REINICIO_HORAS: '4' });
  demo = await iniciarServidor();
});
after(async () => { await s.cerrar(); await demo.cerrar(); });

test('datos de ingreso de la demo solo en modo demo', async () => {
  const [st, d] = await s.llamar('GET', '/api/demo');
  assert.equal(st, 200);
  assert.equal(d.reinicio_horas, 4);
  assert.equal(d.usuarios.length, 5);
  assert.equal((await demo.llamar('GET', '/api/demo'))[0], 404);
});

test('usuarios, contraseñas, impresoras, integraciones y copias bloqueados', async () => {
  const [, yo] = await s.llamar('GET', '/api/auth/me', undefined, s.tokenAdmin);
  for (const [metodo, ruta, body] of [
    ['POST', '/api/usuarios', { nombre: 'X', email: 'x@x.com', password: 'clave1234', rol: 'admin' }],
    ['PUT', `/api/usuarios/${yo.id}`, { password: 'otraclave1' }],
    ['DELETE', `/api/usuarios/${s.vendedorId}`],
    ['PUT', '/api/auth/password', { actual: 'admin123', nueva: 'otraclave1' }],
    ['POST', '/api/impresoras', { nombre: 'X', tipo: 'red', destino: '10.0.0.1:22' }],
    ['PUT', '/api/impresion/config', { activa: true }],
    ['PUT', '/api/integraciones/config/mercadopago', { access_token: 'APP_USR-x' }],
    ['POST', '/api/integraciones/test/mercadopago'],
    ['POST', '/api/backups'],
    ['GET', '/api/backups/gastromanager_2026-01-01_000000.db']
  ]) {
    const [st, r] = await s.llamar(metodo, ruta, body, s.tokenAdmin);
    assert.equal(st, 403, `${metodo} ${ruta}`);
    assert.equal(r.demo, true);
  }
});

test('el resto del sistema funciona: vender, cobrar y cargar gastos', async () => {
  const [prod] = await s.q('SELECT id FROM productos WHERE activo = 1 LIMIT 1');
  const [st, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'takeaway', items: [{ producto_id: prod.id, cantidad: 1 }] }, s.tokenVendedor);
  assert.equal(st, 201);
  const [, ped] = await s.llamar('GET', `/api/pedidos/${p.id}`, undefined, s.tokenVendedor);
  assert.equal((await s.llamar('POST', `/api/pedidos/${p.id}/pagar`, { metodo: 'efectivo', monto: ped.total }, s.tokenVendedor))[0], 200);
  assert.equal((await s.llamar('POST', '/api/contabilidad/gastos', { fecha: '2026-10-01', categoria: 'otros', descripcion: 'Prueba', neto: 100 }, s.tokenAdmin))[0], 201);
  assert.equal((await s.llamar('PUT', '/api/config', { nombre_negocio: 'Mi resto' }, s.tokenAdmin))[0], 200);
});

test('fuera de la demo nada cambia', async () => {
  assert.equal((await demo.llamar('POST', '/api/backups', undefined, demo.tokenAdmin))[0], 201);
});

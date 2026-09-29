const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciarServidor } = require('./helpers');

let s;
before(async () => { s = await iniciarServidor(); });
after(async () => { await s.cerrar(); });

test('crear producto exige nombre, precio válido y categoría existente', async () => {
  const crear = body => s.llamar('POST', '/api/productos', body, s.tokenAdmin);
  assert.equal((await crear({ nombre: 'Sin precio' }))[0], 400);
  assert.equal((await crear({ nombre: 'Precio texto', precio_venta: 'abc' }))[0], 400);
  assert.equal((await crear({ nombre: 'Negativo', precio_venta: -5 }))[0], 400);
  assert.equal((await crear({ precio_venta: 100 }))[0], 400);
  assert.equal((await crear({ nombre: 'Categoría falsa', precio_venta: 100, categoria_id: 9999 }))[0], 400);
  const [st, r] = await crear({ nombre: 'Milanesa napolitana', precio_venta: 8500, categoria_id: 2, tracking_stock: 1, stock_actual: 10 });
  assert.equal(st, 201);
  const [p] = await s.q('SELECT * FROM productos WHERE id = ?', [r.id]);
  assert.equal(p.precio_venta, 8500);
  assert.equal(p.activo, 1);
  assert.equal(p.stock_actual, 10);
});

test('editar un producto no lo oculta ni borra su stock', async () => {
  const [, r] = await s.llamar('POST', '/api/productos', { nombre: 'Flan casero', precio_venta: 2000, tracking_stock: 1, stock_actual: 15 }, s.tokenAdmin);
  // Lo mismo que envía el formulario de edición (sin activo ni stock_actual)
  const [st] = await s.llamar('PUT', `/api/productos/${r.id}`, {
    nombre: 'Flan casero con dulce', descripcion: '', categoria_id: 4, es_plato: true,
    precio_venta: 2200, costo: 800, unidad: 'porción', stock_minimo: 3, tracking_stock: 1
  }, s.tokenAdmin);
  assert.equal(st, 200);
  const [p] = await s.q('SELECT * FROM productos WHERE id = ?', [r.id]);
  assert.equal(p.activo, 1);
  assert.equal(p.stock_actual, 15);
  assert.equal(p.precio_venta, 2200);
  const [, lista] = await s.llamar('GET', '/api/productos', undefined, s.tokenVendedor);
  assert.ok(lista.some(x => x.id === r.id), 'sigue apareciendo en el POS');
});

test('editar un proveedor no lo oculta', async () => {
  const [, r] = await s.llamar('POST', '/api/proveedores', { nombre: 'Verdulería Test' }, s.tokenAdmin);
  await s.llamar('PUT', `/api/proveedores/${r.id}`, { nombre: 'Verdulería Test SRL', cuit: '', telefono: '', email: '', direccion: '', notas: '' }, s.tokenAdmin);
  const [, lista] = await s.llamar('GET', '/api/proveedores', undefined, s.tokenAdmin);
  assert.ok(lista.some(p => p.id === r.id && p.nombre === 'Verdulería Test SRL'));
});

test('actualización parcial: 404 si no existe, 400 si no hay datos', async () => {
  assert.equal((await s.llamar('PUT', '/api/clientes/99999', { nombre: 'x' }, s.tokenAdmin))[0], 404);
  assert.equal((await s.llamar('PUT', '/api/categorias/1', {}, s.tokenAdmin))[0], 400);
});

test('los datos de ejemplo no se duplican al reinicializar la base', async () => {
  const productos = await s.q('SELECT nombre, COUNT(*) c FROM productos GROUP BY nombre HAVING c > 1');
  assert.deepEqual(productos, []);
  assert.equal((await s.q('SELECT COUNT(*) c FROM plataformas_delivery'))[0].c, 3);
});

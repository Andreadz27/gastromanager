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

// El número de pedido llevaba la fecha del servidor: en Render (UTC) los pedidos de después
// de las 21 h de Argentina salían con la fecha de mañana. Se prueba con servidores en UTC+14 y UTC-12:
// a cualquier hora, al menos uno de los dos tiene otra fecha que Argentina.
test('número de pedido con la fecha del negocio aunque el servidor esté en otra zona', async () => {
  const { iniciarServidor: iniciar } = require('./helpers');
  for (const TZ of ['Pacific/Kiritimati', 'Etc/GMT+12']) {
    const srv = await iniciar({ TZ });
    try {
      const [prod] = await srv.q('SELECT id FROM productos WHERE activo = 1 LIMIT 1');
      const [st, p] = await srv.llamar('POST', '/api/pedidos', { tipo: 'takeaway', items: [{ producto_id: prod.id, cantidad: 1 }] }, srv.tokenVendedor);
      assert.equal(st, 201);
      const hoyArg = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date()).replace(/-/g, '');
      assert.match(p.numero_pedido, new RegExp(`^P-${hoyArg}-\\d{5}$`), TZ);
    } finally { await srv.cerrar(); }
  }
});

// ===== Auditoría de lanzamiento (2026-10) =====

const productoA = async (precio = 1000) => {
  const [p] = await s.q('SELECT id FROM productos WHERE activo = 1 ORDER BY id LIMIT 1');
  await s.q('UPDATE productos SET precio_venta = ? WHERE id = ?', [precio, p.id]);
  return p.id;
};
const mesaLibre = async () => {
  const r = await s.q("INSERT INTO mesas (nombre, capacidad, sector, orden, estado) VALUES ('Test ' || abs(random() % 100000), 4, 'Test', 99, 'libre') RETURNING id");
  return r[0].id;
};

// "LISTO" en cocina solo avisaba: la comanda volvía a aparecer y la pantalla nunca se vaciaba
test('cocina: LISTO saca la comanda de la pantalla y vuelve si se agregan ítems', async () => {
  const prod = await productoA();
  const [, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'takeaway', items: [{ producto_id: prod, cantidad: 1 }] }, s.tokenVendedor);
  const enCocina = async ruta => (await s.llamar('GET', ruta, undefined, s.tokenAdmin))[1].some(c => c.id === p.id);
  assert.equal(await enCocina('/api/cocina'), true);
  assert.equal((await s.llamar('PUT', `/api/cocina/${p.id}/listo`, {}, s.tokenAdmin))[0], 200);
  assert.equal(await enCocina('/api/cocina'), false);
  assert.equal(await enCocina('/api/cocina/display'), false);
  await s.llamar('POST', `/api/pedidos/${p.id}/items`, { producto_id: prod, cantidad: 1 }, s.tokenVendedor);
  assert.equal(await enCocina('/api/cocina/display'), true, 'lo agregado vuelve a cocina');
  assert.equal((await s.llamar('POST', `/api/cocina/display/${p.id}/listo`, {}, s.tokenAdmin))[0], 200);
  assert.equal(await enCocina('/api/cocina/display'), false);
  const [{ estado }] = await s.q('SELECT estado FROM pedidos WHERE id = ?', [p.id]);
  assert.equal(estado, 'abierto', 'sigue abierto para cobrarlo');
});

// Dos mozos abrían la misma mesa desde dos celulares; al cobrar uno, la mesa quedaba libre con el otro abierto
test('mesas: un solo pedido abierto por mesa y no se libera a mano ni al cancelar la reserva', async () => {
  const prod = await productoA();
  const mesa = await mesaLibre();
  const abrir = () => s.llamar('POST', '/api/pedidos', { tipo: 'salon', mesa_id: mesa, items: [{ producto_id: prod, cantidad: 1 }] }, s.tokenVendedor);
  const [st1, p] = await abrir();
  assert.equal(st1, 201);
  const [st2, r2] = await abrir();
  assert.equal(st2, 409);
  assert.match(r2.error, new RegExp(p.numero_pedido));
  assert.equal((await s.llamar('PUT', `/api/mesas/${mesa}/estado`, { estado: 'libre' }, s.tokenVendedor))[0], 409);
  const [, reserva] = await s.llamar('POST', '/api/reservas', { mesa_id: mesa, cliente: 'Ana', fecha: '2030-01-01', hora: '21:00' }, s.tokenVendedor);
  await s.llamar('PUT', `/api/reservas/${reserva.id}`, { estado: 'cancelada' }, s.tokenVendedor);
  assert.equal((await s.q('SELECT estado FROM mesas WHERE id = ?', [mesa]))[0].estado, 'ocupada');
  await s.llamar('POST', `/api/pedidos/${p.id}/pagar`, { metodo: 'efectivo', monto: 1000 }, s.tokenVendedor);
  assert.equal((await s.q('SELECT estado FROM mesas WHERE id = ?', [mesa]))[0].estado, 'libre');
  assert.equal((await abrir())[0], 201, 'cobrada, se puede volver a abrir');
});

// El OR sin paréntesis hacía que el filtro por estado no filtrara
test('delivery: el filtro por estado de envío filtra', async () => {
  const prod = await productoA();
  const crear = () => s.llamar('POST', '/api/pedidos', { tipo: 'delivery', direccion: 'Calle 1', telefono: '1144445555', items: [{ producto_id: prod, cantidad: 1 }] }, s.tokenVendedor);
  const [, a] = await crear();
  await crear();
  await s.q("UPDATE entregas SET estado = 'entregado' WHERE pedido_id = ?", [a.id]);
  const [, entregados] = await s.llamar('GET', '/api/delivery/pedidos?estado=entregado', undefined, s.tokenAdmin);
  assert.ok(entregados.length >= 1);
  assert.ok(entregados.every(e => e.estado_envio === 'entregado'), JSON.stringify(entregados.map(e => e.estado_envio)));
});

// 1.15 × 3 = 3.4499999999999997 llegaba así a ARCA
test('totales redondeados a centavos', async () => {
  const prod = await productoA(1.15);
  const [, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'takeaway', items: [{ producto_id: prod, cantidad: 3 }] }, s.tokenVendedor);
  assert.equal(p.total, 3.45);
  const [item] = await s.q('SELECT subtotal FROM pedido_items WHERE pedido_id = ?', [p.id]);
  assert.equal(item.subtotal, 3.45);
});

// La carta online (sin login) aceptaba cantidades sin tope y miles de ítems, y los mandaba a imprimir
test('pedido online: topes, precio de la base y teléfono guardado para avisar por WhatsApp', async () => {
  const prod = await productoA(1500);
  const pedir = body => s.llamar('POST', '/api/publico/pedido', { cliente: 'Ana', telefono: '11 5555-1234', tipo: 'takeaway', ...body });
  assert.equal((await pedir({ items: [{ producto_id: prod, cantidad: 999999999 }] }))[0], 400);
  assert.equal((await pedir({ items: [{ producto_id: prod, cantidad: 51 }] }))[0], 400, 'tope de 50 por producto');
  assert.equal((await pedir({ items: Array.from({ length: 31 }, () => ({ producto_id: prod, cantidad: 1 })) }))[0], 400);
  const [gratis] = await s.q("INSERT INTO productos (nombre, precio_venta, activo) VALUES ('Insumo sin precio', 0, 1) RETURNING id");
  assert.equal((await pedir({ items: [{ producto_id: gratis.id, cantidad: 1 }] }))[0], 400);

  const [st, p] = await pedir({ items: [{ producto_id: prod, cantidad: 2, precio: 1 }] });
  assert.equal(st, 201, JSON.stringify(p));
  assert.equal(p.total, 3000, 'el precio sale de la base');
  const [e] = await s.q('SELECT tipo, telefono FROM entregas WHERE pedido_id = ?', [p.id]);
  assert.deepEqual({ ...e }, { tipo: 'takeaway', telefono: '11 5555-1234' });
});

// Flujos completos de uso, como los haría el personal de un restaurante
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciarServidor } = require('./helpers');

let s, t = {}, prod = {};
before(async () => {
  s = await iniciarServidor();
  for (const rol of ['mozo', 'cocina']) {
    const [, r] = await s.llamar('POST', '/api/usuarios', { nombre: `Test ${rol}`, email: `${rol}@test.com`, password: 'clave1234', rol }, s.tokenAdmin);
    t[rol] = s.token(r.id);
  }
  await s.q('UPDATE usuarios SET debe_cambiar_password = 0');
  t.cajero = s.tokenVendedor;
  t.admin = s.tokenAdmin;
  for (const p of await s.q('SELECT id, nombre, precio_venta FROM productos')) prod[p.nombre] = p;
});
after(async () => { await s.cerrar(); });

const ok = async (promesa, estado = 200) => {
  const [st, body] = await promesa;
  assert.equal(st, estado, JSON.stringify(body));
  return body;
};
const api = (rol, metodo, ruta, body) => s.llamar(metodo, ruta, body, t[rol]);
const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());

test('un turno completo: caja, mesa, cocina, agregado, descuento, cobro y reportes', async () => {
  const milanesa = prod['Milanesa con papas'], cafe = prod['Café Expresso'], flan = prod['Flan con crema'];
  const [{ s: stockAntes }] = await s.q('SELECT stock_actual s FROM productos WHERE id = ?', [milanesa.id]);

  // 1. El cajero abre la caja
  await ok(api('cajero', 'POST', '/api/caja/abrir', { monto_inicial: 10000 }), 201);

  // 2. El mozo toma el pedido de la mesa 4
  const pedido = await ok(api('mozo', 'POST', '/api/pedidos', {
    tipo: 'salon', mesa_id: 4, items: [{ producto_id: milanesa.id, cantidad: 2, notas: 'Una sin sal' }, { producto_id: cafe.id, cantidad: 2 }]
  }), 201);
  assert.equal(pedido.total, 2 * milanesa.precio_venta + 2 * cafe.precio_venta);
  const mesas = await ok(api('mozo', 'GET', '/api/mesas'));
  assert.equal(mesas.find(m => m.id === 4).estado, 'ocupada');

  // 3. Cocina ve la comanda con las notas y la marca lista
  const comandas = await ok(api('cocina', 'GET', '/api/cocina'));
  const comanda = comandas.find(c => c.id === pedido.id);
  assert.ok(comanda.items.some(i => i.nombre_producto === 'Milanesa con papas' && i.notas === 'Una sin sal'));
  await ok(api('cocina', 'PUT', `/api/cocina/${pedido.id}/listo`, {}));

  // 4. El mozo agrega un postre; el cajero aplica un descuento
  await ok(api('mozo', 'POST', `/api/pedidos/${pedido.id}/items`, { producto_id: flan.id, cantidad: 1 }), 201);
  const conDescuento = await ok(api('cajero', 'PUT', `/api/pedidos/${pedido.id}/descuento`, { descuento: 1000 }));
  const esperado = 2 * milanesa.precio_venta + 2 * cafe.precio_venta + flan.precio_venta - 1000;
  assert.equal(conDescuento.total, esperado);

  // 5. Cobro con tarjeta: la mesa se libera, sale de cocina y descuenta stock
  await ok(api('cajero', 'POST', `/api/pedidos/${pedido.id}/pagar`, { metodo: 'tarjeta', monto: esperado }));
  const detalle = await ok(api('cajero', 'GET', `/api/pedidos/${pedido.id}`));
  assert.equal(detalle.estado, 'pagado');
  assert.equal(detalle.pagos[0].metodo, 'tarjeta');
  assert.equal((await ok(api('mozo', 'GET', '/api/mesas'))).find(m => m.id === 4).estado, 'libre');
  assert.ok(!(await ok(api('cocina', 'GET', '/api/cocina'))).some(c => c.id === pedido.id));
  const [{ s: stockDespues }] = await s.q('SELECT stock_actual s FROM productos WHERE id = ?', [milanesa.id]);
  assert.equal(stockAntes - stockDespues, 2);
  const movimientos = await ok(api('cajero', 'GET', '/api/stock/movimientos'));
  assert.ok(movimientos.some(m => m.producto_id === milanesa.id && m.tipo === 'venta' && m.cantidad === -2));

  // 6. La caja, el reporte del día y el dashboard reflejan la venta
  const caja = await ok(api('cajero', 'GET', '/api/caja/estado'));
  assert.equal(caja.resumen.por_metodo.find(m => m.metodo === 'tarjeta').total, esperado);
  assert.equal(caja.resumen.efectivo_esperado, 10000, 'una venta con tarjeta no suma efectivo');
  const ventas = await ok(api('cajero', 'GET', `/api/reportes/ventas?desde=${hoy()}&hasta=${hoy()}`));
  assert.ok(ventas.pedidos.some(p => p.id === pedido.id));
  const dashboard = await ok(api('cajero', 'GET', '/api/reportes/dashboard'));
  assert.ok(dashboard.ventas_hoy >= esperado && dashboard.pedidos_hoy >= 1);
  assert.ok(dashboard.top_productos.some(p => p.nombre_producto === 'Milanesa con papas'));
  const insights = await ok(api('cajero', 'GET', '/api/insights'));
  assert.ok(Array.isArray(insights.alertas) && Array.isArray(insights.recomendaciones) && insights.metricas);
  const rentabilidad = await ok(api('admin', 'GET', '/api/reportes/rentabilidad'));
  assert.ok(rentabilidad.find(r => r.nombre === 'Milanesa con papas').vendidos >= 2);

  // 7. Cierre de caja sin diferencias
  const cierre = await ok(api('cajero', 'POST', '/api/caja/cerrar', { monto_final_real: 10000 }));
  assert.equal(cierre.diferencia, 0);
});

test('lista de pedidos: filtros abiertos, pagados y todos (como los pide la pantalla)', async () => {
  const [, abierto] = await api('mozo', 'POST', '/api/pedidos', { tipo: 'salon', mesa_id: 9, items: [{ producto_id: prod['Coca-Cola 500ml'].id, cantidad: 1 }] });
  const abiertos = await ok(api('mozo', 'GET', `/api/pedidos?estado=abiertos&fecha=${hoy()}`));
  assert.ok(abiertos.some(p => p.id === abierto.id), 'la pestaña "Abiertos" muestra el pedido');
  assert.ok(abiertos.every(p => p.estado === 'abierto'));
  // "Ver pedido" desde la mesa busca entre los abiertos sin fecha
  assert.ok((await ok(api('mozo', 'GET', '/api/pedidos?estado=abiertos'))).some(p => p.mesa_id === 9));
  const pagados = await ok(api('mozo', 'GET', '/api/pedidos?estado=pagado'));
  assert.ok(pagados.every(p => p.estado === 'pagado') && !pagados.some(p => p.id === abierto.id));
  assert.ok((await ok(api('mozo', 'GET', '/api/pedidos?estado=todos'))).some(p => p.id === abierto.id));
});

test('reservas: la mesa pasa por reservada, ocupada y libre', async () => {
  const estadoMesa = async id => (await ok(api('mozo', 'GET', '/api/mesas'))).find(m => m.id === id).estado;
  const r1 = await ok(api('mozo', 'POST', '/api/reservas', { mesa_id: 6, cliente: 'Familia Gómez', telefono: '1155551234', fecha: hoy(), hora: '21:30', personas: 5 }), 201);
  assert.equal(await estadoMesa(6), 'reservada');
  const delDia = await ok(api('mozo', 'GET', `/api/reservas?fecha=${hoy()}`));
  assert.ok(delDia.some(r => r.id === r1.id && r.cliente === 'Familia Gómez'));
  await ok(api('mozo', 'PUT', `/api/reservas/${r1.id}`, { estado: 'llego' }));
  assert.equal(await estadoMesa(6), 'ocupada');

  const r2 = await ok(api('mozo', 'POST', '/api/reservas', { mesa_id: 7, cliente: 'Pérez', fecha: hoy(), hora: '22:00' }), 201);
  assert.equal(await estadoMesa(7), 'reservada');
  await ok(api('mozo', 'PUT', `/api/reservas/${r2.id}`, { estado: 'cancelada' }));
  assert.equal(await estadoMesa(7), 'libre');
  await ok(api('mozo', 'DELETE', `/api/reservas/${r2.id}`));
  assert.ok(!(await ok(api('mozo', 'GET', '/api/reservas'))).some(r => r.id === r2.id));
});

test('carta online: menú público, pedido del cliente y seguimiento del delivery', async () => {
  const menu = await ok(s.llamar('GET', '/api/publico/menu'));
  assert.ok(menu.productos.length > 0 && menu.categorias.length > 0);
  assert.ok(!('costo' in menu.productos[0]), 'la carta pública no muestra costos');

  assert.equal((await s.llamar('POST', '/api/publico/pedido', { telefono: '11', items: [{ producto_id: prod['Pizza Margarita'].id, cantidad: 1 }] }))[0], 400);
  assert.equal((await s.llamar('POST', '/api/publico/pedido', { cliente: 'Ana', telefono: '11', items: [] }))[0], 400);
  assert.equal((await s.llamar('POST', '/api/publico/pedido', { cliente: 'Ana', telefono: '11', items: [{ producto_id: 99999, cantidad: 1 }] }))[0], 400);

  const pedido = await ok(s.llamar('POST', '/api/publico/pedido', {
    cliente: 'Ana López', telefono: '1144443333', tipo: 'delivery', direccion: 'Av. Siempre Viva 742', origen: 'whatsapp',
    items: [{ producto_id: prod['Pizza Margarita'].id, cantidad: 2, precio: 1 }]
  }), 201);
  assert.equal(pedido.total, 2 * prod['Pizza Margarita'].precio_venta, 'el precio sale de la base');
  assert.equal(pedido.origen, 'WhatsApp');

  const entregas = await ok(api('cajero', 'GET', '/api/delivery/pedidos'));
  const entrega = entregas.find(e => e.id === pedido.id);
  assert.equal(entrega.direccion, 'Av. Siempre Viva 742');
  assert.equal(entrega.estado_envio, 'pendiente');
  await ok(api('cajero', 'PUT', `/api/delivery/pedidos/${pedido.id}/estado`, { estado_envio: 'en_camino', cadete: 'Leo' }));
  const actualizada = (await ok(api('cajero', 'GET', '/api/delivery/pedidos'))).find(e => e.id === pedido.id);
  assert.equal(actualizada.estado_envio, 'en_camino');
  assert.equal(actualizada.cadete, 'Leo');
  assert.ok((await ok(api('cajero', 'GET', '/api/delivery/resumen'))).activos.cantidad >= 1);
});

test('altas, cambios y bajas: clientes, promociones, categorías, productos y configuración', async () => {
  const cli = await ok(api('cajero', 'POST', '/api/clientes', { nombre: 'Juan Pérez', telefono: '1133332222', notas: 'Celíaco' }), 201);
  await ok(api('cajero', 'PUT', `/api/clientes/${cli.id}`, { puntos: 150 }));
  assert.equal((await ok(api('cajero', 'GET', '/api/clientes'))).find(c => c.id === cli.id).puntos, 150);
  await ok(api('cajero', 'DELETE', `/api/clientes/${cli.id}`));
  assert.ok(!(await ok(api('cajero', 'GET', '/api/clientes'))).some(c => c.id === cli.id));

  const promo = await ok(api('admin', 'POST', '/api/promociones', { nombre: 'Martes 2x1', tipo: 'porcentaje', valor: 50 }), 201);
  assert.ok((await ok(api('mozo', 'GET', '/api/promociones'))).some(p => p.id === promo.id));
  await ok(api('admin', 'DELETE', `/api/promociones/${promo.id}`));
  assert.ok(!(await ok(api('mozo', 'GET', '/api/promociones'))).some(p => p.id === promo.id));

  const cat = await ok(api('admin', 'POST', '/api/categorias', { nombre: 'Minutas', color: '#ff0000', orden: 7 }), 201);
  const nuevo = await ok(api('admin', 'POST', '/api/productos', { nombre: 'Milanesa napolitana', precio_venta: 9000, categoria_id: cat.id }), 201);
  const listado = await ok(api('mozo', 'GET', '/api/productos'));
  assert.equal(listado.find(p => p.id === nuevo.id).categoria_nombre, 'Minutas');
  await ok(api('admin', 'DELETE', `/api/productos/${nuevo.id}`));
  assert.ok(!(await ok(api('mozo', 'GET', '/api/productos'))).some(p => p.id === nuevo.id), 'el producto dado de baja no se vende');
  assert.equal((await api('mozo', 'POST', '/api/pedidos', { tipo: 'takeaway', items: [{ producto_id: nuevo.id, cantidad: 1 }] }))[0], 400);

  await ok(api('admin', 'PUT', '/api/config', {
    nombre_negocio: 'La Esquina', direccion: 'Corrientes 1234', telefono: '1140001234', email: 'hola@esquina.com',
    cuit: '30-12345678-9', tasa_iva: 21, moneda: 'ARS', activar_impresion: 0
  }));
  // El asistente de primer ingreso envía solo algunos campos: no debe borrar el resto
  await ok(api('admin', 'PUT', '/api/config', { tipo_negocio: 'cafeteria', modulos_activos: ['pos', 'caja'], setup_completado: 1 }));
  const cfg = await ok(api('admin', 'GET', '/api/config'));
  assert.equal(cfg.nombre_negocio, 'La Esquina');
  assert.deepEqual(cfg.modulos_activos, ['pos', 'caja']);
  assert.equal(cfg.setup_completado, 1);
  assert.equal((await api('admin', 'PUT', '/api/config', { nombre_negocio: '  ' }))[0], 400);
  const info = await ok(s.llamar('GET', '/api/publico/info'));
  assert.equal(info.nombre, 'La Esquina');
  assert.equal(info.telefono, '1140001234');
  assert.ok(Object.keys(await ok(api('mozo', 'GET', '/api/config/perfiles'))).includes('restaurante_mediano'));
});

test('facturación AFIP: validaciones antes de llamar a ARCA', async () => {
  const [, p] = await api('cajero', 'POST', '/api/pedidos', { tipo: 'takeaway', items: [{ producto_id: prod['Coca-Cola 500ml'].id, cantidad: 1 }] });
  const facturar = body => api('cajero', 'POST', '/api/integraciones/afip/facturar', { pedido_id: p.id, ...body });
  assert.match((await facturar({ tipo_comprobante: 6 }))[1].error, /no está activa/);
  await ok(api('admin', 'PUT', '/api/integraciones/config/afip', { cuit: '20-11111111-2', access_token: 'x', activa: true, iva_tipo: 5 }));
  assert.equal((await facturar({ tipo_comprobante: 51 }))[0], 400, 'tipo no soportado');
  assert.match((await facturar({ tipo_comprobante: 1 }))[1].error, /CUIT del cliente/);
  assert.match((await facturar({ tipo_comprobante: 6 }))[1].error, /cobrados/);
  assert.deepEqual(await ok(api('cajero', 'GET', '/api/integraciones/afip/comprobantes')), []);
});

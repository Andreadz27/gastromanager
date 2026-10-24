// Casos CP-VEN: el turno completo de una venta, en orden (docs/qa/CASOS-DE-PRUEBA.md).
// Si un paso falla, los siguientes no corren: no tiene sentido cobrar un pedido que no se creó.
'use strict';
const { test, expect } = require('../fixtures');
const { PRODUCTOS } = require('../../datos');

test.describe.serial('Venta de mostrador de punta a punta', () => {
  const CLIENTE = 'Cliente QA ' + Date.now();
  const INICIAL = 5000;
  let pedido;

  test('CP-VEN-01 · el cajero abre la caja con el efectivo inicial', { tag: ['@humo', '@regresion'] }, async ({ login, caja, api }) => {
    await login.ingresarComo('cajero');
    await login.ir('caja');
    await caja.abrir(INICIAL);
    const { body } = await api.como('cajero').get('/api/caja/estado');
    expect(body).toMatchObject({ estado: 'abierta', monto_inicial: INICIAL });
  });

  test('CP-VEN-02 · toma un pedido para llevar en el punto de venta', { tag: ['@humo', '@regresion'] }, async ({ login, pos, api }) => {
    await login.ingresarComo('cajero');
    await login.ir('pos');
    await pos.agregar(PRODUCTOS.ensalada.nombre, 2);
    await pos.confirmarParaLlevar(CLIENTE, 'Sin croutons');
    const { body } = await api.como('cajero').get('/api/pedidos');
    pedido = body.find(p => p.cliente === CLIENTE);
    expect(pedido, 'el pedido se guardó').toBeTruthy();
    expect(pedido).toMatchObject({ estado: 'abierto', tipo: 'takeaway', total: PRODUCTOS.ensalada.precio * 2 });
  });

  test('CP-VEN-03 · la cocina ve la comanda y la marca lista', { tag: ['@humo', '@regresion'] }, async ({ login, cocina, api }) => {
    await login.ingresarComo('cocina');
    const comanda = cocina.comanda(pedido.numero_pedido);
    await expect(comanda).toContainText(`2× ${PRODUCTOS.ensalada.nombre}`);
    await expect(comanda).toContainText('Sin croutons');
    await cocina.marcarListo(pedido.numero_pedido);
    await expect(comanda).toBeHidden();
    const { body } = await api.como('cajero').get(`/api/pedidos/${pedido.id}`);
    expect(body.listo_en, 'queda registrada la hora en que salió').toBeTruthy();
  });

  test('CP-VEN-04 · cobra en efectivo y calcula el vuelto', { tag: ['@humo', '@regresion'] }, async ({ login, pos, api }) => {
    await login.ingresarComo('cajero');
    await login.ir('pedidos');
    const vuelto = await pos.cobrarEnEfectivo(pedido.id, pedido.total + 1000);
    expect(vuelto).toMatch(/1\.000/);
    const { body } = await api.como('cajero').get(`/api/pedidos/${pedido.id}`);
    expect(body.estado).toBe('pagado');
  });

  test('CP-VEN-05 · la caja espera el inicial más la venta y cierra sin diferencia', { tag: '@regresion' }, async ({ page, login, caja, api }) => {
    const { body: estado } = await api.como('cajero').get('/api/caja/estado');
    const esperado = estado.resumen.efectivo_esperado;
    expect(esperado).toBe(INICIAL + pedido.total);
    await login.ingresarComo('cajero');
    await login.ir('caja');
    await caja.cerrar(esperado);
    await expect(page.locator('#view-caja .caja-abierta')).toBeHidden();
    // El historial lo ve el encargado (el cajero no tiene ese permiso)
    const { body: historial } = await api.como('admin').get('/api/caja/historial');
    expect(historial[0]).toMatchObject({ estado: 'cerrada', monto_final_real: esperado, diferencia: 0 });
  });
});

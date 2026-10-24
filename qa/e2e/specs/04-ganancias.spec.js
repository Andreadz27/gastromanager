// Casos CP-GAN: "¿Cuánto gané hoy?" y la sección Ganancias (docs/qa/CASOS-DE-PRUEBA.md)
'use strict';
const { test, expect } = require('../fixtures');
const { PRODUCTOS } = require('../../datos');

test.describe('Ganancias', () => {
  test('CP-GAN-01 · la tarjeta del inicio suma la venta cobrada con tarjeta y descuenta su comisión', { tag: '@regresion' }, async ({ page, login, api }) => {
    const cajero = api.como('cajero');
    const antes = (await api.como('admin').get('/api/ganancias/hoy')).body;
    const { body: p } = await cajero.post('/api/pedidos', { tipo: 'takeaway', items: [{ producto_id: PRODUCTOS.ensalada.id, cantidad: 1 }] });
    expect((await cajero.post(`/api/pedidos/${p.id}/cobro`, { pagos: [{ metodo: 'tarjeta', monto: p.total }] })).status).toBe(200);

    const { body: g } = await api.como('admin').get('/api/ganancias/hoy');
    expect(g.ventas).toBeGreaterThan(antes.ventas);
    // Tarjeta: 3 % de comisión típica (editable en Ganancias → Comisiones y gastos fijos)
    expect(g.comisiones - antes.comisiones).toBeCloseTo(p.total * 0.03, 2);

    await login.ingresarComo('admin');
    const tarjeta = page.locator('.gan-hoy');
    await expect(tarjeta).toContainText('¿Cuánto gané hoy?');
    await expect(tarjeta).toContainText('Comisiones');
  });

  test('CP-GAN-02 · las seis pestañas de Ganancias abren sin errores', { tag: '@regresion' }, async ({ page, login }) => {
    await login.ingresarComo('admin');
    await login.ir('ganancias');
    for (const pestaña of ['resumen', 'platos', 'canales', 'fugas', 'equilibrio', 'config']) {
      // Ganancias es una constante global del frontend (public/js/ganancias.js), no una propiedad de window
      await page.evaluate(`Ganancias.setTab('${pestaña}')`);
      await expect(page.locator(`#view-ganancias button.btn-primary[onclick="Ganancias.setTab('${pestaña}')"]`).first()).toBeVisible();
      await expect(page.locator('#view-ganancias .fa-spinner')).toHaveCount(0);
      await expect(page.locator('#view-ganancias')).not.toContainText(/Error|inválid/i);
    }
  });
});

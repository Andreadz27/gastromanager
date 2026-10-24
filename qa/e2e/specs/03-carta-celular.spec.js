// Casos CP-CAR: la carta del QR en el celular del cliente (proyecto "celular": Pixel 7 emulado)
'use strict';
const { test, expect } = require('../fixtures');
const { PRODUCTOS } = require('../../datos');

test.describe('Carta pública en el celular', { tag: '@celular' }, () => {
  test('CP-CAR-01 · muestra las categorías y cada plato con su precio en pesos', { tag: '@humo' }, async ({ carta }) => {
    await carta.abrir();
    await expect(carta.secciones.filter({ hasText: 'Entradas' })).toBeVisible();
    const ensalada = carta.item(PRODUCTOS.ensalada.nombre);
    await expect(ensalada).toBeVisible();
    await expect(ensalada.locator('.menu-item-precio')).toHaveText(/\$\s?4\.500/);
  });

  test('CP-CAR-02 · al elegir una categoría muestra solo esa', async ({ carta }) => {
    await carta.abrir();
    await carta.elegirCategoria('Bebidas');
    await expect(carta.secciones).toHaveCount(1);
    await expect(carta.secciones.first()).toContainText('Bebidas');
    await expect(carta.item(PRODUCTOS.ensalada.nombre)).toHaveCount(0);
  });

  test('CP-CAR-03 · entra en la pantalla sin desplazamiento horizontal', async ({ page, carta }) => {
    await carta.abrir();
    const { ancho, contenido } = await page.evaluate(() => ({ ancho: window.innerWidth, contenido: document.documentElement.scrollWidth }));
    expect(contenido, 'el contenido no debe ser más ancho que la pantalla').toBeLessThanOrEqual(ancho);
  });

  test('CP-CAR-04 · el cliente no ve nada del sistema interno', { tag: '@seguridad' }, async ({ page, carta }) => {
    await carta.abrir();
    await expect(page.locator('body')).not.toContainText(/costo|stock|admin/i);
  });
});

// Casos CP-ACC: ingreso, salida y permisos por rol (docs/qa/CASOS-DE-PRUEBA.md)
'use strict';
const { test, expect, USUARIOS } = require('../fixtures');

test.describe('Acceso al sistema', () => {
  test('CP-ACC-01 · el cajero ingresa y ve su nombre y su rol', { tag: ['@humo', '@regresion'] }, async ({ page, login }) => {
    await login.ingresarComo('cajero');
    await expect(page.locator('#userName')).toHaveText(USUARIOS.cajero.nombre);
    await expect(page.locator('#userRole')).toHaveText('Cajero');
  });

  test('CP-ACC-02 · con la contraseña incorrecta no entra y lo explica', { tag: '@regresion' }, async ({ login }) => {
    await login.ingresar(USUARIOS.cajero.email, 'incorrecta');
    await expect(login.error).toBeVisible();
    await expect(login.error).toContainText('Credenciales incorrectas');
    await expect(login.app).toBeHidden();
  });

  test('CP-ACC-03 · al salir vuelve al ingreso y la sesión no queda guardada', { tag: '@regresion' }, async ({ page, login }) => {
    await login.ingresarComo('cajero');
    await login.salir();
    await page.reload();
    await expect(page.locator('#loginForm')).toBeVisible();
    await expect(login.app).toBeHidden();
  });

  const permisos = [
    { rol: 'mozo', inicial: 'mesas', ve: ['pos', 'mesas', 'pedidos'], noVe: ['caja', 'reportes', 'usuarios', 'config'] },
    { rol: 'cocina', inicial: 'cocina', ve: ['cocina', 'stock'], noVe: ['pos', 'caja', 'pedidos'] },
    { rol: 'cajero', inicial: 'dashboard', ve: ['pos', 'caja', 'reportes'], noVe: ['usuarios', 'config', 'integraciones'] }
  ];
  for (const p of permisos) {
    test(`CP-ACC-04 · el rol ${p.rol} arranca en ${p.inicial} y ve solo sus secciones`, { tag: '@regresion' }, async ({ page, login }) => {
      await login.ingresarComo(p.rol);
      await expect(page.locator(`#view-${p.inicial}`)).toHaveClass(/active/);
      const visibles = await login.seccionesVisibles();
      for (const v of p.ve) expect(visibles, `debería ver ${v}`).toContain(v);
      for (const v of p.noVe) expect(visibles, `no debería ver ${v}`).not.toContain(v);
    });
  }

  test('CP-ACC-05 · la API rechaza pedidos sin sesión y usuarios sin permiso', { tag: ['@humo', '@seguridad'] }, async ({ api }) => {
    expect((await api.anonimo.get('/api/pedidos')).status).toBe(401);
    expect((await api.como('cajero').get('/api/usuarios')).status).toBe(403);
    expect((await api.como('mozo').post('/api/caja/abrir', { monto_inicial: 1 })).status).toBe(403);
  });
});

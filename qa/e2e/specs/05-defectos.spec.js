// Defectos (docs/qa/DEFECTOS-CONOCIDOS.md), automatizados.
// Un defecto ABIERTO lleva test.fail(): describe el comportamiento correcto y "falla como se espera" mientras no se
// arregle; cuando alguien lo arregla, el caso pasa, Playwright lo marca como error ("expected to fail") y avisa que
// hay que cerrarlo. Un defecto CERRADO queda acá sin test.fail(), como regresión: si vuelve, la suite falla.
'use strict';
const { test, expect } = require('../fixtures');
const { PRODUCTOS } = require('../../datos');

const cerrado = id => ({ tag: ['@defecto', '@regresion'], annotation: { type: 'defecto cerrado', description: `${id} · docs/qa/DEFECTOS-CONOCIDOS.md` } });
const item = [{ producto_id: PRODUCTOS.ensalada.id, cantidad: 1 }];

test.describe('Defectos cerrados (regresión)', () => {
  test('DEF-001 · un pedido con un tipo que no existe se rechaza', cerrado('DEF-001'), async ({ api }) => {
    const r = await api.como('cajero').post('/api/pedidos', { tipo: 'nave-espacial', items: item });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('Tipo de pedido inválido');
  });

  test('DEF-002 · un pedido a una mesa que no existe explica que la mesa no existe', cerrado('DEF-002'), async ({ api }) => {
    const r = await api.como('cajero').post('/api/pedidos', { tipo: 'salon', mesa_id: 99999, items: item });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('La mesa no existe');
  });

  test('DEF-003 · un pedido para llevar no ocupa una mesa del salón (API)', cerrado('DEF-003'), async ({ api }) => {
    const cajero = api.como('cajero');
    const { body: mesas } = await cajero.get('/api/mesas');
    const libre = mesas.find(m => m.estado === 'libre');
    const llevar = await cajero.post('/api/pedidos', { tipo: 'takeaway', mesa_id: libre.id, items: item });
    expect(llevar.status).toBe(201);
    expect((await cajero.get(`/api/pedidos/${llevar.body.id}`)).body.mesa_id, 'el pedido para llevar queda sin mesa').toBeNull();
    // La mesa sigue disponible para el mozo
    const enMesa = await cajero.post('/api/pedidos', { tipo: 'salon', mesa_id: libre.id, items: item });
    expect(enMesa.status).toBe(201);
    for (const id of [llevar.body.id, enMesa.body.id]) await cajero.put(`/api/pedidos/${id}/cancelar`, { motivo: 'QA: limpieza DEF-003' });
  });

  test('DEF-003 · en el POS, elegir mesa y cambiar a "Para llevar" no deja la mesa ocupada', cerrado('DEF-003'), async ({ page, login, pos, api }) => {
    const cliente = 'QA DEF-003 ' + Date.now();
    // El POS no deja confirmar sin caja abierta (CP-VEN-05 la cerró)
    if (!(await api.como('cajero').get('/api/caja/estado')).body) await api.como('cajero').post('/api/caja/abrir', { monto_inicial: 0 });
    await login.ingresarComo('cajero');
    await login.ir('pos');
    await pos.agregar(PRODUCTOS.ensalada.nombre);
    await page.locator('#view-pos .pos-checkout-btn').click();
    await page.locator('#checkoutTipo').selectOption('salon');
    const mesa = page.locator('#checkoutMesa');
    const valor = await mesa.locator('option:not([value=""])').first().getAttribute('value');
    await mesa.selectOption(valor);
    // Se arrepiente: es para llevar. El selector de mesa se oculta, pero conservaba la mesa elegida
    await page.locator('#checkoutTipo').selectOption('takeaway');
    await expect(mesa).toBeHidden();
    await page.locator('#checkoutCliente').fill(cliente);
    await page.locator('button[onclick="POS.confirmCheckout()"]').click();
    await expect(page.locator('#toastContainer .toast.success', { hasText: 'creado' })).toBeVisible();
    const { body: pedidos } = await api.como('cajero').get('/api/pedidos');
    const p = pedidos.find(x => x.cliente === cliente);
    expect(p).toMatchObject({ tipo: 'takeaway', mesa_id: null });
    await api.como('cajero').put(`/api/pedidos/${p.id}/cancelar`, { motivo: 'QA: limpieza DEF-003' });
  });

  test('DEF-004 · no se puede crear una mesa sin nombre ni con capacidad negativa', cerrado('DEF-004'), async ({ api }) => {
    const admin = api.como('admin');
    const sinNombre = await admin.post('/api/mesas', { nombre: '  ', capacidad: 4 });
    const negativa = await admin.post('/api/mesas', { nombre: 'Mesa QA negativa', capacidad: -4 });
    for (const r of [sinNombre, negativa]) if (r.status === 201) await admin.delete(`/api/mesas/${r.body.id}`);
    expect(sinNombre.status).toBe(400);
    expect(negativa.status).toBe(400);
    // Una mesa válida se sigue creando, y editarla con capacidad 0 tampoco se puede
    const ok = await admin.post('/api/mesas', { nombre: 'Mesa QA', capacidad: 2 });
    expect(ok.status).toBe(201);
    expect((await admin.put(`/api/mesas/${ok.body.id}`, { capacidad: 0 })).status).toBe(400);
    await admin.delete(`/api/mesas/${ok.body.id}`);
  });
});

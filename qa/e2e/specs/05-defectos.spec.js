// Defectos conocidos (docs/qa/DEFECTOS-CONOCIDOS.md), automatizados.
// Cada caso describe el comportamiento CORRECTO y está marcado con test.fail(): mientras el defecto siga abierto,
// el caso "falla como se espera" y la suite queda en verde. El día que alguien lo arregla, el caso pasa,
// Playwright lo marca como error ("expected to fail") y avisa que hay que cerrar el defecto y quitar el test.fail.
'use strict';
const { test, expect } = require('../fixtures');
const { PRODUCTOS } = require('../../datos');

const defecto = id => ({ tag: '@defecto', annotation: { type: 'defecto', description: `${id} · docs/qa/DEFECTOS-CONOCIDOS.md` } });
const item = [{ producto_id: PRODUCTOS.ensalada.id, cantidad: 1 }];

test.describe('Defectos conocidos', () => {
  test.fail('DEF-001 · un pedido con un tipo que no existe se rechaza', defecto('DEF-001'), async ({ api }) => {
    const r = await api.como('cajero').post('/api/pedidos', { tipo: 'nave-espacial', items: item });
    expect(r.status).toBe(400);
  });

  test.fail('DEF-002 · un pedido a una mesa que no existe explica que la mesa no existe', defecto('DEF-002'), async ({ api }) => {
    const r = await api.como('cajero').post('/api/pedidos', { tipo: 'salon', mesa_id: 99999, items: item });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/mesa/i);
  });

  test.fail('DEF-003 · un pedido para llevar no ocupa una mesa del salón', defecto('DEF-003'), async ({ api }) => {
    const cajero = api.como('cajero');
    const { body: mesas } = await cajero.get('/api/mesas');
    const libre = mesas.find(m => m.estado === 'libre');
    const r = await cajero.post('/api/pedidos', { tipo: 'takeaway', mesa_id: libre.id, items: item });
    if (r.status === 201) {
      // Con el defecto, la mesa queda "con pedido abierto" y el mozo ya no puede abrirla
      const enMesa = await cajero.post('/api/pedidos', { tipo: 'salon', mesa_id: libre.id, items: item });
      await cajero.put(`/api/pedidos/${r.body.id}/cancelar`, { motivo: 'QA: limpieza DEF-003' });
      if (enMesa.status === 201) await cajero.put(`/api/pedidos/${enMesa.body.id}/cancelar`, { motivo: 'QA: limpieza DEF-003' });
      expect(enMesa.status, 'la mesa sigue disponible para el mozo').toBe(201);
    }
  });

  test.fail('DEF-004 · no se puede crear una mesa sin nombre ni con capacidad negativa', defecto('DEF-004'), async ({ api }) => {
    const admin = api.como('admin');
    const sinNombre = await admin.post('/api/mesas', { nombre: '', capacidad: 4 });
    const negativa = await admin.post('/api/mesas', { nombre: 'Mesa QA negativa', capacidad: -4 });
    for (const r of [sinNombre, negativa]) if (r.status === 201) await admin.delete(`/api/mesas/${r.body.id}`);
    expect(sinNombre.status).toBe(400);
    expect(negativa.status).toBe(400);
  });
});

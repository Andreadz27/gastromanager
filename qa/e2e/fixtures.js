// Fixtures de la suite: dirección del servidor de prueba, API con sesión iniciada y control de errores de JavaScript.
'use strict';
const base = require('@playwright/test');
const { USUARIOS } = require('../datos');
const { PaginaLogin } = require('./paginas/login');
const { PaginaPos } = require('./paginas/pos');
const { PaginaCaja } = require('./paginas/caja');
const { PaginaCocina } = require('./paginas/cocina');
const { PaginaCarta } = require('./paginas/carta');

const test = base.test.extend({
  baseURL: async ({}, use) => { await use(process.env.MORFI_QA_URL); },

  // Cualquier error de JavaScript en la página hace fallar el caso, aunque la pantalla "se vea bien"
  page: async ({ page }, use) => {
    const errores = [];
    page.on('pageerror', e => errores.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errores.push(m.text()); });
    page.on('dialog', d => d.accept());
    await use(page);
    base.expect(errores, 'errores de JavaScript en la página').toEqual([]);
  },

  // api.como('cajero').post('/api/pedidos', {...}) → { status, body }
  api: async ({ playwright }, use) => {
    const contexto = await playwright.request.newContext({ baseURL: process.env.MORFI_QA_URL });
    const tokens = {};
    const token = async rol => {
      if (!tokens[rol]) {
        const { email, password } = USUARIOS[rol];
        const r = await contexto.post('/api/auth/login', { data: { email, password } });
        base.expect(r.status(), `login de ${rol}`).toBe(200);
        tokens[rol] = (await r.json()).token;
      }
      return tokens[rol];
    };
    const llamar = rol => async (metodo, ruta, data) => {
      const headers = rol ? { Authorization: 'Bearer ' + await token(rol) } : {};
      const r = await contexto.fetch(ruta, { method: metodo, headers, data });
      let body = null;
      try { body = await r.json(); } catch (e) {}
      return { status: r.status(), body };
    };
    const como = rol => {
      const f = llamar(rol);
      return { get: r => f('GET', r), post: (r, d) => f('POST', r, d), put: (r, d) => f('PUT', r, d), delete: r => f('DELETE', r) };
    };
    await use({ como, anonimo: como(null) });
    await contexto.dispose();
  },

  login: async ({ page }, use) => { await use(new PaginaLogin(page)); },
  pos: async ({ page }, use) => { await use(new PaginaPos(page)); },
  caja: async ({ page }, use) => { await use(new PaginaCaja(page)); },
  cocina: async ({ page }, use) => { await use(new PaginaCocina(page)); },
  carta: async ({ page }, use) => { await use(new PaginaCarta(page)); }
});

module.exports = { test, expect: base.expect, USUARIOS };

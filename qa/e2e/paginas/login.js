// Pantalla de ingreso y menú lateral (page object)
'use strict';
const { expect } = require('@playwright/test');
const { USUARIOS } = require('../../datos');

class PaginaLogin {
  constructor(page) {
    this.page = page;
    this.email = page.locator('#loginEmail');
    this.password = page.locator('#loginPassword');
    this.entrar = page.locator('#loginForm button[type=submit]');
    this.error = page.locator('#loginError');
    this.app = page.locator('#app');
  }

  async ingresar(email, password) {
    await this.page.goto('/');
    await this.email.fill(email);
    await this.password.fill(password);
    await this.entrar.click();
  }

  // ingresarComo('cajero'): entra y espera el sistema
  async ingresarComo(rol) {
    const u = USUARIOS[rol];
    await this.ingresar(u.email, u.password);
    await expect(this.app).toBeVisible();
  }

  async salir() {
    await this.page.locator('#btnLogout').click();
    await expect(this.page.locator('#loginForm')).toBeVisible();
  }

  async ir(vista) {
    await this.page.locator(`a.nav-item[data-view="${vista}"]`).click();
    await expect(this.page.locator(`#view-${vista}`)).toHaveClass(/active/);
  }

  seccionesVisibles() {
    return this.page.locator('a.nav-item[data-view]').evaluateAll(els => els.filter(e => e.offsetParent !== null).map(e => e.dataset.view));
  }

  toast(tipo, texto) {
    return expect(this.page.locator(`#toastContainer .toast.${tipo}`, { hasText: texto })).toBeVisible();
  }
}

module.exports = { PaginaLogin };

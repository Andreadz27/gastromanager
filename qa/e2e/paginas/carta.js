// Carta pública que ve el cliente desde el QR (page object)
'use strict';
const { expect } = require('@playwright/test');

class PaginaCarta {
  constructor(page) {
    this.page = page;
    this.items = page.locator('#menuItems .menu-item-card');
    this.secciones = page.locator('#menuItems .menu-section-title');
  }

  async abrir() {
    await this.page.goto('/menu.html');
    await expect(this.items.first()).toBeVisible();
  }

  // En el celular la barra de categorías es la de arriba (mobile-cat-btn)
  async elegirCategoria(nombre) {
    await this.page.locator('#mobileCatScroll .mobile-cat-btn:visible, #menuCategorias .menu-cat-btn:visible', { hasText: nombre }).first().click();
  }

  item(nombre) {
    return this.items.filter({ hasText: nombre });
  }
}

module.exports = { PaginaCarta };

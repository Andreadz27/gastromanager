// Caja: apertura, estado y cierre (page object)
'use strict';
const { expect } = require('@playwright/test');

class PaginaCaja {
  constructor(page) {
    this.page = page;
    this.modal = page.locator('#modalContainer');
    this.abierta = page.locator('#view-caja .caja-abierta');
  }

  async abrir(montoInicial) {
    await this.page.locator('button[onclick="Caja.mostrarApertura()"]').click();
    await this.page.locator('#cajaInicial').fill(String(montoInicial));
    await this.modal.locator('button[type=submit]').click();
    await expect(this.page.locator('#toastContainer .toast.success', { hasText: 'Caja abierta' })).toBeVisible();
    await expect(this.abierta).toBeVisible();
  }

  async cerrar(efectivoContado) {
    await this.page.locator('button[onclick="Caja.mostrarCierre()"]').click();
    await this.page.locator('#cajaFinal').fill(String(efectivoContado));
    await this.modal.locator('button[type=submit]').click();
  }
}

module.exports = { PaginaCaja };

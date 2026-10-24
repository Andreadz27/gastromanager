// Punto de venta y cobro (page object)
'use strict';
const { expect } = require('@playwright/test');

class PaginaPos {
  constructor(page) {
    this.page = page;
    this.modal = page.locator('#modalContainer');
  }

  producto(nombre) {
    return this.page.locator('.pos-product-btn', { hasText: nombre });
  }

  async agregar(nombre, veces = 1) {
    const btn = this.producto(nombre);
    await expect(btn).toBeVisible();
    for (let i = 0; i < veces; i++) await btn.click();
  }

  // Confirma el pedido para llevar y devuelve el número que muestra el aviso
  async confirmarParaLlevar(cliente, notas = '') {
    await this.page.locator('#view-pos .pos-checkout-btn').click();
    await this.page.locator('#checkoutTipo').selectOption('takeaway');
    await this.page.locator('#checkoutCliente').fill(cliente);
    if (notas) await this.page.locator('#checkoutNotas').fill(notas);
    await this.page.locator('button[onclick="POS.confirmCheckout()"]').click();
    await expect(this.page.locator('#toastContainer .toast.success', { hasText: 'creado' })).toBeVisible();
  }

  // Desde Pedidos: abre el pedido y lo cobra en efectivo con lo que entrega el cliente
  async cobrarEnEfectivo(pedidoId, recibido) {
    await this.page.locator(`tr[onclick="Pedidos.verDetalle(${pedidoId})"]`).click();
    await this.page.locator(`button[onclick="Cobro.abrir(${pedidoId})"]`).click();
    await this.modal.locator('input[aria-label="Efectivo recibido"]').fill(String(recibido));
    await this.page.locator('#cobroBtn').click();
    const vuelto = this.page.locator('.cobro-vuelto');
    await expect(vuelto).toContainText('Vuelto');
    const texto = await vuelto.textContent();
    await this.modal.locator('button', { hasText: 'Listo' }).click();
    return texto;
  }
}

module.exports = { PaginaPos };

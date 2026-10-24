// Pantalla de cocina: comandas pendientes (page object)
'use strict';

class PaginaCocina {
  constructor(page) {
    this.page = page;
  }

  comanda(numeroPedido) {
    return this.page.locator('.comanda-card', { hasText: numeroPedido });
  }

  async marcarListo(numeroPedido) {
    await this.comanda(numeroPedido).locator('.btn-comanda-listo').click();
  }
}

module.exports = { PaginaCocina };

// =============================================
// GASTROMANAGER - Pedidos
// Listado, detalle y operaciones de pedidos
// =============================================

const Pedidos = {
  pedidos: [],
  filtro: 'abiertos',

  async render() {
    const view = document.getElementById('view-pedidos');
    view.innerHTML = '<div class="text-center mt-20"><i class="fas fa-spinner fa-spin fa-3x"></i></div>';
    try {
      const hoy = hoyLocal();
      this.pedidos = await API.getPedidos(this.filtro, hoy);
      this.paint(view);
    } catch (err) {
      view.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error: ${esc(err.message)}</p></div>`;
    }
  },

  setFiltro(filtro) {
    this.filtro = filtro;
    this.render();
  },

  paint(view) {
    const rows = this.pedidos.map(p => `
      <tr onclick="Pedidos.verDetalle(${p.id})" style="cursor:pointer">
        <td class="font-bold">${esc(p.numero_pedido)}</td>
        <td>${esc(p.tipo)}</td>
        <td>${esc(p.mesa_nombre || '-')}</td>
        <td>${esc(p.cliente || '-')}</td>
        <td>${Pedidos.fmtOrigen(p.origen)}</td>
        <td>${fmtEstado(p.estado)}</td>
        <td class="font-bold">${fmtMoneda(p.total)}</td>
        <td>${fmtFechaHora(p.creado_en)}</td>
      </tr>
    `).join('');

    view.innerHTML = `
      <div class="page-header">
        <div>
          <h2><i class="fas fa-receipt"></i> Pedidos</h2>
          <p>Historial y gesti\u00f3n de pedidos del d\u00eda</p>
        </div>
        <button class="btn btn-success" onclick="App.navigateTo('pos')">
          <i class="fas fa-plus"></i> Nuevo pedido
        </button>
      </div>

      <div class="filter-bar mb-20">
        <button class="btn ${this.filtro === 'abiertos' ? 'btn-primary' : 'btn-outline'}" onclick="Pedidos.setFiltro('abiertos')">Abiertos</button>
        <button class="btn ${this.filtro === 'todos' ? 'btn-primary' : 'btn-outline'}" onclick="Pedidos.setFiltro('todos')">Todos</button>
        <button class="btn ${this.filtro === 'pagado' ? 'btn-primary' : 'btn-outline'}" onclick="Pedidos.setFiltro('pagado')">Pagados</button>
        <button class="btn ${this.filtro === 'cancelado' ? 'btn-primary' : 'btn-outline'}" onclick="Pedidos.setFiltro('cancelado')">Cancelados</button>
      </div>

      <div class="card">
        ${
          this.pedidos.length > 0 ? `
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>N\u00b0</th><th>Tipo</th><th>Mesa</th><th>Cliente</th>
                  <th>Origen</th><th>Estado</th><th>Total</th><th>Fecha</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
          ` : `<div class="empty-state"><i class="fas fa-receipt"></i><p>No hay pedidos</p></div>`
        }
      </div>
    `;
  },
  fmtOrigen(origen) {
    if (!origen) return '';
    const map = {
      whatsapp:  '<span class="origen-badge wa"><i class="fab fa-whatsapp"></i> WhatsApp</span>',
      instagram: '<span class="origen-badge ig"><i class="fab fa-instagram"></i> Instagram</span>',
      web:       '<span class="origen-badge web"><i class="fas fa-globe"></i> Web</span>'
    };
    return map[origen] || '';
  },

  async cargarPedido(id) {
    return API.getPedido(id);
  },

  async verDetalle(id) {
    try {
      const p = await this.cargarPedido(id);
      this.mostrarDetalle(p);
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  mostrarDetalle(p) {
    this.ultimoPedido = p;
    const items = p.items.map(i => `
      <tr>
        <td>${i.cantidad} x</td>
        <td>${esc(i.nombre_producto)}</td>
        <td class="text-right">${fmtMoneda(i.precio_unitario)}</td>
        <td class="font-bold">${fmtMoneda(i.subtotal)}</td>
      </tr>
    `).join('');

    const pagos = p.pagos.map(pg => `
      <tr>
        <td>${fmtFechaHora(pg.fecha)}</td>
        <td>${esc(pg.metodo)}</td>
        <td class="font-bold">${fmtMoneda(pg.monto)}</td>
      </tr>
    `).join('');

    const esAbierto = p.estado === 'abierto';

    App.showModal(`
      <div class="form-group">
        <div class="grid grid-2">
          <div class="card sub-card">
            <div class="card-header"><span class="card-title"><i class="fas fa-receipt"></i> Pedido</span></div>
            <p><strong>N\u00b0:</strong> ${esc(p.numero_pedido)}</p>
            <p><strong>Fecha:</strong> ${fmtFechaHora(p.creado_en)}</p>
            <p><strong>Tipo:</strong> ${esc(p.tipo)}</p>
            <p><strong>Mesa:</strong> ${esc(p.mesa_nombre || '-')}</p>
            <p><strong>Cliente:</strong> ${esc(p.cliente || '-')}</p>
            <p><strong>Vendedor:</strong> ${esc(p.usuario_nombre || '-')}</p>
            <p><strong>Estado:</strong> ${fmtEstado(p.estado)}</p>
            <p><strong>Notas:</strong> ${esc(p.notas || '-')}</p>
            ${(p.comprobantes || []).map(c => `<p><strong>Comprobante:</strong> ${esc(c.tipo_comprobante_nombre)}
              ${String(c.punto_venta || '').padStart(4, '0')}-${String(c.numero_comprobante || '').padStart(8, '0')}
              &mdash; CAE ${esc(c.cae)}</p>`).join('')}
          </div>
          <div class="card sub-card">
            <div class="card-header"><span class="card-title"><i class="fas fa-list"></i> Items</span></div>
            <table>
              <thead><tr><th>Cant</th><th>Producto</th><th>Precio</th><th>Subtotal</th></tr></thead>
              <tbody>${items || '<tr><td colspan="4">Sin items</td></tr>'}</tbody>
            </table>
            <div class="text-right mt-10">
              <p><strong>Subtotal:</strong> ${fmtMoneda(p.subtotal)}</p>
              ${p.descuento ? `<p><strong>Descuento:</strong> -${fmtMoneda(p.descuento)}</p>` : ''}
              ${p.propina ? `<p><strong>Propina:</strong> ${fmtMoneda(p.propina)}</p>` : ''}
              <p class="font-bold text-success"><strong>TOTAL:</strong> ${fmtMoneda(p.total)}</p>
            </div>
          </div>
        </div>
      </div>

      <div class="form-group">
        <h4><i class="fas fa-credit-card"></i> Pagos</h4>
        <table>
          <thead><tr><th>Fecha</th><th>M\u00e9todo</th><th>Monto</th></tr></thead>
          <tbody>${pagos || '<tr><td colspan="3">Sin pagos</td></tr>'}</tbody>
        </table>
      </div>

      <div class="modal-footer">
        <button class="btn btn-outline" onclick="App.closeModal()">Cerrar</button>
        ${App.puede('pedidos.tomar') ? `<button class="btn btn-primary" onclick="Pedidos.imprimirTicket(${p.id})"><i class="fas fa-print"></i> ${p.estado === 'pagado' ? 'Imprimir ticket' : 'Precuenta'}</button>` : ''}
        ${p.estado !== 'cancelado' && App.puede('pedidos.tomar') ? `<button class="btn btn-outline" onclick="Pedidos.reimprimirComanda(${p.id})"><i class="fas fa-utensils"></i> Reimprimir comanda</button>` : ''}
        ${
          esAbierto ? `
          ${App.puede('pedidos.tomar') ? `<button class="btn btn-primary" onclick="Pedidos.agregarItem(${p.id})"><i class="fas fa-plus"></i> Item</button>` : ''}
          ${App.puede('pedidos.descuento') ? `<button class="btn btn-warning" onclick="Pedidos.aplicarDescuentoModal(${p.id})"><i class="fas fa-percent"></i> Descuento</button>` : ''}
          ${App.puede('pedidos.cancelar') ? `<button class="btn btn-danger" onclick="Pedidos.cancelar(${p.id})"><i class="fas fa-ban"></i> Cancelar</button>` : ''}
          ${App.puede('pedidos.cobrar') ? `
          <button class="btn btn-outline" onclick="Pedidos.linkMercadoPago(${p.id})"><i class="fas fa-link"></i> Link Mercado Pago</button>
          <button class="btn btn-success" onclick="Pedidos.mostrarPagar(${p.id})"><i class="fas fa-dollar-sign"></i> Cobrar</button>` : ''}
          ` : ''
        }
        ${
          p.estado === 'pagado' && !(p.comprobantes && p.comprobantes.length) && App.puede('pedidos.cobrar')
            ? `<button class="btn btn-primary" onclick="Integraciones.abrirModalFacturar(${p.id}, ${Number(p.total) || 0})"><i class="fas fa-file-invoice"></i> Facturar AFIP</button>`
            : ''
        }
      </div>
    `, { title: `Detalle de pedido ${p.numero_pedido}`, large: true });
  },

  // Genera un link de pago de Mercado Pago; al aprobarse, el pedido se cierra solo
  // Ticket en la impresora térmica; si no hay ninguna configurada, impresión del navegador
  async imprimirTicket(pedidoId) {
    try {
      const r = await API.imprimirTicket(pedidoId);
      const fallas = r.resultados.filter(x => !x.ok);
      if (fallas.length) App.showToast(`No se pudo imprimir en ${fallas.map(f => f.impresora).join(', ')}: ${fallas[0].error}`, 'error', 8000);
      else App.showToast('Ticket enviado a la impresora', 'success');
    } catch (err) {
      if (/No hay impresoras/.test(err.message)) App.imprimirRecibo(this.ultimoPedido);
      else App.showToast(err.message, 'error');
    }
  },

  async reimprimirComanda(pedidoId) {
    try {
      const r = await API.imprimirComanda(pedidoId);
      const fallas = r.resultados.filter(x => !x.ok);
      if (fallas.length) App.showToast(`No se pudo imprimir en ${fallas.map(f => f.impresora).join(', ')}: ${fallas[0].error}`, 'error', 8000);
      else App.showToast(`Comanda reimpresa en ${r.resultados.map(x => x.impresora).join(', ')}`, 'success');
    } catch (err) {
      App.showToast(/No hay impresoras/.test(err.message)
        ? 'No hay impresoras de comandas configuradas (Configuración → Impresoras)' : err.message, 'error');
    }
  },

  async linkMercadoPago(pedidoId) {
    try {
      const r = await API.crearLinkMercadoPago(pedidoId);
      try { await navigator.clipboard.writeText(r.link); } catch (e) {}
      window.open(r.link, '_blank', 'noopener');
      App.showToast(r.notificaciones
        ? 'Link de pago copiado. El pedido se cerrará automáticamente al aprobarse el pago.'
        : 'Link de pago copiado. Sin BASE_URL pública HTTPS, el cobro deberá registrarse a mano.',
        r.notificaciones ? 'success' : 'warning');
    } catch (err) { App.showToast(err.message, 'error'); }
  },

async abrirPedidoDeMesa(mesaId) {
    try {
      const pedidos = await API.getPedidos('abiertos');
      const pedidoDeMesa = pedidos.find(p => p.mesa_id == mesaId);
      if (pedidoDeMesa) {
        this.verDetalle(pedidoDeMesa.id);
      } else {
        App.showToast('No hay pedido abierto en esa mesa', 'warning');
      }
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  agregarItem(pedidoId) {
    const self = this;
    API.getProductos().then(productos => {
      const options = productos.map(p => `<option value="${p.id}" data-nombre="${esc(p.nombre)}" data-precio="${p.precio_venta}">${esc(p.nombre)} - ${fmtMoneda(p.precio_venta)}</option>`).join('');
      App.showModal(`
        <form onsubmit="Pedidos.guardarItem(event, ${pedidoId})">
          <div class="form-group">
            <label>Producto</label>
            <select id="itemProducto">${options}</select>
          </div>
          <div class="form-group">
            <label>Cantidad</label>
            <input type="number" id="itemCantidad" min="1" value="1" required>
          </div>
          <div class="form-group">
            <label>Notas</label>
            <textarea id="itemNotas" placeholder="Notas para cocina"></textarea>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-danger" onclick="App.closeModal()">Cancelar</button>
            <button type="submit" class="btn btn-success">Agregar</button>
          </div>
        </form>
      `, { title: 'Agregar item al pedido' });
    }).catch(err => App.showToast(err.message, 'error'));
  },

  async guardarItem(e, pedidoId) {
    e.preventDefault();
    const select = document.getElementById('itemProducto');
    const opt = select.options[select.selectedIndex];
    const data = {
      producto_id: parseInt(select.value),
      nombre: opt.getAttribute('data-nombre'),
      cantidad: parseInt(document.getElementById('itemCantidad').value),
      precio: parseFloat(opt.getAttribute('data-precio')),
      notas: document.getElementById('itemNotas').value
    };
    try {
      await API.addItemToPedido(pedidoId, data);
      App.closeModal();
      App.showToast('Item agregado', 'success');
      this.verDetalle(pedidoId);
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  aplicarDescuentoModal(pedidoId) {
    App.showModal(`
      <form onsubmit="Pedidos.aplicarDescuento(event, ${pedidoId})">
        <div class="form-group">
          <label>Descuento ($)</label>
          <input type="number" id="descuentoMonto" min="0" step="0.01" placeholder="0" required>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-danger" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-success">Aplicar</button>
        </div>
      </form>
    `, { title: 'Aplicar descuento' });
  },

  async aplicarDescuento(e, pedidoId) {
    e.preventDefault();
    const descuento = parseFloat(document.getElementById('descuentoMonto').value);
    try {
      await API.aplicarDescuento(pedidoId, descuento);
      App.closeModal();
      App.showToast('Descuento aplicado', 'success');
      this.verDetalle(pedidoId);
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  async cancelar(id) {
    if (!confirm('\u00bfSeguro que deseas cancelar este pedido?')) return;
    try {
      await API.cancelarPedido(id);
      App.closeModal();
      App.showToast('Pedido cancelado', 'success');
      this.render();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  async mostrarPagar(id) {
    const p = await this.cargarPedido(id).catch(() => null);
    if (!p) return;
    App.showModal(`
      <form onsubmit="Pedidos.confirmarPago(event, ${id})">
        <div class="totales-cliente">
          <div><span>Total a cobrar:</span><strong>${fmtMoneda(p.total)}</strong></div>
        </div>
        <div class="form-group">
          <label>M\u00e9todo de pago</label>
          <select id="pagoMetodo">
            <option value="efectivo">Efectivo</option>
            <option value="tarjeta">Tarjeta</option>
            <option value="mercadopago">Mercado Pago</option>
            <option value="transferencia">Transferencia</option>
            <option value="otro">Otro</option>
          </select>
        </div>
        <div class="form-group">
          <label>Monto recibido</label>
          <input type="number" id="pagoMonto" min="${Number(p.total) || 0}" step="0.01" value="${p.total}" required>
        </div>
        <div class="form-group">
          <label>Referencia (opcional)</label>
          <input type="text" id="pagoReferencia" placeholder="Ej: n\u00famero de operaci\u00f3n">
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-danger" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-success"><i class="fas fa-check"></i> Confirmar cobro</button>
        </div>
      </form>
    `, { title: `Cobrar pedido ${p.numero_pedido}` });
  },

  async confirmarPago(e, id) {
    e.preventDefault();
    const data = {
      metodo: document.getElementById('pagoMetodo').value,
      monto: parseFloat(document.getElementById('pagoMonto').value),
      referencia: document.getElementById('pagoReferencia').value
    };
    try {
      const res = await API.pagarPedido(id, data);
      App.closeModal();
      App.showToast(res.vuelto > 0 ? `Pago registrado. Vuelto: ${fmtMoneda(res.vuelto)}` : (res.message || 'Pago registrado'), 'success');
      this.render();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  }
};
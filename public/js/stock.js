// =============================================
// GASTROMANAGER - Stock / Inventario
// Movimientos de stock y niveles
// =============================================

const Stock = {
  stock: [],
  movimientos: [],

  async render() {
    const view = document.getElementById('view-stock');
    view.innerHTML = '<div class="text-center mt-20"><i class="fas fa-spinner fa-spin fa-3x"></i></div>';
    try {
      const [stock, movimientos] = await Promise.all([API.getStock(), API.getMovimientosStock()]);
      this.stock = stock;
      this.movimientos = movimientos;
      this.paint(view);
    } catch (err) {
      view.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error: ${esc(err.message)}</p></div>`;
    }
  },

  nivelBadge(nivel) {
    if (nivel === 'bajo') return '<span class="badge badge-red">Bajo</span>';
    if (nivel === 'medio') return '<span class="badge badge-orange">Medio</span>';
    return '<span class="badge badge-green">OK</span>';
  },

  paint(view) {
    const rows = this.stock.map(p => `
      <tr>
        <td>${esc(p.nombre)}</td>
        <td>${esc(p.categoria_nombre || '-')}</td>
        <td class="font-bold">${p.stock_actual} ${esc(p.unidad || '')}</td>
        <td>${p.stock_minimo} ${esc(p.unidad || '')}</td>
        <td>${this.nivelBadge(p.nivel)}</td>
        <td>${App.puede('stock.mover') ? `
          <button class="btn btn-success btn-sm" onclick="Stock.movimiento(${p.id}, 'entrada')">
            <i class="fas fa-arrow-up"></i> Entrada
          </button>
          <button class="btn btn-warning btn-sm" onclick="Stock.movimiento(${p.id}, 'salida')">
            <i class="fas fa-arrow-down"></i> Salida
          </button>` : ''}
        </td>
      </tr>
    `).join('');

    view.innerHTML = `
      <div class="page-header">
        <div>
          <h2><i class="fas fa-boxes"></i> Inventario</h2>
          <p>Control de stock y movimientos</p>
        </div>
        ${App.puede('stock.mover') ? `<button class="btn btn-primary" onclick="Stock.movimiento()">
          <i class="fas fa-exchange-alt"></i> Registrar movimiento
        </button>` : ''}
      </div>

      <div class="card mb-20">
        <div class="card-header">
          <span class="card-title"><i class="fas fa-box"></i> Niveles de stock</span>
        </div>
        ${
          this.stock.length > 0 ? `
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>Producto</th><th>Categor\u00eda</th><th>Stock actual</th><th>M\u00ednimo</th><th>Nivel</th><th>Movimientos</th></tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
          ` : `<div class="empty-state"><i class="fas fa-box-open"></i><p>Sin productos con control de stock</p></div>`
        }
      </div>
    `;

    const movRows = this.movimientos.map(m => `
      <tr>
        <td>${fmtFechaHora(m.fecha)}</td>
        <td>${esc(m.producto_nombre)}</td>
        <td>${m.tipo === 'entrada' ? '<span class="text-success font-bold">Entrada</span>' : '<span class="text-danger font-bold">Salida</span>'}</td>
        <td class="font-bold">${m.cantidad > 0 ? '+' : ''}${m.cantidad}</td>
        <td>${esc(m.motivo || '-')}</td>
        <td>${esc(m.usuario_nombre || '-')}</td>
      </tr>
    `).join('');

    view.innerHTML += `
      <div class="card">
        <div class="card-header">
          <span class="card-title"><i class="fas fa-history"></i> \u00daltimos movimientos</span>
        </div>
        ${
          this.movimientos.length > 0 ? `
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>Fecha</th><th>Producto</th><th>Tipo</th><th>Cantidad</th><th>Motivo</th><th>Usuario</th></tr>
              </thead>
              <tbody>${movRows}</tbody>
            </table>
          </div>
          ` : `<div class="empty-state"><i class="fas fa-history"></i><p>Sin movimientos registrados</p></div>`
        }
      </div>
    `;
  },

  movimiento(productoId = null, tipoFijo = null) {
    API.getProductos().then(productos => {
      const conStock = productos.filter(p => p.tracking_stock);
      const options = conStock.map(p =>
        `<option value="${p.id}" ${p.id === productoId ? 'selected' : ''}>${esc(p.nombre)} (stock: ${p.stock_actual})</option>`
      ).join('');
      App.showModal(`
        <form onsubmit="Stock.guardarMovimiento(event)">
          <div class="form-group">
            <label>Producto</label>
            <select id="movProducto">${options || '<option value="">Sin productos con stock</option>'}</select>
          </div>
          <div class="form-group">
            <label>Tipo</label>
            <select id="movTipo">
              <option value="entrada" ${tipoFijo === 'entrada' ? 'selected' : ''}>Entrada</option>
              <option value="salida" ${tipoFijo === 'salida' ? 'selected' : ''}>Salida</option>
            </select>
          </div>
          <div class="form-group">
            <label>Cantidad</label>
            <input type="number" id="movCantidad" min="1" value="1" required>
          </div>
          <div class="form-group">
            <label>Motivo</label>
            <input type="text" id="movMotivo" placeholder="Ej: compra a proveedor, ajuste, merma">
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-danger" onclick="App.closeModal()">Cancelar</button>
            <button type="submit" class="btn btn-success">Registrar</button>
          </div>
        </form>
      `, { title: 'Registrar movimiento de stock' });
    }).catch(err => App.showToast(err.message, 'error'));
  },

  async guardarMovimiento(e) {
    e.preventDefault();
    const data = {
      producto_id: parseInt(document.getElementById('movProducto').value),
      tipo: document.getElementById('movTipo').value,
      cantidad: parseInt(document.getElementById('movCantidad').value),
      motivo: document.getElementById('movMotivo').value
    };
    try {
      await API.registrarMovimientoStock(data);
      App.closeModal();
      App.showToast('Movimiento registrado', 'success');
      this.render();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  }
};
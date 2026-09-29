// =============================================
// GASTROMANAGER - Productos
// CRUD de productos y categor\u00edas
// =============================================

const Productos = {
  productos: [],
  categorias: [],

  async render() {
    const view = document.getElementById('view-productos');
    view.innerHTML = '<div class="text-center mt-20"><i class="fas fa-spinner fa-spin fa-3x"></i></div>';
    try {
      const [productos, categorias] = await Promise.all([API.getProductos(), API.getCategorias()]);
      this.productos = productos;
      this.categorias = categorias;
      this.paint(view);
    } catch (err) {
      view.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error: ${esc(err.message)}</p></div>`;
    }
  },

  esAdmin() {
    return App.usuario && App.usuario.rol === 'admin';
  },

  catNombre(id) {
    const c = this.categorias.find(c => c.id === id);
    return c ? c.nombre : '-';
  },

  paint(view) {
    const esAdmin = this.esAdmin();

    const rows = this.productos.map(p => `
      <tr>
        <td>${esc(p.nombre)}</td>
        <td>${esc(this.catNombre(p.categoria_id))}</td>
        <td class="font-bold">${fmtMoneda(p.precio_venta)}</td>
        <td>${fmtMoneda(p.costo)}</td>
        <td>
          ${
            p.tracking_stock ? `
            <span class="${p.stock_actual <= p.stock_minimo ? 'text-danger font-bold' : ''}">${p.stock_actual} ${esc(p.unidad || '')}</span>
            ` : '<span class="text-muted">Sin control</span>'
          }
        </td>
        <td>${p.es_plato ? '<span class="badge badge-blue">Plato</span>' : '<span class="badge badge-gray">Producto</span>'}</td>
        <td>
          ${p.activo ? '<span class="badge badge-green">Activo</span>' : '<span class="badge badge-red">Inactivo</span>'}
        </td>
        ${
          esAdmin ? `
          <td>
            <button class="btn btn-outline btn-sm" onclick="Productos.editar(${p.id})"><i class="fas fa-edit"></i></button>
            <button class="btn btn-danger btn-sm" onclick="Productos.eliminar(${p.id})"><i class="fas fa-trash"></i></button>
          </td>
          ` : ''
        }
      </tr>
    `).join('');

    const catRows = this.categorias.map(c => `
      <button class="pos-cat-btn" style="background:${esc(c.color || '#64748b')}" onclick="Productos.verCategoria(${c.id})">
        ${esc(c.nombre)}
      </button>
    `).join('');

    view.innerHTML = `
      <div class="page-header">
        <div>
          <h2><i class="fas fa-hamburger"></i> Productos</h2>
          <p>Gesti\u00f3n del men\u00fa y precios</p>
        </div>
        <div>
          ${
            esAdmin ? `
            <button class="btn btn-primary" onclick="Productos.nuevaCategoria()"><i class="fas fa-tag"></i> Categor\u00eda</button>
            <button class="btn btn-success" onclick="Productos.nuevo()"><i class="fas fa-plus"></i> Nuevo producto</button>
            ` : ''
          }
          <button class="btn btn-outline" onclick="Productos.render()"><i class="fas fa-sync-alt"></i> Refrescar</button>
        </div>
      </div>

      <div class="card mb-20">
        <div class="card-header">
          <span class="card-title"><i class="fas fa-tags"></i> Categor\u00edas</span>
        </div>
        <div class="pos-categories">${catRows || '<span class="text-muted">Sin categor\u00edas</span>'}</div>
      </div>

      <div class="card">
        ${
          this.productos.length > 0 ? `
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Producto</th><th>Categor\u00eda</th><th>Precio</th><th>Costo</th>
                  <th>Stock</th><th>Tipo</th><th>Estado</th>${esAdmin ? '<th>Acciones</th>' : ''}
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
          ` : `<div class="empty-state"><i class="fas fa-box-open"></i><p>Sin productos</p></div>`
        }
      </div>
    `;
  },

  verCategoria(id) {
    App.showToast(`Categor\u00eda ${this.catNombre(id)}`, 'info');
  },
nuevo() {
    this.abrirFormulario(null);
  },

  editar(id) {
    const p = this.productos.find(x => x.id === id);
    if (p) this.abrirFormulario(p);
  },

  abrirFormulario(p) {
    const catOptions = this.categorias.map(c =>
      `<option value="${c.id}" ${p && p.categoria_id === c.id ? 'selected' : ''}>${esc(c.nombre)}</option>`
    ).join('');

    App.showModal(`
      <form onsubmit="Productos.guardar(event, ${p ? p.id : 'null'})">
        <div class="form-group">
          <label>Nombre</label>
          <input type="text" id="prodNombre" value="${p ? esc(p.nombre) : ''}" required>
        </div>
        <div class="form-group">
          <label>Descripci\u00f3n</label>
          <textarea id="prodDescripcion">${p ? esc(p.descripcion || '') : ''}</textarea>
        </div>
        <div class="grid grid-2">
          <div class="form-group">
            <label>Categor\u00eda</label>
            <select id="prodCategoria">${catOptions}</select>
          </div>
          <div class="form-group">
            <label>Tipo</label>
            <select id="prodTipo">
              <option value="1" ${p && p.es_plato ? 'selected' : ''}>Plato</option>
              <option value="0" ${p && !p.es_plato ? 'selected' : ''}>Producto simple</option>
            </select>
          </div>
        </div>
        <div class="grid grid-2">
          <div class="form-group">
            <label>Precio de venta ($)</label>
            <input type="number" id="prodPrecio" min="0" step="0.01" value="${p ? p.precio_venta : ''}" required>
          </div>
          <div class="form-group">
            <label>Costo ($)</label>
            <input type="number" id="prodCosto" min="0" step="0.01" value="${p ? p.costo : '0'}">
          </div>
        </div>
        <div class="grid grid-2">
          <div class="form-group">
            <label>Unidad</label>
            <input type="text" id="prodUnidad" value="${p ? esc(p.unidad || '') : ''}" placeholder="Ej: unidad, kg, lt">
          </div>
          <div class="form-group">
            <label>Stock m\u00ednimo</label>
            <input type="number" id="prodStockMin" min="0" value="${p ? p.stock_minimo : '0'}">
          </div>
        </div>
        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" id="prodTracking" ${p && p.tracking_stock ? 'checked' : ''}>
            Controlar stock
          </label>
        </div>
        <div class="form-group" id="stockInicialGroup" ${(!p && 'style="display:none"') || ''}>
          <label>Stock inicial</label>
          <input type="number" id="prodStockInicial" min="0" value="${p ? p.stock_actual : '0'}">
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-danger" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-success">Guardar</button>
        </div>
      </form>
    `, { title: p ? `Editar ${p.nombre}` : 'Nuevo producto' });

    document.getElementById('prodTracking').addEventListener('change', (e) => {
      document.getElementById('stockInicialGroup').style.display = e.target.checked ? 'block' : 'none';
    });
  },
async guardar(e, id) {
    e.preventDefault();
    const data = {
      nombre: document.getElementById('prodNombre').value,
      descripcion: document.getElementById('prodDescripcion').value,
      categoria_id: parseInt(document.getElementById('prodCategoria').value),
      es_plato: document.getElementById('prodTipo').value === '1',
      precio_venta: parseFloat(document.getElementById('prodPrecio').value),
      costo: parseFloat(document.getElementById('prodCosto').value || 0),
      unidad: document.getElementById('prodUnidad').value,
      stock_minimo: parseInt(document.getElementById('prodStockMin').value || 0),
      tracking_stock: document.getElementById('prodTracking').checked ? 1 : 0
    };
    if (data.tracking_stock && !id) {
      data.stock_actual = parseInt(document.getElementById('prodStockInicial').value || 0);
    }
    try {
      if (id) {
        await API.updateProducto(id, data);
        App.showToast('Producto actualizado', 'success');
      } else {
        await API.createProducto(data);
        App.showToast('Producto creado', 'success');
      }
      App.closeModal();
      this.render();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  async eliminar(id) {
    if (!confirm('\u00bfSeguro que deseas eliminar este producto?')) return;
    try {
      await API.deleteProducto(id);
      App.showToast('Producto eliminado', 'success');
      this.render();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  nuevaCategoria() {
    App.showModal(`
      <form onsubmit="Productos.guardarCategoria(event)">
        <div class="form-group">
          <label>Nombre</label>
          <input type="text" id="catNombre" required>
        </div>
        <div class="form-group">
          <label>Descripci\u00f3n</label>
          <textarea id="catDescripcion"></textarea>
        </div>
        <div class="form-group">
          <label>Color</label>
          <input type="color" id="catColor" value="#64748b">
        </div>
        <div class="form-group">
          <label>Orden</label>
          <input type="number" id="catOrden" value="0">
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-danger" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-success">Guardar</button>
        </div>
      </form>
    `, { title: 'Nueva categor\u00eda' });
  },

  async guardarCategoria(e) {
    e.preventDefault();
    try {
      await API.createCategoria({
        nombre: document.getElementById('catNombre').value,
        descripcion: document.getElementById('catDescripcion').value,
        color: document.getElementById('catColor').value,
        orden: parseInt(document.getElementById('catOrden').value)
      });
      App.closeModal();
      App.showToast('Categor\u00eda creada', 'success');
      this.render();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  async eliminarCategoria(id) {
    if (!confirm('\u00bfSeguro que deseas eliminar esta categor\u00eda?')) return;
    try {
      await API.deleteCategoria(id);
      App.showToast('Categor\u00eda eliminada', 'success');
      this.render();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  }
};
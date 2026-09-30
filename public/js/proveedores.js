// =============================================
// GASTROMANAGER - Proveedores
// CRUD de proveedores
// =============================================

const Proveedores = {
  proveedores: [],

  async render() {
    const view = document.getElementById('view-proveedores');
    view.innerHTML = '<div class="text-center mt-20"><i class="fas fa-spinner fa-spin fa-3x"></i></div>';
    try {
      this.proveedores = await API.getProveedores();
      this.paint(view);
    } catch (err) {
      view.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error: ${esc(err.message)}</p></div>`;
    }
  },

  esAdmin() {
    return App.puede('catalogo');
  },

  paint(view) {
    const esAdmin = this.esAdmin();
    const rows = this.proveedores.map(p => `
      <tr>
        <td class="font-bold">${esc(p.nombre)}</td>
        <td>${esc(p.cuit || '-')}</td>
        <td>${esc(p.telefono || '-')}</td>
        <td>${esc(p.email || '-')}</td>
        <td>${esc(p.direccion || '-')}</td>
        ${
          esAdmin ? `
          <td>
            <button class="btn btn-outline btn-sm" onclick="Proveedores.editar(${p.id})"><i class="fas fa-edit"></i></button>
            <button class="btn btn-danger btn-sm" onclick="Proveedores.eliminar(${p.id})"><i class="fas fa-trash"></i></button>
          </td>
          ` : ''
        }
      </tr>
    `).join('');

    view.innerHTML = `
      <div class="page-header">
        <div>
          <h2><i class="fas fa-truck"></i> Proveedores</h2>
          <p>Proveedores de insumos y mercader\u00eda</p>
        </div>
        <div>
          ${
            esAdmin ? `
            <button class="btn btn-success" onclick="Proveedores.nuevo()"><i class="fas fa-plus"></i> Nuevo proveedor</button>
            ` : ''
          }
          <button class="btn btn-outline" onclick="Proveedores.render()"><i class="fas fa-sync-alt"></i> Refrescar</button>
        </div>
      </div>

      <div class="card">
        ${
          this.proveedores.length > 0 ? `
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>Nombre</th><th>CUIT</th><th>Tel\u00e9fono</th><th>Email</th><th>Direcci\u00f3n</th>${esAdmin ? '<th>Acciones</th>' : ''}</tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
          ` : `<div class="empty-state"><i class="fas fa-truck"></i><p>Sin proveedores</p></div>`
        }
      </div>
    `;
  },

  nuevo() {
    this.abrirForm(null);
  },

  editar(id) {
    const p = this.proveedores.find(x => x.id === id);
    if (p) this.abrirForm(p);
  },

  abrirForm(p) {
    App.showModal(`
      <form onsubmit="Proveedores.guardar(event, ${p ? p.id : 'null'})">
        <div class="form-group">
          <label>Nombre</label>
          <input type="text" id="provNombre" value="${p ? esc(p.nombre) : ''}" required>
        </div>
        <div class="grid grid-2">
          <div class="form-group">
            <label>CUIT</label>
            <input type="text" id="provCuit" value="${p ? esc(p.cuit || '') : ''}">
          </div>
          <div class="form-group">
            <label>Tel\u00e9fono</label>
            <input type="text" id="provTelefono" value="${p ? esc(p.telefono || '') : ''}">
          </div>
        </div>
        <div class="grid grid-2">
          <div class="form-group">
            <label>Email</label>
            <input type="email" id="provEmail" value="${p ? esc(p.email || '') : ''}">
          </div>
          <div class="form-group">
            <label>Direcci\u00f3n</label>
            <input type="text" id="provDireccion" value="${p ? esc(p.direccion || '') : ''}">
          </div>
        </div>
        <div class="form-group">
          <label>Notas</label>
          <textarea id="provNotas">${p ? esc(p.notas || '') : ''}</textarea>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-danger" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-success">Guardar</button>
        </div>
      </form>
    `, { title: p ? `Editar ${p.nombre}` : 'Nuevo proveedor' });
  },

  async guardar(e, id) {
    e.preventDefault();
    const data = {
      nombre: document.getElementById('provNombre').value,
      cuit: document.getElementById('provCuit').value,
      telefono: document.getElementById('provTelefono').value,
      email: document.getElementById('provEmail').value,
      direccion: document.getElementById('provDireccion').value,
      notas: document.getElementById('provNotas').value
    };
    try {
      if (id) {
        await API.updateProveedor(id, data);
        App.showToast('Proveedor actualizado', 'success');
      } else {
        await API.createProveedor(data);
        App.showToast('Proveedor creado', 'success');
      }
      App.closeModal();
      this.render();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  async eliminar(id) {
    if (!confirm('\u00bfSeguro que deseas eliminar este proveedor?')) return;
    try {
      await API.deleteProveedor(id);
      App.showToast('Proveedor eliminado', 'success');
      this.render();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  }
};
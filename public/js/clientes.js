// =============================================
// GASTROMANAGER - Clientes
// CRUD de clientes
// =============================================

const Clientes = {
  clientes: [],

  async render() {
    const view = document.getElementById('view-clientes');
    view.innerHTML = '<div class="text-center mt-20"><i class="fas fa-spinner fa-spin fa-3x"></i></div>';
    try {
      this.clientes = await API.getClientes();
      this.paint(view);
    } catch (err) {
      view.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error: ${esc(err.message)}</p></div>`;
    }
  },

  paint(view) {
    const rows = this.clientes.map(c => `
      <tr>
        <td class="font-bold">${esc(c.nombre)}</td>
        <td>${esc(c.telefono || '-')}</td>
        <td>${esc(c.email || '-')}</td>
        <td>${esc(c.direccion || '-')}</td>
        <td><span class="badge badge-blue">${c.puntos || 0} pts</span></td>
        <td>
          <button class="btn btn-outline btn-sm" onclick="Clientes.editar(${c.id})"><i class="fas fa-edit"></i></button>
          <button class="btn btn-danger btn-sm" onclick="Clientes.eliminar(${c.id})"><i class="fas fa-trash"></i></button>
        </td>
      </tr>
    `).join('');

    view.innerHTML = `
      <div class="page-header">
        <div>
          <h2><i class="fas fa-users"></i> Clientes</h2>
          <p>Base de clientes y programas de fidelizaci\u00f3n</p>
        </div>
        <div>
          <button class="btn btn-success" onclick="Clientes.nuevo()"><i class="fas fa-plus"></i> Nuevo cliente</button>
          <button class="btn btn-outline" onclick="Clientes.render()"><i class="fas fa-sync-alt"></i> Refrescar</button>
        </div>
      </div>

      <div class="card">
        ${
          this.clientes.length > 0 ? `
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>Nombre</th><th>Tel\u00e9fono</th><th>Email</th><th>Direcci\u00f3n</th><th>Puntos</th><th>Acciones</th></tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
          ` : `<div class="empty-state"><i class="fas fa-users"></i><p>Sin clientes registrados</p></div>`
        }
      </div>
    `;
  },

  nuevo() {
    this.abrirForm(null);
  },

  editar(id) {
    const c = this.clientes.find(x => x.id === id);
    if (c) this.abrirForm(c);
  },

  abrirForm(c) {
    App.showModal(`
      <form onsubmit="Clientes.guardar(event, ${c ? c.id : 'null'})">
        <div class="form-group">
          <label>Nombre</label>
          <input type="text" id="cliNombre" value="${c ? esc(c.nombre) : ''}" required>
        </div>
        <div class="grid grid-2">
          <div class="form-group">
            <label>Tel\u00e9fono</label>
            <input type="text" id="cliTelefono" value="${c ? esc(c.telefono || '') : ''}">
          </div>
          <div class="form-group">
            <label>Email</label>
            <input type="email" id="cliEmail" value="${c ? esc(c.email || '') : ''}">
          </div>
        </div>
        <div class="form-group">
          <label>Direcci\u00f3n</label>
          <input type="text" id="cliDireccion" value="${c ? esc(c.direccion || '') : ''}">
        </div>
        ${
          c ? `
          <div class="form-group">
            <label>Puntos</label>
            <input type="number" id="cliPuntos" min="0" value="${c.puntos || 0}">
          </div>
          ` : ''
        }
        <div class="form-group">
          <label>Notas</label>
          <textarea id="cliNotas">${c ? esc(c.notas || '') : ''}</textarea>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-danger" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-success">Guardar</button>
        </div>
      </form>
    `, { title: c ? `Editar ${c.nombre}` : 'Nuevo cliente' });
  },

  async guardar(e, id) {
    e.preventDefault();
    const data = {
      nombre: document.getElementById('cliNombre').value,
      telefono: document.getElementById('cliTelefono').value,
      email: document.getElementById('cliEmail').value,
      direccion: document.getElementById('cliDireccion').value,
      notas: document.getElementById('cliNotas').value
    };
    if (id) data.puntos = parseInt(document.getElementById('cliPuntos').value || 0);
    try {
      if (id) {
        await API.updateCliente(id, data);
        App.showToast('Cliente actualizado', 'success');
      } else {
        await API.createCliente(data);
        App.showToast('Cliente creado', 'success');
      }
      App.closeModal();
      this.render();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  async eliminar(id) {
    if (!confirm('\u00bfSeguro que deseas eliminar este cliente?')) return;
    try {
      await API.deleteCliente(id);
      App.showToast('Cliente eliminado', 'success');
      this.render();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  }
};
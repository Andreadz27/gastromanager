// =============================================
// GASTROMANAGER - Usuarios
// Gestión de cuentas de acceso (solo admin)
// =============================================

const Usuarios = {
  usuarios: [],

  async render() {
    const view = document.getElementById('view-usuarios');
    view.innerHTML = '<div class="text-center mt-20"><i class="fas fa-spinner fa-spin fa-3x"></i></div>';
    try {
      this.usuarios = await API.getUsuarios();
      this.paint(view);
    } catch (err) {
      view.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error: ${esc(err.message)}</p></div>`;
    }
  },

  paint(view) {
    const rows = this.usuarios.map(u => `
      <tr>
        <td class="font-bold">${esc(u.nombre)}</td>
        <td>${esc(u.email)}</td>
        <td>${u.rol === 'admin' ? '<span class="badge badge-red">Administrador</span>' : '<span class="badge badge-blue">Vendedor</span>'}</td>
        <td>${u.activo ? '<span class="badge badge-green">Activo</span>' : '<span class="badge badge-gray">Inactivo</span>'}</td>
        <td>
          <button class="btn btn-outline btn-sm" onclick="Usuarios.editar(${u.id})"><i class="fas fa-edit"></i></button>
          <button class="btn btn-danger btn-sm" onclick="Usuarios.eliminar(${u.id})"><i class="fas fa-trash"></i></button>
        </td>
      </tr>
    `).join('');

    view.innerHTML = `
      <div class="page-header">
        <div>
          <h2><i class="fas fa-user-cog"></i> Usuarios</h2>
          <p>Cuentas de acceso al sistema</p>
        </div>
        <div>
          <button class="btn btn-success" onclick="Usuarios.nuevo()"><i class="fas fa-plus"></i> Nuevo usuario</button>
          <button class="btn btn-outline" onclick="Usuarios.render()"><i class="fas fa-sync-alt"></i> Refrescar</button>
        </div>
      </div>

      <div class="card">
        ${
          this.usuarios.length > 0 ? `
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Estado</th><th>Acciones</th></tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
          ` : `<div class="empty-state"><i class="fas fa-users"></i><p>Sin usuarios</p></div>`
        }
      </div>
    `;
  },

  nuevo() {
    this.abrirForm(null);
  },

  editar(id) {
    const u = this.usuarios.find(x => x.id === id);
    if (u) this.abrirForm(u);
  },

  abrirForm(u) {
    App.showModal(`
      <form onsubmit="Usuarios.guardar(event, ${u ? u.id : 'null'})">
        <div class="form-group">
          <label>Nombre</label>
          <input type="text" id="usuNombre" value="${u ? esc(u.nombre) : ''}" required>
        </div>
        <div class="form-group">
          <label>Email</label>
          <input type="email" id="usuEmail" value="${u ? esc(u.email) : ''}" required>
        </div>
        <div class="form-group">
          <label>Contraseña ${u ? '(dejar vacío para no cambiar)' : 'provisoria'}</label>
          <input type="password" id="usuPassword" minlength="8" autocomplete="new-password" ${u ? '' : 'required'}>
          <small class="form-hint">Mínimo 8 caracteres. El usuario la tendrá que cambiar en su próximo ingreso.</small>
        </div>
        <div class="grid grid-2">
          <div class="form-group">
            <label>Rol</label>
            <select id="usuRol">
              <option value="vendedor" ${u && u.rol === 'vendedor' ? 'selected' : ''}>Vendedor</option>
              <option value="admin" ${u && u.rol === 'admin' ? 'selected' : ''}>Administrador</option>
            </select>
          </div>
          <div class="form-group">
            <label>Estado</label>
            <select id="usuActivo">
              <option value="1" ${!u || u.activo ? 'selected' : ''}>Activo</option>
              <option value="0" ${u && !u.activo ? 'selected' : ''}>Inactivo</option>
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-danger" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-success"><i class="fas fa-save"></i> Guardar</button>
        </div>
      </form>
    `, { title: u ? `Editar ${u.nombre}` : 'Nuevo usuario' });
  },

  async guardar(e, id) {
    e.preventDefault();
    const data = {
      nombre: document.getElementById('usuNombre').value,
      email: document.getElementById('usuEmail').value,
      rol: document.getElementById('usuRol').value,
      activo: parseInt(document.getElementById('usuActivo').value)
    };
    const password = document.getElementById('usuPassword').value;
    if (password) data.password = password;
    try {
      if (id) {
        await API.updateUsuario(id, data);
        App.showToast('Usuario actualizado', 'success');
      } else {
        await API.createUsuario(data);
        App.showToast('Usuario creado', 'success');
      }
      App.closeModal();
      this.render();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  async eliminar(id) {
    if (!confirm('¿Seguro que deseas desactivar este usuario?')) return;
    try {
      await API.deleteUsuario(id);
      App.showToast('Usuario desactivado', 'success');
      this.render();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  }
};
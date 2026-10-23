// =============================================
// MORFI - Mesas
// Gestor visual de mesas del sal\u00f3n
// =============================================

const Mesas = {
  mesas: [],
  solicitudes: [], // pedidos y llamados desde el QR de las mesas, sin resolver

  async render() {
    const view = document.getElementById('view-mesas');
    // Sin el spinner si ya hay algo: se refresca solo cada vez que piden desde una mesa
    if (!view.innerHTML.trim()) view.innerHTML = '<div class="text-center mt-20"><i class="fas fa-spinner fa-spin fa-3x"></i></div>';
    try {
      [this.mesas, this.solicitudes] = await Promise.all([
        API.getMesas(),
        App.puede('pedidos.tomar') ? API.getSolicitudesMesa().catch(() => []) : []
      ]);
      App.marcarSolicitudesMesa(this.solicitudes.length);
      this.paint(view);
    } catch (err) {
      view.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error: ${esc(err.message)}</p></div>`;
    }
  },

  paint(view) {
    const esAdmin = App.puede('catalogo'); // crear, editar y borrar mesas

    const cards = this.mesas.map(m => {
      const estadoClass = m.estado === 'libre' ? 'mesa-card libre'
        : (m.estado === 'ocupada' ? 'mesa-card ocupada' : 'mesa-card reservada');
      const icono = m.estado === 'libre' ? 'fa-chair'
        : (m.estado === 'ocupada' ? 'fa-users' : 'fa-clock');
      return `
        <div class="${estadoClass}${m.solicitudes_pendientes ? ' con-solicitud' : ''}">
          <div class="mesa-header">
            <h3>${esc(m.nombre)}${m.solicitudes_pendientes ? ` <span class="badge badge-orange" title="Pedidos o llamados desde el QR"><i class="fas fa-bell"></i> ${m.solicitudes_pendientes}</span>` : ''}</h3>
            <span class="mesa-capacity"><i class="fas fa-user-friends"></i> ${m.capacidad}</span>
          </div>
          <div class="mesa-body">
            <i class="fas ${icono}"></i>
            <span class="mesa-estado">${fmtEstado(m.estado)}</span>
            <span class="mesa-sector">${esc(m.sector)}</span>
          </div>
          <div class="mesa-actions">
            ${
              m.estado === 'ocupada' ? `
              <button class="btn btn-primary btn-sm" onclick="Pedidos.abrirPedidoDeMesa('${m.id}')">
                <i class="fas fa-receipt"></i> Ver pedido
              </button>
              ` : `
              <button class="btn btn-success btn-sm" onclick="Mesas.nuevaComanda(${m.id})">
                <i class="fas fa-plus"></i> Nueva comanda
              </button>
              `
            }
            ${
              m.estado === 'reservada' ? `
              <button class="btn btn-primary btn-sm" onclick="Mesas.ocuparMesaReservada(${m.id})">
                <i class="fas fa-user-check"></i> Ocupar
              </button>
              ` : ''
            }
            ${
              esAdmin ? `
              <button class="btn btn-outline btn-sm" onclick="Mesas.editar(${m.id})"><i class="fas fa-edit"></i></button>
              <button class="btn btn-danger btn-sm" onclick="Mesas.eliminar(${m.id})"><i class="fas fa-trash"></i></button>
              ` : ''
            }
          </div>
        </div>
      `;
    }).join('');

    view.innerHTML = `
      <div class="page-header">
        <div>
          <h2><i class="fas fa-table"></i> Mesas</h2>
          <p>Gesti\u00f3n de mesas del sal\u00f3n</p>
        </div>
        <div>
          ${
            esAdmin ? `
            <button class="btn btn-primary" onclick="Mesas.nueva()"><i class="fas fa-plus"></i> Nueva mesa</button>
            ` : ''
          }
          <button class="btn btn-outline" onclick="Mesas.reservasModal()"><i class="fas fa-calendar-check"></i> Reservas</button>
          <button class="btn btn-outline" onclick="Mesas.render()"><i class="fas fa-sync-alt"></i> Refrescar</button>
        </div>
      </div>
      ${this.htmlSolicitudes()}
      <div class="mesa-grid">${cards}</div>
    `;
  },

  // ===== Pedidos y llamados desde el QR de la mesa =====
  htmlSolicitudes() {
    if (!this.solicitudes.length) return '';
    const TITULOS = { pedido: 'Pedido', mozo: 'Llama al mozo', cuenta: 'Pide la cuenta', pago: 'Pagó desde el celular' };
    const hora = f => parseFecha(f).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    const filas = this.solicitudes.map(s => {
      const total = s.items.reduce((t, i) => t + i.precio * i.cantidad, 0);
      const detalle = s.tipo === 'pedido' ? `
        <ul class="solicitud-items">${s.items.map(i => `<li>${i.cantidad} x ${esc(i.nombre)}${i.notas ? ` <em>(${esc(i.notas)})</em>` : ''}</li>`).join('')}</ul>
        ${s.notas ? `<div class="text-muted"><i class="fas fa-comment"></i> ${esc(s.notas)}</div>` : ''}
        <div class="font-bold">${fmtMoneda(total)}</div>`
        // Cuenta: con qué paga (efectivo, tarjeta). Pago: monto, propina y si queda saldo
        : s.notas ? `<div class="${s.tipo === 'pago' ? 'text-success font-bold' : ''}"><i class="fas fa-${s.tipo === 'pago' ? 'check-circle' : 'info-circle'}"></i> ${esc(s.notas)}</div>` : '';
      const acciones = s.tipo === 'pedido' ? `
        <button class="btn btn-success btn-sm" onclick="Mesas.confirmarSolicitud(${s.id})"><i class="fas fa-check"></i> Confirmar</button>
        <button class="btn btn-outline btn-sm" onclick="Mesas.corregirSolicitud(${s.id})"><i class="fas fa-edit"></i> Corregir</button>
        <button class="btn btn-danger btn-sm" onclick="Mesas.rechazarSolicitud(${s.id})"><i class="fas fa-times"></i> Rechazar</button>`
        : `<button class="btn btn-primary btn-sm" onclick="Mesas.atenderSolicitud(${s.id})"><i class="fas fa-check"></i> ${s.tipo === 'pago' ? 'Visto' : 'Ya fui'}</button>`;
      return `
        <div class="solicitud-mesa solicitud-${s.tipo}">
          <div class="solicitud-cabecera">
            <span><strong>${esc(s.mesa_nombre)}</strong> &middot; ${TITULOS[s.tipo] || esc(s.tipo)}${s.cliente ? ` &middot; ${esc(s.cliente)}` : ''}</span>
            <span class="text-muted">${hora(s.creado_en)}</span>
          </div>
          ${detalle}
          <div class="solicitud-acciones">${acciones}</div>
        </div>`;
    }).join('');
    return `
      <div class="card mb-20">
        <div class="card-header"><span class="card-title"><i class="fas fa-bell"></i> Desde las mesas (QR)</span>
          <span class="card-subtitle">Revis&aacute; el pedido y confirmalo para que vaya a cocina</span></div>
        <div class="solicitudes-mesa">${filas}</div>
      </div>`;
  },

  async confirmarSolicitud(id, items) {
    try {
      const r = await API.confirmarSolicitudMesa(id, items);
      App.closeModal();
      App.showToast(`Pedido confirmado: va a cocina (${r.numero_pedido})`, 'success');
    } catch (err) { App.showToast(err.message, 'error'); }
    this.render();
  },

  // Antes de confirmar, el mozo cambia cantidades o quita lo que no hay
  corregirSolicitud(id) {
    const s = this.solicitudes.find(x => x.id === id);
    if (!s) return;
    App.showModal(`
      <form onsubmit="Mesas.guardarCorreccion(event, ${id})">
        <p class="text-muted">Pon&eacute; 0 en lo que no se pueda servir.</p>
        ${s.items.map((i, n) => `
          <div class="form-group"><label for="corrCant${n}">${esc(i.nombre)}${i.notas ? ` <em>(${esc(i.notas)})</em>` : ''}</label>
            <input type="number" id="corrCant${n}" value="${i.cantidad}" min="0" max="20" required></div>`).join('')}
        <div class="modal-footer">
          <button type="button" class="btn btn-outline" onclick="App.closeModal()">Volver</button>
          <button type="submit" class="btn btn-success"><i class="fas fa-check"></i> Confirmar corregido</button>
        </div>
      </form>`, { title: `Corregir pedido de ${esc(s.mesa_nombre)}` });
  },

  guardarCorreccion(e, id) {
    e.preventDefault();
    const s = this.solicitudes.find(x => x.id === id);
    if (!s) return;
    const items = s.items.map((i, n) => ({ producto_id: i.producto_id, notas: i.notas, cantidad: parseInt(document.getElementById('corrCant' + n).value, 10) || 0 }))
      .filter(i => i.cantidad > 0);
    if (!items.length) return this.rechazarSolicitud(id);
    this.confirmarSolicitud(id, items);
  },

  async rechazarSolicitud(id) {
    const motivo = prompt('¿Por qué no se puede tomar? (lo ve el cliente)', 'Se terminó un producto, consultá al mozo');
    if (motivo === null) return;
    try {
      await API.rechazarSolicitudMesa(id, motivo);
      App.closeModal();
      App.showToast('Pedido rechazado', 'info');
    } catch (err) { App.showToast(err.message, 'error'); }
    this.render();
  },

  async atenderSolicitud(id) {
    try { await API.atenderSolicitudMesa(id); } catch (err) { App.showToast(err.message, 'error'); }
    this.render();
  },
nueva() {
    App.showModal(`
      <form onsubmit="Mesas.guardarNueva(event)">
        <div class="form-group">
          <label>Nombre</label>
          <input type="text" id="mesaNombre" placeholder="Ej: Mesa 1" required>
        </div>
        <div class="form-group">
          <label>Capacidad</label>
          <input type="number" id="mesaCapacidad" min="1" value="4" required>
        </div>
        <div class="form-group">
          <label>Sector</label>
          <input type="text" id="mesaSector" placeholder="Ej: Principal, Terraza" value="Principal">
        </div>
        <div class="form-group">
          <label>Orden</label>
          <input type="number" id="mesaOrden" value="0">
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-danger" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-success">Guardar</button>
        </div>
      </form>
    `, { title: 'Nueva mesa' });
  },

  async guardarNueva(e) {
    e.preventDefault();
    try {
      await API.createMesa({
        nombre: document.getElementById('mesaNombre').value,
        capacidad: parseInt(document.getElementById('mesaCapacidad').value),
        sector: document.getElementById('mesaSector').value,
        orden: parseInt(document.getElementById('mesaOrden').value)
      });
      App.closeModal();
      App.showToast('Mesa creada', 'success');
      this.render();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },
async editar(id) {
    const mesa = this.mesas.find(m => m.id === id);
    if (!mesa) return;
    App.showModal(`
      <form onsubmit="Mesas.guardarEdicion(event, ${id})">
        <div class="form-group">
          <label>Nombre</label>
          <input type="text" id="mesaNombre" value="${esc(mesa.nombre)}" required>
        </div>
        <div class="form-group">
          <label>Capacidad</label>
          <input type="number" id="mesaCapacidad" min="1" value="${mesa.capacidad}" required>
        </div>
        <div class="form-group">
          <label>Sector</label>
          <input type="text" id="mesaSector" value="${esc(mesa.sector)}">
        </div>
        <div class="form-group">
          <label>Orden</label>
          <input type="number" id="mesaOrden" value="${mesa.orden}">
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-danger" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-success">Guardar</button>
        </div>
      </form>
    `, { title: `Editar ${mesa.nombre}` });
  },

  async guardarEdicion(e, id) {
    e.preventDefault();
    try {
      await API.updateMesa(id, {
        nombre: document.getElementById('mesaNombre').value,
        capacidad: parseInt(document.getElementById('mesaCapacidad').value),
        sector: document.getElementById('mesaSector').value,
        orden: parseInt(document.getElementById('mesaOrden').value),
        estado: this.mesas.find(m => m.id === id).estado
      });
      App.closeModal();
      App.showToast('Mesa actualizada', 'success');
      this.render();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  async eliminar(id) {
    if (!confirm('\u00bfSeguro que deseas eliminar esta mesa?')) return;
    try {
      await API.deleteMesa(id);
      App.showToast('Mesa eliminada', 'success');
      this.render();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  nuevaComanda(mesaId) {
    POS.mesaPreseleccionada = mesaId;
    App.navigateTo('pos');
    App.showToast('Agreg\u00e1 productos y al confirmar seleccion\u00e1 la mesa', 'info');
    setTimeout(() => {
      const tipoSelect = document.getElementById('checkoutTipo');
      if (tipoSelect) tipoSelect.value = 'salon';
    }, 300);
  },

  // ===== Reservas =====

  // La mesa pasa a ocupada al confirmar el pedido: si se marcaba antes y el pedido no se hacía,
  // la mesa quedaba "ocupada" sin pedido y sin forma de liberarla
  ocuparMesaReservada(mesaId) {
    POS.mesaPreseleccionada = mesaId;
    App.navigateTo('pos');
    App.showToast('Cargá el pedido: la mesa queda ocupada al confirmarlo', 'info');
  },

  async reservasModal() {
    const hoy = hoyLocal();
    try {
      const [reservas, mesas] = await Promise.all([API.getReservas(hoy), API.getMesas()]);
      const filas = reservas.map(r => `
        <tr>
          <td class="font-bold">${esc(r.cliente)}</td>
          <td>${esc(r.mesa_nombre || '-')}</td>
          <td>${esc(r.fecha)} ${esc(r.hora)}</td>
          <td>${r.personas}</td>
          <td>${fmtEstado(r.estado)}</td>
          <td>
            <button class="btn btn-success btn-sm" onclick="Mesas.registrarLlegada(${r.id})" title="Marcar llegada"><i class="fas fa-user-check"></i></button>
            <button class="btn btn-danger btn-sm" onclick="Mesas.cancelarReserva(${r.id})" title="Cancelar"><i class="fas fa-ban"></i></button>
            <button class="btn btn-warning btn-sm" onclick="Mesas.eliminarReserva(${r.id})" title="Eliminar"><i class="fas fa-trash"></i></button>
          </td>
        </tr>
      `).join('');

      const mesaOpts = mesas.filter(m => m.estado === 'libre' || m.estado === 'reservada')
        .map(m => `<option value="${m.id}">${esc(m.nombre)}</option>`).join('');

      App.showModal(`
        <div class="form-group">
          <h4><i class="fas fa-calendar-check"></i> Reservas de hoy</h4>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Cliente</th><th>Mesa</th><th>Fecha/Hora</th><th>Personas</th><th>Estado</th><th>Acciones</th></tr></thead>
              <tbody>${filas || '<tr><td colspan="6"><div class="empty-state"><i class="fas fa-calendar"></i><p>Sin reservas para hoy</p></div></td></tr>'}</tbody>
            </table>
          </div>
        </div>
        <div class="form-group" style="border-top:1px solid #eee;padding-top:15px">
          <h4><i class="fas fa-plus"></i> Nueva reserva</h4>
          <form onsubmit="Mesas.guardarReserva(event)">
            <div class="grid grid-2">
              <div class="form-group"><label>Cliente *</label><input type="text" id="resCliente" required></div>
              <div class="form-group"><label>Teléfono</label><input type="text" id="resTelefono"></div>
            </div>
            <div class="grid grid-3">
              <div class="form-group"><label>Fecha</label><input type="date" id="resFecha" value="${hoy}" required></div>
              <div class="form-group"><label>Hora</label><input type="time" id="resHora" value="20:00" required></div>
              <div class="form-group"><label>Personas</label><input type="number" id="resPersonas" min="1" value="2"></div>
            </div>
            <div class="form-group"><label>Mesa</label><select id="resMesa"><option value="">Sin mesa asignada</option>${mesaOpts}</select></div>
            <div class="form-group"><label>Notas</label><textarea id="resNotas" placeholder="Notas de la reserva"></textarea></div>
            <div class="modal-footer">
              <button type="button" class="btn btn-danger" onclick="App.closeModal()">Cerrar</button>
              <button type="submit" class="btn btn-success"><i class="fas fa-plus"></i> Crear reserva</button>
            </div>
          </form>
        </div>
      `, { title: 'Reservas de mesas', large: true });
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  async guardarReserva(e) {
    e.preventDefault();
    try {
      await API.createReserva({
        cliente: document.getElementById('resCliente').value,
        telefono: document.getElementById('resTelefono').value,
        fecha: document.getElementById('resFecha').value,
        hora: document.getElementById('resHora').value,
        personas: parseInt(document.getElementById('resPersonas').value || 2),
        mesa_id: document.getElementById('resMesa').value || null,
        notas: document.getElementById('resNotas').value
      });
      App.closeModal();
      App.showToast('Reserva creada', 'success');
      this.render();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  async registrarLlegada(id) {
    try {
      await API.updateReserva(id, { estado: 'llego' });
      App.showToast('Llegada registrada. La mesa quedó ocupada', 'success');
      App.closeModal();
      this.render();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  async cancelarReserva(id) {
    try {
      await API.updateReserva(id, { estado: 'cancelada' });
      App.showToast('Reserva cancelada. Mesa liberada', 'success');
      App.closeModal();
      this.render();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  async eliminarReserva(id) {
    if (!confirm('¿Eliminar esta reserva?')) return;
    try {
      await API.deleteReserva(id);
      App.showToast('Reserva eliminada', 'success');
      App.closeModal();
      this.render();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  }
};
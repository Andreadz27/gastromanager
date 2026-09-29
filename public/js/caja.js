// =============================================
// GASTROMANAGER - Caja
// Apertura, cierre y arqueo de caja
// =============================================

const Caja = {
  estado: null,
  historial: [],

  async render() {
    const view = document.getElementById('view-caja');
    view.innerHTML = '<div class="text-center mt-20"><i class="fas fa-spinner fa-spin fa-3x"></i></div>';
    try {
      const [estado, historial] = await Promise.all([
        API.getCajaEstado(),
        API.getHistorialCaja().catch(() => [])
      ]);
      this.estado = estado;
      this.historial = historial;
      this.paint(view);
    } catch (err) {
      view.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error: ${esc(err.message)}</p></div>`;
    }
  },

  esAdmin() {
    return App.usuario && App.usuario.rol === 'admin';
  },

  paint(view) {
    const esAdmin = this.esAdmin();
    const caja = this.estado;

    const cajaCard = caja ? `
      <div class="card caja-abierta">
        <div class="card-header">
          <span class="card-title"><i class="fas fa-door-open"></i> Caja abierta</span>
          <span class="badge badge-green">Abierta</span>
        </div>
        <div class="grid grid-4">
          <div class="stat-card">
            <div class="stat-icon green"><i class="fas fa-dollar-sign"></i></div>
            <div class="stat-info">
              <h3>${fmtMoneda(caja.monto_inicial)}</h3>
              <span>Monto inicial</span>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon blue"><i class="fas fa-user"></i></div>
            <div class="stat-info">
              <h3>${esc(caja.usuario_nombre || '-')}</h3>
              <span>Abierta por</span>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon orange"><i class="fas fa-clock"></i></div>
            <div class="stat-info">
              <h3 class="small-h3">${fmtFechaHora(caja.fecha_apertura)}</h3>
              <span>Fecha de apertura</span>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon purple"><i class="fas fa-sticky-note"></i></div>
            <div class="stat-info">
              <h3 class="small-h3">${esc(caja.observaciones || '-')}</h3>
              <span>Observaciones</span>
            </div>
          </div>
        </div>
        <div class="text-right mt-10">
          <button class="btn btn-danger" onclick="Caja.mostrarCierre()">
            <i class="fas fa-door-closed"></i> Cerrar caja
          </button>
        </div>
      </div>
    ` : `
      <div class="card">
        <div class="empty-state">
          <i class="fas fa-money-bill-wave"></i>
          <p>No hay caja abierta</p>
        </div>
        <div class="text-center mb-20">
          <button class="btn btn-success" onclick="Caja.mostrarApertura()">
            <i class="fas fa-door-open"></i> Abrir caja
          </button>
        </div>
      </div>
    `;

    const histRows = this.historial.map(h => `
      <tr>
        <td>${fmtFechaHora(h.fecha_apertura)}</td>
        <td>${h.fecha_cierre ? fmtFechaHora(h.fecha_cierre) : '<span class="badge badge-green">Abierta</span>'}</td>
        <td>${esc(h.usuario_nombre || '-')}</td>
        <td>${fmtMoneda(h.monto_inicial)}</td>
        <td class="font-bold">${fmtMoneda(h.ventas)}</td>
        <td>${h.monto_final_real !== null && h.monto_final_real !== undefined ? fmtMoneda(h.monto_final_real) : '-'}</td>
      </tr>
    `).join('');

    view.innerHTML = `
      <div class="page-header">
        <div>
          <h2><i class="fas fa-money-bill-wave"></i> Caja</h2>
          <p>Control de aperturas y cierres de caja</p>
        </div>
      </div>

      ${cajaCard}

      ${
        esAdmin ? `
        <div class="card mt-20">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-history"></i> Historial de cajas</span>
          </div>
          ${
            this.historial.length > 0 ? `
            <div class="table-wrap">
              <table>
                <thead>
                  <tr><th>Apertura</th><th>Cierre</th><th>Responsable</th><th>Inicial</th><th>Ventas</th><th>Final real</th></tr>
                </thead>
                <tbody>${histRows}</tbody>
              </table>
            </div>
            ` : `<div class="empty-state"><i class="fas fa-history"></i><p>Sin historial</p></div>`
          }
        </div>
        ` : ''
      }
    `;
  },
mostrarApertura() {
    App.showModal(`
      <form onsubmit="Caja.abrir(event)">
        <div class="form-group">
          <label>Monto inicial ($)</label>
          <input type="number" id="cajaInicial" min="0" step="0.01" value="0" required>
        </div>
        <div class="form-group">
          <label>Observaciones</label>
          <textarea id="cajaObservaciones" placeholder="Notas de apertura"></textarea>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-danger" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-success"><i class="fas fa-door-open"></i> Abrir caja</button>
        </div>
      </form>
    `, { title: 'Abrir caja' });
  },

  async abrir(e) {
    e.preventDefault();
    try {
      await API.abrirCaja({
        monto_inicial: parseFloat(document.getElementById('cajaInicial').value || 0),
        observaciones: document.getElementById('cajaObservaciones').value
      });
      App.closeModal();
      App.showToast('Caja abierta', 'success');
      this.render();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  mostrarCierre() {
    App.showModal(`
      <form onsubmit="Caja.cerrar(event)">
        <div class="form-group">
          <label>Monto final real ($)</label>
          <input type="number" id="cajaFinal" min="0" step="0.01" value="0" required>
        </div>
        <div class="form-group">
          <label>Observaciones</label>
          <textarea id="cajaObservacionesCierre" placeholder="Notas de cierre"></textarea>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-danger" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-danger"><i class="fas fa-door-closed"></i> Cerrar caja</button>
        </div>
      </form>
    `, { title: 'Cerrar caja' });
  },

  async cerrar(e) {
    e.preventDefault();
    try {
      const res = await API.cerrarCaja({
        monto_final_real: parseFloat(document.getElementById('cajaFinal').value || 0),
        observaciones: document.getElementById('cajaObservacionesCierre').value
      });
      App.closeModal();
      App.showToast(res.message || 'Caja cerrada', 'success');
      this.render();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  }
};
// =============================================
// GASTROMANAGER - Caja
// Apertura, cierre y arqueo de caja
// =============================================

const Caja = {
  estado: null,
  historial: [],

  METODOS: { efectivo: 'Efectivo', tarjeta: 'Tarjeta', mercadopago: 'Mercado Pago', transferencia: 'Transferencia', otro: 'Otro' },

  async render() {
    const view = document.getElementById('view-caja');
    view.innerHTML = '<div class="text-center mt-20"><i class="fas fa-spinner fa-spin fa-3x"></i></div>';
    try {
      const [estado, historial] = await Promise.all([
        API.getCajaEstado(),
        this.esAdmin() ? API.getHistorialCaja().catch(() => []) : Promise.resolve([])
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

  nombreMetodo(m) {
    return this.METODOS[m] || m;
  },

  // Diferencia de arqueo: positiva = sobrante, negativa = faltante
  fmtDiferencia(d) {
    if (d === null || d === undefined) return '-';
    if (Math.abs(d) < 0.01) return '<span class="badge badge-green">Sin diferencia</span>';
    return d > 0
      ? `<span class="badge badge-blue">Sobrante ${fmtMoneda(d)}</span>`
      : `<span class="badge badge-red">Faltante ${fmtMoneda(-d)}</span>`;
  },

  // Tabla del arqueo (ventas por medio de pago, movimientos y efectivo esperado)
  htmlResumen(r) {
    const metodos = r.por_metodo.length
      ? r.por_metodo.map(m => `<tr><td>${esc(this.nombreMetodo(m.metodo))}</td><td>${m.cantidad}</td><td class="text-right font-bold">${fmtMoneda(m.total)}</td></tr>`).join('')
      : '<tr><td colspan="3" class="text-muted">Todavía no hay cobros en este turno</td></tr>';
    const movs = r.movimientos.length
      ? `<table class="mt-10">
          <thead><tr><th>Hora</th><th>Tipo</th><th>Concepto</th><th class="text-right">Monto</th></tr></thead>
          <tbody>${r.movimientos.map(m => `<tr>
            <td>${fmtFechaHora(m.fecha)}</td>
            <td>${m.tipo === 'ingreso' ? '<span class="badge badge-green">Ingreso</span>' : '<span class="badge badge-red">Egreso</span>'}</td>
            <td>${esc(m.concepto)}</td>
            <td class="text-right">${m.tipo === 'egreso' ? '-' : ''}${fmtMoneda(m.monto)}</td>
          </tr>`).join('')}</tbody>
        </table>`
      : '';
    return `
      <div class="grid grid-2 mt-10">
        <div>
          <h4><i class="fas fa-credit-card"></i> Ventas por medio de pago</h4>
          <table>
            <thead><tr><th>Medio</th><th>Cobros</th><th class="text-right">Total</th></tr></thead>
            <tbody>${metodos}</tbody>
            <tfoot><tr><td class="font-bold">Total</td><td>${r.cobros}</td><td class="text-right font-bold">${fmtMoneda(r.total_ventas)}</td></tr></tfoot>
          </table>
        </div>
        <div>
          <h4><i class="fas fa-money-bill-wave"></i> Efectivo en caja</h4>
          <table>
            <tbody>
              <tr><td>Monto inicial</td><td class="text-right">${fmtMoneda(r.monto_inicial)}</td></tr>
              <tr><td>+ Ventas en efectivo</td><td class="text-right">${fmtMoneda(r.ventas_efectivo)}</td></tr>
              <tr><td>+ Ingresos</td><td class="text-right">${fmtMoneda(r.ingresos)}</td></tr>
              <tr><td>− Egresos</td><td class="text-right">${fmtMoneda(r.egresos)}</td></tr>
            </tbody>
            <tfoot><tr><td class="font-bold">Efectivo esperado</td><td class="text-right font-bold text-success">${fmtMoneda(r.efectivo_esperado)}</td></tr></tfoot>
          </table>
        </div>
      </div>
      ${movs}`;
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
              <h3>${fmtMoneda(caja.resumen.total_ventas)}</h3>
              <span>Ventas del turno</span>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon blue"><i class="fas fa-cash-register"></i></div>
            <div class="stat-info">
              <h3>${fmtMoneda(caja.resumen.efectivo_esperado)}</h3>
              <span>Efectivo esperado</span>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon orange"><i class="fas fa-clock"></i></div>
            <div class="stat-info">
              <h3 class="small-h3">${fmtFechaHora(caja.fecha_apertura)}</h3>
              <span>Apertura</span>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon purple"><i class="fas fa-user"></i></div>
            <div class="stat-info">
              <h3 class="small-h3">${esc(caja.usuario_nombre || '-')}</h3>
              <span>Abierta por</span>
            </div>
          </div>
        </div>
        ${caja.observaciones ? `<p class="text-muted mt-10"><i class="fas fa-sticky-note"></i> ${esc(caja.observaciones)}</p>` : ''}
        ${this.htmlResumen(caja.resumen)}
        <div class="text-right mt-10">
          <button class="btn btn-outline" onclick="Caja.mostrarMovimiento('ingreso')"><i class="fas fa-plus-circle"></i> Ingreso</button>
          <button class="btn btn-outline" onclick="Caja.mostrarMovimiento('egreso')"><i class="fas fa-minus-circle"></i> Egreso / retiro</button>
          <button class="btn btn-danger" onclick="Caja.mostrarCierre()"><i class="fas fa-door-closed"></i> Cerrar caja</button>
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
      <tr class="clickable" onclick="Caja.verArqueo(${Number(h.id)})">
        <td>${fmtFechaHora(h.fecha_apertura)}</td>
        <td>${h.fecha_cierre ? fmtFechaHora(h.fecha_cierre) : '<span class="badge badge-green">Abierta</span>'}</td>
        <td>${esc(h.usuario_nombre || '-')}</td>
        <td class="font-bold">${fmtMoneda(h.ventas)}</td>
        <td>${h.monto_esperado !== null && h.monto_esperado !== undefined ? fmtMoneda(h.monto_esperado) : '-'}</td>
        <td>${h.fecha_cierre ? fmtMoneda(h.monto_final_real) : '-'}</td>
        <td>${h.fecha_cierre ? this.fmtDiferencia(h.diferencia) : '-'}</td>
      </tr>
    `).join('');

    view.innerHTML = `
      <div class="page-header">
        <div>
          <h2><i class="fas fa-money-bill-wave"></i> Caja</h2>
          <p>Apertura, movimientos, cierre y arqueo de caja</p>
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
                  <tr><th>Apertura</th><th>Cierre</th><th>Responsable</th><th>Ventas</th><th>Efectivo esperado</th><th>Contado</th><th>Diferencia</th></tr>
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
          <label>Monto inicial en efectivo ($)</label>
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

  mostrarMovimiento(tipo) {
    const ingreso = tipo === 'ingreso';
    App.showModal(`
      <form onsubmit="Caja.guardarMovimiento(event, ${jsArg(tipo)})">
        <p class="text-muted">${ingreso
          ? 'Efectivo que entra a la caja sin ser una venta (por ejemplo, cambio).'
          : 'Efectivo que sale de la caja (retiro, pago a proveedor, gastos).'}</p>
        <div class="form-group">
          <label>Monto ($)</label>
          <input type="number" id="movMonto" min="0.01" step="0.01" required>
        </div>
        <div class="form-group">
          <label>Concepto</label>
          <input type="text" id="movConcepto" maxlength="120" placeholder="${ingreso ? 'Ej.: cambio del banco' : 'Ej.: pago a proveedor de bebidas'}" required>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-danger" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-success"><i class="fas fa-save"></i> Registrar</button>
        </div>
      </form>
    `, { title: ingreso ? 'Ingreso de efectivo' : 'Egreso de efectivo' });
  },

  async guardarMovimiento(e, tipo) {
    e.preventDefault();
    try {
      await API.registrarMovimientoCaja({
        tipo,
        monto: parseFloat(document.getElementById('movMonto').value),
        concepto: document.getElementById('movConcepto').value
      });
      App.closeModal();
      App.showToast('Movimiento registrado', 'success');
      this.render();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  mostrarCierre() {
    const esperado = this.estado ? this.estado.resumen.efectivo_esperado : 0;
    App.showModal(`
      <form onsubmit="Caja.cerrar(event)">
        <p>Efectivo esperado en caja: <strong>${fmtMoneda(esperado)}</strong></p>
        <div class="form-group">
          <label>Efectivo contado ($)</label>
          <input type="number" id="cajaFinal" min="0" step="0.01" required
                 oninput="Caja.actualizarDiferencia(${Number(esperado) || 0})" autofocus>
        </div>
        <p id="cajaDiferencia" class="mt-10"></p>
        <div class="form-group">
          <label>Observaciones</label>
          <textarea id="cajaObservacionesCierre" placeholder="Explicá cualquier diferencia"></textarea>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-danger"><i class="fas fa-door-closed"></i> Cerrar caja</button>
        </div>
      </form>
    `, { title: 'Cerrar caja — Arqueo' });
  },

  actualizarDiferencia(esperado) {
    const valor = document.getElementById('cajaFinal').value;
    const el = document.getElementById('cajaDiferencia');
    if (!el) return;
    el.innerHTML = valor === '' ? '' : 'Diferencia: ' + this.fmtDiferencia(Math.round((parseFloat(valor) - esperado) * 100) / 100);
  },

  async cerrar(e) {
    e.preventDefault();
    try {
      const res = await API.cerrarCaja({
        monto_final_real: parseFloat(document.getElementById('cajaFinal').value),
        observaciones: document.getElementById('cajaObservacionesCierre').value
      });
      App.closeModal();
      App.showToast(res.message || 'Caja cerrada', 'success');
      this.mostrarResultado(res);
      this.render();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  mostrarResultado(res) {
    App.showModal(`
      ${this.htmlResumen(res.resumen)}
      <div class="card sub-card mt-10">
        <p>Efectivo esperado: <strong>${fmtMoneda(res.efectivo_esperado)}</strong></p>
        <p>Efectivo contado: <strong>${fmtMoneda(res.efectivo_contado)}</strong></p>
        <p>Resultado: ${this.fmtDiferencia(res.diferencia)}</p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-primary" onclick="App.closeModal()">Aceptar</button>
      </div>
    `, { title: 'Arqueo de caja', large: true });
  },

  async verArqueo(id) {
    try {
      const c = await API.getArqueoCaja(id);
      App.showModal(`
        <p><strong>Apertura:</strong> ${fmtFechaHora(c.fecha_apertura)} &mdash; <strong>Cierre:</strong> ${c.fecha_cierre ? fmtFechaHora(c.fecha_cierre) : 'abierta'}</p>
        <p><strong>Responsable:</strong> ${esc(c.usuario_nombre || '-')}</p>
        ${this.htmlResumen(c.resumen)}
        ${c.fecha_cierre ? `
          <div class="card sub-card mt-10">
            <p>Efectivo esperado: <strong>${c.monto_esperado !== null ? fmtMoneda(c.monto_esperado) : '-'}</strong></p>
            <p>Efectivo contado: <strong>${fmtMoneda(c.monto_final_real)}</strong></p>
            <p>Resultado: ${this.fmtDiferencia(c.diferencia)}</p>
            ${c.observaciones_cierre ? `<p><strong>Observaciones:</strong> ${esc(c.observaciones_cierre)}</p>` : ''}
          </div>` : ''}
        <div class="modal-footer">
          <button class="btn btn-primary" onclick="App.closeModal()">Cerrar</button>
        </div>
      `, { title: `Arqueo de caja #${c.id}`, large: true });
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  }
};

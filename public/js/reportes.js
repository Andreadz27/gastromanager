// =============================================
// GASTROMANAGER - Reportes
// Ventas, rentabilidad y auditoría del sistema
// =============================================

const Reportes = {
  ventas: { pedidos: [], total: 0, cantidad: 0 },
  rentabilidad: [],
  auditoria: [],
  tab: 'ventas',
  desde: '',
  hasta: '',

  esAdmin() {
    return App.usuario && App.usuario.rol === 'admin';
  },

  async render() {
    const view = document.getElementById('view-reportes');
    view.innerHTML = '<div class="text-center mt-20"><i class="fas fa-spinner fa-spin fa-3x"></i></div>';
    try {
      if (this.tab === 'ventas') {
        this.ventas = await API.getReporteVentas(this.desde || null, this.hasta || null);
      } else if (this.tab === 'rentabilidad') {
        this.rentabilidad = await API.getRentabilidad();
      } else if (this.tab === 'auditoria') {
        this.auditoria = await API.getAuditoria();
      }
      this.paint(view);
    } catch (err) {
      view.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error: ${esc(err.message)}</p></div>`;
    }
  },

  setTab(tab) {
    this.tab = tab;
    this.render();
  },

  filtrar() {
    this.desde = document.getElementById('repDesde') ? document.getElementById('repDesde').value : '';
    this.hasta = document.getElementById('repHasta') ? document.getElementById('repHasta').value : '';
    this.render();
  },

  paint(view) {
    const esAdmin = this.esAdmin();

    const tabs = `
      <div class="filter-bar mb-20">
        <button class="btn ${this.tab === 'ventas' ? 'btn-primary' : 'btn-outline'}" onclick="Reportes.setTab('ventas')">
          <i class="fas fa-file-invoice-dollar"></i> Ventas
        </button>
        ${esAdmin ? `
        <button class="btn ${this.tab === 'rentabilidad' ? 'btn-primary' : 'btn-outline'}" onclick="Reportes.setTab('rentabilidad')">
          <i class="fas fa-chart-pie"></i> Rentabilidad
        </button>
        <button class="btn ${this.tab === 'auditoria' ? 'btn-primary' : 'btn-outline'}" onclick="Reportes.setTab('auditoria')">
          <i class="fas fa-clipboard-list"></i> Auditoría
        </button>
        ` : ''}
      </div>
    `;

    let content = '';

    if (this.tab === 'ventas') {
      const rows = this.ventas.pedidos.map(p => `
        <tr>
          <td class="font-bold">${esc(p.numero_pedido)}</td>
          <td>${fmtFechaHora(p.cerrado_en || p.creado_en)}</td>
          <td>${esc(p.mesa_nombre || '-')}</td>
          <td>${esc(p.cliente || '-')}</td>
          <td class="font-bold">${fmtMoneda(p.total)}</td>
        </tr>
      `).join('');

      content = `
        <div class="card mb-20">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-calendar-alt"></i> Rango de fechas</span>
          </div>
          <div class="grid grid-2">
            <div class="form-group">
              <label>Desde</label>
              <input type="date" id="repDesde" value="${this.desde}" onchange="Reportes.filtrar()">
            </div>
            <div class="form-group">
              <label>Hasta</label>
              <input type="date" id="repHasta" value="${this.hasta}" onchange="Reportes.filtrar()">
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-file-invoice-dollar"></i> Ventas del período</span>
            <span class="badge badge-blue">${this.ventas.cantidad} ventas · ${fmtMoneda(this.ventas.total)}</span>
          </div>
          ${
            this.ventas.pedidos.length > 0 ? `
            <div class="table-wrap">
              <table>
                <thead><tr><th>N°</th><th>Fecha</th><th>Mesa</th><th>Cliente</th><th>Total</th></tr></thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
            ` : `<div class="empty-state"><i class="fas fa-receipt"></i><p>Sin ventas en el período</p></div>`
          }
        </div>
      `;
    } else if (this.tab === 'rentabilidad') {
const rows = this.rentabilidad.map(r => `
        <tr>
          <td class="font-bold">${esc(r.nombre)}</td>
          <td>${fmtMoneda(r.precio_venta)}</td>
          <td>${fmtMoneda(r.costo)}</td>
          <td class="text-success font-bold">${fmtMoneda(r.ganancia)}</td>
          <td>${Number(r.vendidos || 0)}</td>
          <td>
            <span class="badge ${r.margen >= 50 ? 'badge-green' : (r.margen >= 30 ? 'badge-orange' : 'badge-red')}">
              ${Number(r.margen || 0).toFixed(1)}%
            </span>
          </td>
        </tr>
      `).join('');

      content = `
        <div class="card">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-chart-pie"></i> Rentabilidad por producto</span>
          </div>
          ${
            this.rentabilidad.length > 0 ? `
            <div class="table-wrap">
              <table>
                <thead><tr><th>Producto</th><th>Venta</th><th>Costo</th><th>Ganancia</th><th>Vendidos</th><th>Margen</th></tr></thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
            ` : `<div class="empty-state"><i class="fas fa-chart-pie"></i><p>Sin datos de rentabilidad</p></div>`
          }
        </div>
      `;
    } else if (this.tab === 'auditoria') {
      const rows = this.auditoria.map(a => `
        <tr>
          <td>${fmtFechaHora(a.fecha)}</td>
          <td class="font-bold">${esc(a.usuario_nombre || '-')}</td>
          <td><span class="badge badge-gray">${esc(a.accion)}</span></td>
          <td>${esc(a.detalle || '-')}</td>
        </tr>
      `).join('');

      content = `
        <div class="card">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-clipboard-list"></i> Registro de auditoría</span>
          </div>
          ${
            this.auditoria.length > 0 ? `
            <div class="table-wrap">
              <table>
                <thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Detalle</th></tr></thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
            ` : `<div class="empty-state"><i class="fas fa-clipboard-list"></i><p>Sin registros</p></div>`
          }
        </div>
      `;
    }

    view.innerHTML = `
      <div class="page-header">
        <div>
          <h2><i class="fas fa-file-alt"></i> Reportes</h2>
          <p>Ventas, rentabilidad y auditoría</p>
        </div>
        <div>
          ${
            this.tab === 'ventas' ? `
              <button class="btn btn-outline" onclick="Reportes.exportarCSV()"><i class="fas fa-file-csv"></i> CSV</button>
              <button class="btn btn-outline" onclick="Reportes.exportarExcel()"><i class="fas fa-file-excel"></i> Excel</button>
              <button class="btn btn-outline" onclick="Reportes.exportarPDF()"><i class="fas fa-file-pdf"></i> PDF</button>
            ` : ''
          }
          <button class="btn btn-outline" onclick="Reportes.render()"><i class="fas fa-sync-alt"></i> Refrescar</button>
        </div>
      </div>
      ${tabs}
      ${content}
    `;
  },

  // ===== Exportación =====

  _lineasVentas() {
    return this.ventas.pedidos.map(p => ({
      'Numero': p.numero_pedido,
      'Fecha': p.cerrado_en || p.creado_en,
      'Mesa': p.mesa_nombre || '',
      'Cliente': p.cliente || '',
      'Tipo': p.tipo || '',
      'Total': p.total
    }));
  },

  _descargarContenido(contenido, nombreArchivo, mime) {
    const blob = new Blob([contenido], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombreArchivo;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  _normalizarCSV(valor) {
    const s = (valor === null || valor === undefined) ? '' : String(valor);
    if (/[",;\n]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  },

  exportarCSV() {
    if (!this.ventas || this.ventas.pedidos.length === 0) {
      App.showToast('No hay datos para exportar', 'warning');
      return;
    }
    const filas = this._lineasVentas();
    const cabecera = Object.keys(filas[0]);
    const contenido = [cabecera.join(',')]
      .concat(filas.map(f => cabecera.map(c => this._normalizarCSV(f[c])).join(',')))
      .join('\n');
    const fecha = hoyLocal();
    this._descargarContenido(contenido, `reporte-ventas-${fecha}.csv`, 'text/csv;charset=utf-8;');
    App.showToast('Reporte CSV exportado', 'success');
  },

  exportarExcel() {
    if (!this.ventas || this.ventas.pedidos.length === 0) {
      App.showToast('No hay datos para exportar', 'warning');
      return;
    }
    // CSV con separador de punto y coma y BOM UTF-8 para abrir correctamente en Excel
    const filas = this._lineasVentas();
    const cabecera = Object.keys(filas[0]);
    const contenido = '\uFEFF' + [cabecera.join(';')]
      .concat(filas.map(f => cabecera.map(c => this._normalizarCSV(f[c])).join(';')))
      .join('\n');
    const fecha = hoyLocal();
    this._descargarContenido(contenido, `reporte-ventas-${fecha}.csv`, 'text/csv;charset=utf-8;');
    App.showToast('Reporte Excel exportado', 'success');
  },

  exportarPDF() {
    if (!this.ventas || this.ventas.pedidos.length === 0) {
      App.showToast('No hay datos para exportar', 'warning');
      return;
    }
    const filas = this.ventas.pedidos.map(p => `
      <tr>
        <td>${esc(p.numero_pedido)}</td>
        <td>${fmtFechaHora(p.cerrado_en || p.creado_en)}</td>
        <td>${esc(p.mesa_nombre || '-')}</td>
        <td>${esc(p.cliente || '-')}</td>
        <td style="text-align:right">${fmtMoneda(p.total)}</td>
      </tr>
    `).join('');
    const negocio = (App && App.nombreNegocio) ? App.nombreNegocio : 'GastroManager';
    const win = window.open('', '_blank', 'width=800,height=600');
    if (!win) { App.showToast('Habilita las ventanas emergentes', 'warning'); return; }
    win.document.write(`
      <!DOCTYPE html><html><head><meta charset="UTF-8"><title>Reporte de ventas</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 30px; color:#222; }
        h1 { margin: 0; font-size: 20px; }
        h2 { font-size: 14px; color:#555; font-weight: normal; margin-top: 4px; }
        .resumen { margin: 20px 0; padding: 12px; background:#f5f5f5; border-radius: 6px; }
        table { width:100%; border-collapse: collapse; margin-top: 15px; }
        th, td { border: 1px solid #ccc; padding: 8px; font-size: 12px; }
        th { background:#eee; text-align:left; }
      </style></head><body>
      <h1>${esc(negocio)} - Reporte de Ventas</h1>
      <h2>Período: ${fmtFecha(this.desde) || 'Inicio'} a ${fmtFecha(this.hasta) || 'Hoy'} · ${this.ventas.cantidad} ventas · Total ${fmtMoneda(this.ventas.total)}</h2>
      <div class="resumen"><strong>Total del período:</strong> ${fmtMoneda(this.ventas.total)}</div>
      <table>
        <thead><tr><th>N°</th><th>Fecha</th><th>Mesa</th><th>Cliente</th><th style="text-align:right">Total</th></tr></thead>
        <tbody>${filas}</tbody>
      </table>
      <script>window.onload = function(){ window.print(); };<\/script>
      </body></html>`);
    win.document.close();
    win.focus();
  }
};
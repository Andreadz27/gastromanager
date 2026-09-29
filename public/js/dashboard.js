// =============================================
// GASTROMANAGER - Dashboard
// Panel de inteligencia de negocio con insights
// =============================================

const Dashboard = {
  data: null,
  insights: null,
  _socketBound: false,

  async render() {
    const view = document.getElementById('view-dashboard');
    view.innerHTML = '<div class="text-center mt-20"><i class="fas fa-spinner fa-spin fa-3x"></i></div>';
    this._bindSocket();
    try {
      // Cargar en paralelo: métricas del dashboard + inteligencia de negocio
      const [data, insights] = await Promise.all([
        API.getDashboard().catch(e => null),
        API.getInsights().catch(e => null)
      ]);
      this.data = data;
      this.insights = insights;
      this.paint(view);
    } catch (err) {
      view.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error: ${esc(err.message)}</p></div>`;
    }
  },

  _bindSocket() {
    if (this._socketBound) return;
    if (!App || !App.socket) return;
    this._socketBound = true;
    App.socket.on('dashboard:actualizar', () => {
      if (App.currentView === 'dashboard') this.render();
    });
    App.socket.on('pedido:pagado', () => {
      if (App.currentView === 'dashboard') this.render();
    });
  },

  renderAlertas() {
    const ins = this.insights;
    if (!ins || !ins.alertas || ins.alertas.length === 0) {
      return `
        <div class="empty-state small">
          <i class="fas fa-check-circle"></i>
          <p>Sin alertas. Tu negocio anda sobre rieles.</p>
        </div>`;
    }
    return ins.alertas.map(a => {
      const tone = a.tipo === 'critico' ? 'alert-red' : (a.tipo === 'aviso' ? 'alert-orange' : 'alert-blue');
      return `
        <div class="insight-alert ${tone}">
          <div class="insight-alert-icon"><i class="fas fa-${esc(a.icono)}"></i></div>
          <div class="insight-alert-body">
            <div class="insight-alert-title">${esc(a.titulo)}</div>
            <div class="insight-alert-detail">${esc(a.detalle)}</div>
            <button class="btn btn-link btn-sm" onclick="App.navigateTo(${jsArg(a.enlace)})">
              ${esc(a.accion)} <i class="fas fa-arrow-right"></i>
            </button>
          </div>
        </div>`;
    }).join('');
  },

  renderRecomendaciones() {
    const ins = this.insights;
    if (!ins || !ins.recomendaciones || ins.recomendaciones.length === 0) return '';
    return ins.recomendaciones.map(r => `
      <div class="insight-reco">
        <div class="insight-reco-icon"><i class="fas fa-${esc(r.icono)}"></i></div>
        <div class="insight-reco-body">
          <div class="insight-reco-title">${esc(r.titulo)}</div>
          <div class="insight-reco-text">${esc(r.texto)}</div>
        </div>
      </div>
    `).join('');
  },

  paint(view) {
    const d = this.data;
    const ins = this.insights;

    const ventasHoy = d ? d.ventas_hoy : (ins && ins.metricas ? ins.metricas.ventas_hoy : 0);
    const pedidosHoy = d ? d.pedidos_hoy : (ins && ins.metricas ? ins.metricas.pedidos_hoy : 0);
    const ticketPromedio = d ? d.ticket_promedio : 0;

    const difPct = ins && ins.metricas ? ins.metricas.diferencia_pct : 0;
    const difClass = difPct >= 0 ? 'text-success' : 'text-danger';
    const difIcon = difPct >= 0 ? 'arrow-up' : 'arrow-down';

    let bars = '';
    if (d && d.ventas_7dias && d.ventas_7dias.length) {
      const maxVenta = Math.max(...d.ventas_7dias.map(v => v.total), 1);
      bars = d.ventas_7dias.map(v => {
        const pct = Math.max(5, (v.total / maxVenta) * 100);
        const fecha = new Date(v.fecha + 'T00:00:00');
        const label = fecha.toLocaleDateString('es-AR', { weekday: 'short' });
        return `
          <div class="simple-bar" style="height:${pct}%" title="${fmtMoneda(v.total)} (${v.pedidos} pedidos)">
            <span class="simple-bar-label">${label}</span>
          </div>
        `;
      }).join('');
    }

    const topProd = (d && d.top_productos && d.top_productos.length) ? `
      <div class="table-wrap"><table>
        <thead><tr><th>Producto</th><th>Cant</th><th>Total</th></tr></thead>
        <tbody>${d.top_productos.map(p => `
          <tr>
            <td>${esc(p.nombre_producto)}</td>
            <td>${p.cantidad}</td>
            <td class="font-bold">${fmtMoneda(p.total)}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>` : `<div class="empty-state"><i class="fas fa-shopping-basket"></i><p>Sin ventas hoy</p></div>`;

    const metodosPago = (d && d.metodos_pago && d.metodos_pago.length) ? `
      <div class="table-wrap"><table>
        <thead><tr><th>M\u00e9todo</th><th>Ventas</th><th>Total</th></tr></thead>
        <tbody>${d.metodos_pago.map(m => `
          <tr>
            <td>${esc(m.metodo)}</td>
            <td>${m.cantidad}</td>
            <td class="font-bold">${fmtMoneda(m.total)}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>` : `<div class="empty-state"><i class="fas fa-credit-card"></i><p>Sin pagos hoy</p></div>`;

    const stockBajo = (d && d.stock_bajo && d.stock_bajo.length) ? `
      <div class="table-wrap"><table>
        <thead><tr><th>Producto</th><th>Stock</th><th>M\u00ednimo</th></tr></thead>
        <tbody>${d.stock_bajo.map(p => `
          <tr>
            <td>${esc(p.nombre)}</td>
            <td class="text-danger font-bold">${p.stock_actual}</td>
            <td>${p.stock_minimo}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>` : `<div class="empty-state"><i class="fas fa-check-circle"></i><p>Stock en orden</p></div>`;

    const pedidosRecientes = (d && d.pedidos_recientes && d.pedidos_recientes.length) ? `
      <div class="table-wrap"><table>
        <thead><tr><th>N\u00b0 Pedido</th><th>Mesa</th><th>Estado</th><th>Total</th><th>Fecha</th></tr></thead>
        <tbody>${d.pedidos_recientes.map(p => `
          <tr onclick="App.navigateTo('pedidos')" style="cursor:pointer">
            <td>${esc(p.numero_pedido)}</td>
            <td>${esc(p.mesa || '-')}</td>
            <td>${fmtEstado(p.estado)}</td>
            <td class="font-bold">${fmtMoneda(p.total)}</td>
            <td>${fmtFechaHora(p.creado_en)}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>` : `<div class="empty-state"><i class="fas fa-receipt"></i><p>Sin pedidos recientes</p></div>`;

    view.innerHTML = `
      <div class="page-header">
        <div>
          <h2><i class="fas fa-chart-line"></i> Dashboard</h2>
          <p>Panel de inteligencia de negocio</p>
        </div>
        <button class="btn btn-success" onclick="App.navigateTo('pos')">
          <i class="fas fa-cash-register"></i> Nuevo Pedido
        </button>
      </div>

      <div class="grid grid-4 mb-20">
        <div class="stat-card">
          <div class="stat-icon blue"><i class="fas fa-dollar-sign"></i></div>
          <div class="stat-info">
            <h3>${fmtMoneda(ventasHoy)}</h3>
            <span>Ventas de hoy</span>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon green"><i class="fas fa-receipt"></i></div>
          <div class="stat-info">
            <h3>${pedidosHoy}</h3>
            <span>Pedidos hoy</span>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon orange"><i class="fas fa-chart-bar"></i></div>
          <div class="stat-info">
            <h3>${fmtMoneda(ticketPromedio)}</h3>
            <span>Ticket promedio</span>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon purple"><i class="fas fa-robot"></i></div>
          <div class="stat-info">
            <h3 class="${difClass}"><i class="fas fa-${difIcon}"></i> ${Math.abs(difPct).toFixed(0)}%</h3>
            <span>vs. promedio semanal</span>
          </div>
        </div>
      </div>

      <div class="grid grid-2 mb-20">
        <div class="card">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-bell"></i> Alertas inteligentes</span>
            <span class="badge badge-blue">IA</span>
          </div>
          <div class="card-body pad-0">${this.renderAlertas()}</div>
        </div>
        <div class="card">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-lightbulb"></i> Consejos del asistente</span>
            <span class="badge badge-green">IA</span>
          </div>
          <div class="card-body pad-0">${this.renderRecomendaciones()}</div>
        </div>
      </div>

      <div class="grid grid-2 mb-20">
        <div class="card">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-chart-area"></i> Ventas \u00faltimos 7 d\u00edas</span>
          </div>
          <div class="simple-bars">${bars || '<div class="empty-state"><i class="fas fa-chart-area"></i><p>Sin datos</p></div>'}</div>
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-trophy"></i> Top productos hoy</span>
          </div>
          ${topProd}
        </div>
      </div>

      <div class="grid grid-2 mb-20">
        <div class="card">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-credit-card"></i> M\u00e9todos de pago</span>
          </div>
          ${metodosPago}
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-exclamation-triangle"></i> Stock bajo / agotado</span>
          </div>
          ${stockBajo}
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title"><i class="fas fa-clock"></i> \u00daltimos pedidos</span>
        </div>
        ${pedidosRecientes}
      </div>
    `;
  }
};

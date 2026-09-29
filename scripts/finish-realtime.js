// finish-realtime.js — run with: node scripts/finish-realtime.js
const fs = require('fs');
const path = require('path');
const PUBLIC = path.join(__dirname, '..', 'public');

// ── 1. cocina.js ──────────────────────────────
fs.writeFileSync(path.join(PUBLIC, 'js', 'cocina.js'), `\
// GASTROMANAGER - Cocina - tiempo real via Socket.IO

const Cocina = {
  pedidos: [],
  _socketBound: false,

  async render() {
    const view = document.getElementById('view-cocina');
    view.innerHTML = '<div class="text-center mt-20"><i class="fas fa-spinner fa-spin fa-3x"></i></div>';
    if (typeof App !== 'undefined') App.clearBadge('navBadgeCocina');
    this._bindSocket();
    await this.refresh(view);
  },

  _bindSocket() {
    if (this._socketBound) return;
    if (!App || !App.socket) return;
    this._socketBound = true;
    App.socket.on('cocina:actualizar', () => {
      if (App.currentView === 'cocina') this.refresh();
    });
  },

  async refresh(view) {
    if (!view) view = document.getElementById('view-cocina');
    try {
      this.pedidos = await API.getCocina();
      this.paint(view);
    } catch (err) {
      view.innerHTML = \`<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error: \${esc(err.message)}</p></div>\`;
    }
  },

  fmtTipo(tipo) {
    const map = { salon: 'Sal\\u00f3n', mostrador: 'Mostrador', delivery: 'Delivery', takeaway: 'Take Away' };
    return map[tipo] || tipo;
  },

  tiempoClass(min) {
    if (min < 15) return 'time-ok';
    if (min < 30) return 'time-warn';
    return 'time-danger';
  },

  paint(view) {
    const cnt = this.pedidos.length;
    const header = \`
      <div class="page-header">
        <div>
          <h2><i class="fas fa-fire-burner"></i> Cocina</h2>
          <p>\${cnt} comanda\${cnt !== 1 ? 's' : ''} en curso</p>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <span class="realtime-tag"><i class="fas fa-bolt"></i> En tiempo real</span>
          <button class="btn btn-outline" onclick="Cocina.refresh()">
            <i class="fas fa-sync-alt"></i> Actualizar
          </button>
        </div>
      </div>\`;

    if (cnt === 0) {
      view.innerHTML = header + \`
        <div class="empty-state">
          <i class="fas fa-utensils"></i>
          <p>\\u00a1No hay comandas pendientes. Todo listo!</p>
        </div>\`;
      return;
    }

    const cards = this.pedidos.map(p => {
      const items = p.items.map(i => \`
        <div class="comanda-item">
          <span class="comanda-cant">\${i.cantidad} x</span>
          <span class="comanda-nombre">\${esc(i.nombre_producto)}</span>
        </div>
        \${i.notas ? \`<div class="comanda-nota"><i class="fas fa-sticky-note"></i> \${esc(i.notas)}</div>\` : ''}\`
      ).join('');
      return \`
        <div class="comanda-card">
          <div class="comanda-header">
            <div class="comanda-num"><i class="fas fa-receipt"></i> \${esc(p.numero_pedido)}</div>
            <span class="badge badge-blue">\${esc(this.fmtTipo(p.tipo))}</span>
            \${p.mesa_nombre ? \`<span class="badge badge-orange"><i class="fas fa-table"></i> \${esc(p.mesa_nombre)}</span>\` : ''}
          </div>
          <div class="comanda-time \${this.tiempoClass(p.minutos_transcurridos || 0)}">
            <i class="fas fa-clock"></i> \${p.minutos_transcurridos || 0} min
          </div>
          <div class="comanda-items">\${items}</div>
          \${p.notas ? \`<div class="comanda-notas-generales"><i class="fas fa-clipboard"></i> \${esc(p.notas)}</div>\` : ''}
        </div>\`;
    }).join('');

    view.innerHTML = header + \`<div class="cocina-grid">\${cards}</div>\`;
  }
};
`, 'utf8');
console.log('OK cocina.js');

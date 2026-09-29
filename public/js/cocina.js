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
      view.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error: ${esc(err.message)}</p></div>`;
    }
  },

  fmtTipo(tipo) {
    const map = { salon: 'Sal\u00f3n', mostrador: 'Mostrador', delivery: 'Delivery', takeaway: 'Take Away' };
    return map[tipo] || tipo;
  },

  tiempoClass(min) {
    if (min < 15) return 'time-ok';
    if (min < 30) return 'time-warn';
    return 'time-danger';
  },

  cardClass(min) {
    if (min < 15) return '';
    if (min < 30) return 'comanda-card--warn';
    return 'comanda-card--urg';
  },

  // Marca una comanda como lista (estado: listo)
  async marcarListo(id, numero) {
    const btn = document.querySelector(`[data-comanda-id="${id}"]`);
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Marcando...';
    }
    try {
      const r = await fetch(`/api/cocina/${id}/listo`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + API.getToken()
        }
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || 'HTTP ' + r.status);
      }
      App.showToast(
        `<i class="fas fa-check-circle"></i> Comanda <strong>${esc(numero)}</strong> lista`,
        'success'
      );
      // Animación de salida antes de refrescar
      const card = document.getElementById(`comanda-${id}`);
      if (card) {
        card.style.transition = 'opacity 0.35s, transform 0.35s';
        card.style.opacity = '0';
        card.style.transform = 'scale(0.9)';
        setTimeout(() => this.refresh(), 380);
      } else {
        await this.refresh();
      }
    } catch (err) {
      App.showToast(`Error: ${err.message}`, 'error');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-check-circle"></i> LISTO';
      }
    }
  },

  paint(view) {
    const cnt = this.pedidos.length;
    const header = `
      <div class="page-header">
        <div>
          <h2><i class="fas fa-fire-burner"></i> Cocina</h2>
          <p>${cnt} comanda${cnt !== 1 ? 's' : ''} en curso</p>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <span class="realtime-tag"><i class="fas fa-bolt"></i> En tiempo real</span>
          <button class="btn btn-outline" onclick="window.open('cocina-display.html','_blank')" title="Abrir pantalla de cocina en nueva pestaña">
            <i class="fas fa-tablet-alt"></i> Display cocina
          </button>
          <button class="btn btn-outline" onclick="Cocina.refresh()">
            <i class="fas fa-sync-alt"></i> Actualizar
          </button>
        </div>
      </div>`;

    if (cnt === 0) {
      view.innerHTML = header + `
        <div class="empty-state">
          <i class="fas fa-check-circle" style="color:var(--success);font-size:48px;"></i>
          <p style="font-size:18px;margin-top:12px;">\u00a1No hay comandas pendientes!</p>
          <p style="color:var(--text-light);">Todo al d\u00eda en cocina.</p>
        </div>`;
      return;
    }

    const cards = this.pedidos.map(p => {
      const min = p.minutos_transcurridos || 0;
      const items = p.items.map(i => `
        <div class="comanda-item">
          <span class="comanda-cant">${i.cantidad}\u00d7</span>
          <span class="comanda-nombre">${esc(i.nombre_producto)}</span>
        </div>
        ${i.notas ? `<div class="comanda-nota"><i class="fas fa-sticky-note"></i> ${esc(i.notas)}</div>` : ''}`
      ).join('');

      return `
        <div class="comanda-card ${this.cardClass(min)}" id="comanda-${p.id}">
          <div class="comanda-header">
            <div class="comanda-num"><i class="fas fa-receipt"></i> ${esc(p.numero_pedido)}</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
              <span class="badge badge-blue">${esc(this.fmtTipo(p.tipo))}</span>
              ${p.mesa_nombre ? `<span class="badge badge-orange"><i class="fas fa-table"></i> ${esc(p.mesa_nombre)}</span>` : ''}
            </div>
          </div>
          <div class="comanda-time ${this.tiempoClass(min)}">
            <i class="fas fa-clock"></i>
            <span style="font-size:26px;font-weight:800;line-height:1;margin:0 4px;">${min}</span>
            <span style="font-size:13px;color:inherit;">min</span>
          </div>
          <div class="comanda-items">${items}</div>
          ${p.notas ? `<div class="comanda-notas-generales"><i class="fas fa-clipboard"></i> ${esc(p.notas)}</div>` : ''}
          <div class="comanda-footer">
            <button class="btn-comanda-listo" data-comanda-id="${p.id}"
              onclick="Cocina.marcarListo(${p.id}, ${jsArg(p.numero_pedido)})">
              <i class="fas fa-check-circle"></i> LISTO
            </button>
          </div>
        </div>`;
    }).join('');

    view.innerHTML = header + `<div class="cocina-grid">${cards}</div>`;
  }
};

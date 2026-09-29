// =============================================
// GASTROMANAGER - Delivery
// Gestión de pedidos de delivery y plataformas
// de entrega (PedidosYa, Rappi, Uber Eats, etc.)
// =============================================

const Delivery = {
  pedidos: [],
  plataformas: [],
  filtro: 'todos',
  _socketBound: false,

  async render() {
    const view = document.getElementById('view-delivery');
    view.innerHTML = '<div class="text-center mt-20"><i class="fas fa-spinner fa-spin fa-3x"></i></div>';
    App.clearBadge('navBadgeDelivery');
    this._bindSocket();
    try {
      const [pedidos, plataformas, resumen] = await Promise.all([
        API.getPedidosDelivery(this.filtro, null), // todas las fechas (el filtro por día nunca se aplicaba)
        API.getPlataformasDelivery(),
        API.getResumenDelivery()
      ]);
      this.pedidos = pedidos || [];
      this.plataformas = plataformas || [];
      this.resumen = resumen || { por_plataforma: [], activos: { cantidad: 0, total: 0 } };
      this.paint(view);
    } catch (err) {
      view.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error: ${esc(err.message)}</p></div>`;
    }
  },

  _bindSocket() {
    if (this._socketBound) return;
    if (!App || !App.socket) return;
    this._socketBound = true;
    App.socket.on('delivery:actualizar', () => {
      if (App.currentView === 'delivery') this.render();
    });
  },

  setFiltro(filtro) {
    this.filtro = filtro;
    this.render();
  },
  fmtEstado(estado) {
    const map = {
      'pendiente': '<span class="badge badge-orange">Pendiente</span>',
      'aceptado': '<span class="badge badge-blue">Aceptado</span>',
      'en_camino': '<span class="badge badge-purple">En camino</span>',
      'entregado': '<span class="badge badge-green">Entregado</span>',
      'cancelado': '<span class="badge badge-red">Cancelado</span>'
    };
    return map[estado] || `<span class="badge badge-gray">${esc(estado)}</span>`;
  },

  colorPlataforma(p) {
    return (p && p.plataforma_color) || '#6A0DAD';
  },

  iconoPlataforma(p) {
    return (p && p.plataforma_icono) || 'motorcycle';
  },

  _cardResumen() {
    const porP = this.resumen.por_plataforma || [];
    const cards = porP.map(x => `
      <div class="delivery-stat" style="--plataforma-color:${esc(x.color || '#6A0DAD')}">
        <div class="delivery-stat-icon"><i class="fas fa-${esc(x.icono || 'motorcycle')}"></i></div>
        <div class="delivery-stat-nombre">${esc(x.plataforma)}</div>
        <div class="delivery-stat-cant">${x.cantidad} pedido${x.cantidad === 1 ? '' : 's'}</div>
        <div class="delivery-stat-total">${fmtMoneda(x.total)}</div>
      </div>`).join('') || '<div class="empty-state small"><i class="fas fa-motorcycle"></i><p>Sin ventas delivery pagadas hoy</p></div>';

    const activos = this.resumen.activos || { cantidad: 0, total: 0 };
    return `
      <div class="delivery-header">
        <div>
          <h2><i class="fas fa-motorcycle"></i> Delivery</h2>
          <p>Pedidos de plataformas de entrega del d&iacute;a</p>
        </div>
        <button class="btn btn-outline" onclick="Delivery.abrirConfigPlataformas()">
          <i class="fas fa-cog"></i> Plataformas
        </button>
      </div>
      <div class="delivery-activos">
        <span class="delivery-activos-badge"><i class="fas fa-truck"></i> ${activos.cantidad} en curso</span>
        <span>Total activos: <strong>${fmtMoneda(activos.total)}</strong></span>
      </div>
      <div class="delivery-stats">${cards}</div>
    `;
  },

  paint(view) {
    const filtros = [
      { v: 'todos', l: 'Todos' },
      { v: 'pendiente', l: 'Pendientes' },
      { v: 'aceptado', l: 'Aceptados' },
      { v: 'en_camino', l: 'En camino' },
      { v: 'entregado', l: 'Entregados' },
      { v: 'cancelado', l: 'Cancelados' }
    ];
    const filtroBtns = filtros.map(f =>
      `<button class="btn ${this.filtro === f.v ? 'btn-primary' : 'btn-outline'} btn-sm" onclick="Delivery.setFiltro('${f.v}')">${f.l}</button>`
    ).join(' ');

    const rows = this.pedidos.map(p => `
      <tr>
        <td class="font-bold">${esc(p.numero_pedido)}</td>
        <td>
          <span class="delivery-plataforma-chip" style="--chip-color:${esc(this.colorPlataforma(p))}">
            <i class="fas fa-${esc(this.iconoPlataforma(p))}"></i> ${esc(p.plataforma_nombre || 'Delivery')}
          </span>
        </td>
        <td>${esc(p.codigo_externo || '-')}</td>
        <td>${esc(p.cliente || '-')}</td>
        <td>${esc(p.direccion || '-')}</td>
        <td>${this.fmtEstado(p.estado_envio || p.estado_pedido)}</td>
        <td class="font-bold">${fmtMoneda(p.total)}</td>
        <td>${fmtFechaHora(p.creado_en)}</td>
        <td class="text-right">${this._acciones(p)}</td>
      </tr>`).join('');

    view.innerHTML = `
      ${this._cardResumen()}
      <div class="card mt-20">
        <div class="card-header">
          <span class="card-title"><i class="fas fa-list"></i> Pedidos de delivery</span>
        </div>
        <div class="filter-bar mb-20">${filtroBtns}</div>
        ${
          this.pedidos.length > 0 ? `
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>N&deg;</th><th>Plataforma</th><th>C&oacute;digo</th><th>Cliente</th>
                  <th>Direcci&oacute;n</th><th>Estado</th><th>Total</th><th>Fecha</th><th></th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>` : `<div class="empty-state"><i class="fas fa-motorcycle"></i><p>No hay pedidos de delivery</p></div>`
        }
      </div>
      <div class="card mt-20">
        <div class="card-info">
          <i class="fas fa-info-circle"></i>
          <div>
            <strong>Sobre la integraci&oacute;n autom&aacute;tica:</strong>
            PedidosYa, Rappi y Uber Eats solo entregan acceso a sus APIs a restaurantes con contrato o partner/agregador.
            Este sistema ya incluye el m&oacute;dulo de <strong>integraci&oacute;n v&iacute;a Webhook</strong>: abr&iacute;
            <em>Plataformas &rarr; Integrar</em>, activ&aacute; el modo autom&aacute;tico y configur&aacute; la URL y la API Key.
            Cuando tu partner/agregador envíe pedidos a esa URL, aparecer&aacute;n autom&aacute;ticamente en esta vista.
            Mientras tanto, los pedidos se siguen pudiendo cargar manualmente desde el Punto de Venta (tipo Delivery).
          </div>
        </div>
      </div>
    `;
  },

  _acciones(p) {
    if (p.estado_pedido === 'cancelado' || p.estado_envio === 'cancelado' || p.estado_envio === 'entregado') {
      return '';
    }
    if (!p.entrega_id) return '';
    const btn = (estado, label, icon, cls) =>
      `<button class="btn btn-${cls} btn-sm" onclick="Delivery.cambiarEstado(${p.id},'${estado}')"><i class="fas fa-${icon}"></i> ${label}</button>`;
    switch (p.estado_envio) {
      case 'pendiente': return btn('aceptado', 'Aceptar', 'check', 'success');
      case 'aceptado': return btn('en_camino', 'En camino', 'truck', 'info');
      case 'en_camino': return `${btn('entregado', 'Entregado', 'flag-checkered', 'primary')} ${btn('cancelado', 'Cancelar', 'times', 'danger')}`;
      default: return '';
    }
  },

  async cambiarEstado(pedidoId, estado) {
    try {
      await API.updateEstadoEntrega(pedidoId, { estado_envio: estado });
      App.showToast('Estado de entrega actualizado', 'success');
      this.render();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  async abrirConfigPlataformas() {
    try {
      this.plataformas = await API.getPlataformasDelivery();
    } catch (e) { /* mantener lista actual */ }
    const plat = this.plataformas || [];
    const rows = plat.map(p => `
      <div class="delivery-plataforma-row" data-id="${p.id}">
        <label class="switch">
          <input type="checkbox" data-field="activa" ${p.activa ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
        <div class="delivery-plataforma-info">
          <div class="delivery-plataforma-nombre">${esc(p.nombre)} ${this._badgeIntegracion(p)}</div>
          <div class="form-row">
            <label>Comisi&oacute;n (%)</label>
            <input type="number" data-field="comision" value="${p.comision || 0}" min="0" max="100">
            <label>Referencia / N&deg; restaurante</label>
            <input type="text" data-field="referencia" value="${esc(p.referencia || '')}" placeholder="Ej: 12345">
          </div>
        </div>
        <div class="plataforma-row-actions">
          <button type="button" class="btn btn-outline btn-sm" onclick="Delivery.abrirIntegracion(${p.id})"><i class="fas fa-plug"></i> Integrar</button>
          <button type="button" class="btn btn-danger btn-sm" onclick="Delivery.eliminarPlataforma(${p.id})"><i class="fas fa-trash"></i></button>
        </div>
      </div>`).join('');

    App.showModal(`
      <p class="modal-desc">Configur&aacute; qu&eacute; plataformas de delivery us&aacute;. Pod&eacute;s activar o desactivar cada una,
        registrar su comisi&oacute;n y referencia, o <strong>conectarla autom&aacute;ticamente</strong> con el bot&oacute;n <em>Integrar</em>.</p>
      <div class="delivery-plataformas-list">${rows || '<div class="empty-state"><i class="fas fa-motorcycle"></i><p>Sin plataformas</p></div>'}</div>
      <button class="btn btn-outline mt-20" onclick="Delivery.nuevaPlataforma()"><i class="fas fa-plus"></i> Nueva plataforma</button>
      <div class="modal-footer">
        <button type="button" class="btn btn-danger" onclick="App.closeModal()">Cancelar</button>
        <button type="button" class="btn btn-success" onclick="Delivery.guardarPlataformas()"><i class="fas fa-save"></i> Guardar</button>
      </div>
    `, { title: 'Plataformas de Delivery', large: true });
  },

  _badgeIntegracion(p) {
    let cfg = {};
    try { cfg = JSON.parse(p.config || '{}'); } catch (e) { cfg = {}; }
    if (cfg.modo === 'api') {
      const estado = cfg.estado === 'conectada'
        ? '<span class="badge badge-green">API conectada</span>'
        : '<span class="badge badge-blue">API configurada</span>';
      return estado;
    }
    return '<span class="badge badge-gray">Manual</span>';
  },

  async eliminarPlataforma(id) {
    if (!confirm('¿Eliminar esta plataforma de delivery?')) return;
    try {
      await API.deletePlataformaDelivery(id);
      App.showToast('Plataforma eliminada', 'success');
      this.abrirConfigPlataformas();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  async abrirIntegracion(id) {
    try {
      const info = await API.getIntegracionPlataforma(id);
      this.integracion = info;
      const c = info.config || {};
      const modoApi = c.modo === 'api';
      App.showModal(`
        <form onsubmit="Delivery.guardarIntegracion(event, ${info.id})">
          <div class="form-group">
            <label>Modo de carga de pedidos</label>
            <select id="intModo" onchange="Delivery.cambiarModoIntegracion()">
              <option value="manual" ${modoApi ? '' : 'selected'}>Manual (cargar desde el Punto de Venta)</option>
              <option value="api" ${modoApi ? 'selected' : ''}>Autom&aacute;tico v&iacute;a API / Webhook</option>
            </select>
          </div>
          <div id="intApiBox" style="${modoApi ? '' : 'display:none'}">
            <div class="form-group">
              <label>URL del Webhook (direcci&oacute;n donde se reciben los pedidos)</label>
              <div class="webhook-url-box">
                <input type="text" id="intWebhook" class="webhook-url" readonly value="${esc(info.webhook_url || '')}">
                <button type="button" class="btn btn-outline btn-sm" onclick="Delivery.copiarTexto('intWebhook')"><i class="fas fa-copy"></i> Copiar</button>
              </div>
              <small class="form-hint">Copi&aacute; esta URL en la configuraci&oacute;n de tu partner/agregador con API.</small>
            </div>
            <div class="grid grid-2">
              <div class="form-group">
                <label>API Key (secreto)</label>
                <div class="webhook-url-box">
                  <input type="text" id="intApiKey" value="${esc(c.api_key || '')}" placeholder="Peg&aacute; la de tu partner o gener&aacute; una">
                  <button type="button" class="btn btn-outline btn-sm" onclick="Delivery.generarApiKey()"><i class="fas fa-dice"></i> Generar</button>
                </div>
              </div>
              <div class="form-group">
                <label>Partner / N&deg; de restaurante</label>
                <input type="text" id="intPartner" value="${esc(c.partner_id || '')}" placeholder="Ej: 12345">
              </div>
            </div>
            <div class="card-info mt-10">
              <i class="fas fa-info-circle"></i>
              <div>PedidosYa, Rappi y Uber Eats solo entregan acceso a su API a restaurantes con contrato/partner.
                Si tu restaurante trabaja con un agregador que provee API, us&aacute; la URL y la API Key que te entreguen,
                o gener&aacute; la tuya y pas&aacute;sela a tu partner para que configure los env&iacute;os.</div>
            </div>
          </div>
          <div id="intStatus" class="mt-10"></div>
          <div class="modal-footer">
            <button type="button" class="btn btn-danger" onclick="App.closeModal()">Cancelar</button>
            <button type="button" class="btn btn-outline" id="btnTest" ${modoApi ? '' : 'disabled'} onclick="Delivery.testearIntegracion(${info.id})"><i class="fas fa-plug"></i> Probar conexi&oacute;n</button>
            <button type="submit" class="btn btn-success"><i class="fas fa-save"></i> Guardar config</button>
          </div>
        </form>
      `, { title: `Integrar ${info.nombre}`, large: true });
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  cambiarModoIntegracion() {
    const api = document.getElementById('intModo').value === 'api';
    const box = document.getElementById('intApiBox');
    if (box) box.style.display = api ? '' : 'none';
    const btn = document.getElementById('btnTest');
    if (btn) btn.disabled = !api;
    const status = document.getElementById('intStatus');
    if (status) status.innerHTML = '';
  },

  async guardarIntegracion(e, id) {
    e.preventDefault();
    const modo = document.getElementById('intModo').value;
    const data = {
      modo,
      api_key: document.getElementById('intApiKey').value.trim(),
      partner_id: document.getElementById('intPartner').value.trim()
    };
    try {
      await API.saveIntegracionPlataforma(id, data);
      App.showToast('Configuración de integración guardada', 'success');
      App.closeModal();
      this.render();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  async testearIntegracion(id) {
    const status = document.getElementById('intStatus');
    const apiKey = document.getElementById('intApiKey').value.trim();
    const data = {
      modo: document.getElementById('intModo').value,
      api_key: apiKey,
      partner_id: document.getElementById('intPartner').value.trim()
    };
    if (data.modo !== 'api') {
      status.innerHTML = '<div class="card-info"><i class="fas fa-info-circle"></i><div>Activ&aacute; el modo autom&aacute;tico para probar la conexi&oacute;n.</div></div>';
      return;
    }
    if (!apiKey) {
      status.innerHTML = '<div class="card-info"><i class="fas fa-exclamation-triangle"></i><div>Gener&aacute; una API Key antes de probar la conexi&oacute;n.</div></div>';
      return;
    }
    status.innerHTML = '<div class="text-center"><i class="fas fa-spinner fa-spin"></i> Probando conexi&oacute;n...</div>';
    try {
      const res = await API.testIntegracionPlataforma(id, data);
      status.innerHTML = res.ok
        ? `<div class="card-info"><i class="fas fa-check-circle" style="color:var(--success)"></i><div><strong>Conexi&oacute;n OK.</strong> ${esc(res.message || 'El webhook está operativo.')}</div></div>`
        : `<div class="card-info"><i class="fas fa-exclamation-triangle" style="color:var(--danger)"></i><div>${esc(res.message || 'No se pudo conectar')}</div></div>`;
    } catch (err) {
      status.innerHTML = `<div class="card-info"><i class="fas fa-exclamation-triangle" style="color:var(--danger)"></i><div>${esc(err.message)}</div></div>`;
    }
  },

  generarApiKey() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz0123456789';
    // Generador criptográfico (Math.random no es seguro para claves)
    const bytes = crypto.getRandomValues(new Uint32Array(32));
    let key = '';
    for (let i = 0; i < 32; i++) key += chars[bytes[i] % chars.length];
    const input = document.getElementById('intApiKey');
    if (input) {
      input.value = key;
      App.showToast('API Key generada', 'success');
    }
  },

  copiarTexto(idElemento) {
    const input = document.getElementById(idElemento);
    if (!input) return;
    input.select();
    input.setSelectionRange(0, 99999);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(input.value).then(() => App.showToast('Copiado al portapapeles', 'success'));
    } else {
      document.execCommand('copy');
      App.showToast('Copiado al portapapeles', 'success');
    }
  },

  nuevaPlataforma() {
    App.showModal(`
      <form onsubmit="Delivery.crearPlataforma(event)">
        <div class="form-group"><label>Nombre</label>
          <input type="text" id="nuevaPlatNombre" required placeholder="Ej: PedidosYa, Rappi, Uber Eats"></div>
        <div class="grid grid-2">
          <div class="form-group"><label>Color</label><input type="color" id="nuevaPlatColor" value="#6A0DAD"></div>
          <div class="form-group"><label>Comisi&oacute;n (%)</label><input type="number" id="nuevaPlatComision" min="0" max="100" value="0"></div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-danger" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-success">Crear</button>
        </div>
      </form>
    `, { title: 'Nueva plataforma de delivery' });
  },

  async crearPlataforma(e) {
    e.preventDefault();
    try {
      await API.createPlataformaDelivery({
        nombre: document.getElementById('nuevaPlatNombre').value,
        color: document.getElementById('nuevaPlatColor').value,
        comision: parseFloat(document.getElementById('nuevaPlatComision').value) || 0,
        icono: 'motorcycle',
        activa: true
      });
      App.closeModal();
      App.showToast('Plataforma creada', 'success');
      this.abrirConfigPlataformas();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  async guardarPlataformas() {
    try {
      const lista = this.plataformas.map(p => {
        const row = document.querySelector(`.delivery-plataforma-row[data-id="${p.id}"]`);
        if (!row) return p;
        const activa = row.querySelector('[data-field="activa"]').checked;
        const comision = row.querySelector('[data-field="comision"]').value;
        const referencia = row.querySelector('[data-field="referencia"]').value;
        return { ...p, activa, comision: parseFloat(comision) || 0, referencia };
      });
      await API.savePlataformasDelivery(lista);
      App.closeModal();
      App.showToast('Plataformas guardadas', 'success');
      this.render();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  }
};


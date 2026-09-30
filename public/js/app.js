// =============================================
// GASTROMANAGER - Aplicación Principal
// Navegación, login y vistas
// =============================================

const App = {
  usuario: null,
  currentView: 'dashboard',
  socket: null,

  init() {
    this.setupLogin();
    this.setupNavigation();
    this.setupLogout();
    this.setupMobile();
    this.checkSession();
  },

  // ===== Socket.IO realtime =====
  initSocket() {
    if (this.socket) return; // ya conectado
    try {
      this.socket = io({ transports: ['websocket', 'polling'], auth: { token: API.getToken() } });

      this.socket.on('connect', () => {
        this._setRealtimeStatus(true);
      });

      this.socket.on('disconnect', () => {
        this._setRealtimeStatus(false);
      });

      // Nuevos pedidos — notificación global
      this.socket.on('pedido:nuevo', (data) => {
        this.showToast(
          `Nuevo pedido: ${data.numero_pedido || ''} — ${data.tipo || ''}`,
          'info',
          6000
        );
        this._updateBadge('navBadgeCocina');
        if (App.currentView === 'dashboard') Dashboard.render();
        if (App.currentView === 'mesas') Mesas.render();
        if (App.currentView === 'pedidos') Pedidos.render();
      });

      // Cocina: nueva comanda o cambio de estado
      this.socket.on('cocina:actualizar', () => {
        if (App.currentView === 'cocina') {
          Cocina.refresh();
        } else {
          this._updateBadge('navBadgeCocina');
        }
      });

      // Delivery: cambio de estado
      this.socket.on('delivery:actualizar', (data) => {
        if (App.currentView === 'delivery') {
          Delivery.render();
        } else {
          this._updateBadge('navBadgeDelivery');
          if (data && data.estado) {
            const estadoLabel = { en_camino: 'En camino', entregado: 'Entregado', cancelado: 'Cancelado' }[data.estado];
            if (estadoLabel) this.showToast(`Delivery ${data.numero_pedido || ''}: ${estadoLabel}`, 'info');
          }
        }
      });

      // Pedido pagado — actualizar dashboard en background
      this.socket.on('pedido:pagado', () => {
        if (App.currentView === 'dashboard') Dashboard.render();
        if (App.currentView === 'caja') Caja.render();
      });

      // Pedido cancelado
      this.socket.on('pedido:cancelado', (data) => {
        this.showToast(`Pedido ${data.numero_pedido || ''} cancelado`, 'warning');
        if (App.currentView === 'mesas') Mesas.render();
        if (App.currentView === 'pedidos') Pedidos.render();
        if (App.currentView === 'cocina') Cocina.refresh();
      });

      // Falla de una impresora térmica: avisar para que reimpriman o revisen la impresora
      this.socket.on('impresion:error', (data) => {
        const que = { comanda: 'la comanda', agregado: 'el agregado', anulado: 'la anulación', ticket: 'el ticket' }[data.tipo] || 'el documento';
        this.showToast(`No se pudo imprimir ${que} en "${data.impresora}": ${data.error}`, 'error', 10000);
      });

      // Cambio de estado de una mesa en otra terminal
      this.socket.on('mesas:actualizar', () => {
        if (App.currentView === 'mesas') Mesas.render();
      });

      // Dashboard global refresh
      this.socket.on('dashboard:actualizar', () => {
        if (App.currentView === 'dashboard') Dashboard.render();
      });

    } catch (e) {
      console.warn('Socket.IO no disponible:', e.message);
    }
  },

  _setRealtimeStatus(connected) {
    const dot = document.getElementById('realtimeDot');
    const label = document.getElementById('realtimeLabel');
    // Sincronizar también el dot del topbar móvil
    const topbarDot = document.getElementById('topbarDot');
    if (dot && label) {
      if (connected) {
        dot.className = 'realtime-dot online';
        label.textContent = 'En línea';
      } else {
        dot.className = 'realtime-dot offline';
        label.textContent = 'Desconectado';
      }
    }
    if (topbarDot) {
      topbarDot.className = connected
        ? 'topbar-realtime-dot online'
        : 'topbar-realtime-dot offline';
    }
  },

  _updateBadge(id, increment = true) {
    const el = document.getElementById(id);
    if (!el) return;
    const cur = parseInt(el.textContent, 10) || 0;
    const next = increment ? cur + 1 : 0;
    el.textContent = next > 0 ? (next > 99 ? '99+' : next) : '';
    el.style.display = next > 0 ? 'inline-flex' : 'none';
  },

  clearBadge(id) {
    this._updateBadge(id, false);
  },

  checkSession() {
    const token = API.getToken();
    if (token) {
      this.cargarSesion();
    }
  },

  async cargarSesion() {
    try {
      this.usuario = await API.getMe();
      this.showApp();
    } catch (err) {
      API.clearToken();
    }
  },

  setupLogin() {
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('loginEmail').value;
      const password = document.getElementById('loginPassword').value;
      const errorDiv = document.getElementById('loginError');
      errorDiv.style.display = 'none';

      try {
        const result = await API.login(email, password);
        this.usuario = result.usuario;
        this.showApp();
        this.showToast('Bienvenido, ' + result.usuario.nombre + '!', 'success');
      } catch (err) {
        errorDiv.textContent = err.message;
        errorDiv.style.display = 'block';
      }
    });
  },

  // Contraseña por defecto o provisoria: hay que cambiarla antes de usar el sistema
  mostrarCambioPassword() {
    this.showModal(`
      <form onsubmit="App.guardarCambioPassword(event)">
        <p style="margin-bottom:12px">Por seguridad, antes de continuar tenés que elegir una contraseña nueva.</p>
        <div class="form-group">
          <label>Contraseña actual</label>
          <input type="password" id="cpActual" autocomplete="current-password" required>
        </div>
        <div class="form-group">
          <label>Contraseña nueva (mínimo 8 caracteres)</label>
          <input type="password" id="cpNueva" minlength="8" autocomplete="new-password" required>
        </div>
        <div class="form-group">
          <label>Repetir contraseña nueva</label>
          <input type="password" id="cpRepetir" minlength="8" autocomplete="new-password" required>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-danger" onclick="API.clearToken(); location.reload()">Salir</button>
          <button type="submit" class="btn btn-success"><i class="fas fa-key"></i> Cambiar contraseña</button>
        </div>
      </form>
    `, { title: 'Cambiar contraseña', fijo: true });
  },

  async guardarCambioPassword(e) {
    e.preventDefault();
    const actual = document.getElementById('cpActual').value;
    const nueva = document.getElementById('cpNueva').value;
    if (nueva !== document.getElementById('cpRepetir').value) {
      this.showToast('Las contraseñas nuevas no coinciden', 'error');
      return;
    }
    try {
      const res = await API.request('PUT', '/auth/password', { actual, nueva });
      API.setToken(res.token);
      this.usuario.debe_cambiar_password = 0;
      this.closeModal();
      this.showToast('Contraseña actualizada', 'success');
      this.showApp();
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  showApp() {
    if (this.usuario && this.usuario.debe_cambiar_password) {
      document.getElementById('loginScreen').style.display = 'none';
      this.mostrarCambioPassword();
      return;
    }
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    document.getElementById('userName').textContent = this.usuario.nombre;
    document.getElementById('userRole').textContent = this.usuario.rol_nombre || this.usuario.rol;

    // Mostrar solo las secciones permitidas para el rol
    this.aplicarPermisos();

    // Iniciar conexión Socket.IO realtime
    this.initSocket();

    // Cargar módulos activos y verificar setup
    this.cargarModulos();

    this.navigateTo(this.vistaInicial());

    // Deep link: si la URL tiene ?view=X, navegar a esa vista
    const urlParams = new URLSearchParams(window.location.search);
    const deepView = urlParams.get('view');
    if (deepView) {
      this.navigateTo(deepView);
      // Limpiar el parámetro de la URL sin recargar
      history.replaceState({}, '', window.location.pathname);
    }
  },

  async cargarModulos() {
    try {
      const config = await API.getConfig();
      const modulos = Array.isArray(config.modulos_activos) && config.modulos_activos.length
        ? config.modulos_activos : null;
      if (modulos) this.aplicarModulos(modulos);
      // Mostrar wizard si admin y setup no completado
      if (this.puede('admin') && !config.setup_completado) {
        this.mostrarWizardSetup();
      }
    } catch (e) { /* silencioso */ }
  },

  aplicarModulos(modulos) {
    document.querySelectorAll('[data-modulo]').forEach(el => {
      const m = el.dataset.modulo;
      el.style.display = modulos.includes(m) ? '' : 'none';
    });
    // Los módulos no deben volver a mostrar secciones que el rol no tiene permitidas
    this.aplicarPermisos();
  },

  // ===== Permisos por rol =====
  // Permiso necesario para cada sección (el servidor igual controla cada acción)
  VISTA_PERMISO: {
    dashboard: 'reportes', pos: 'pedidos.tomar', mesas: 'pedidos.ver', pedidos: 'pedidos.ver',
    delivery: 'delivery', cocina: 'cocina', productos: 'catalogo', stock: 'stock.ver',
    proveedores: 'stock.ver', clientes: 'clientes', caja: 'caja.operar', reportes: 'reportes',
    integraciones: 'admin', usuarios: 'admin', config: 'admin', qr: 'catalogo'
  },

  puede(permiso) {
    return !!(this.usuario && Array.isArray(this.usuario.permisos) && this.usuario.permisos.includes(permiso));
  },

  puedeVer(vista) {
    const permiso = this.VISTA_PERMISO[vista];
    return !permiso || this.puede(permiso);
  },

  aplicarPermisos() {
    document.querySelectorAll('[data-view]').forEach(el => {
      if (!this.puedeVer(el.dataset.view)) el.style.display = 'none';
    });
  },

  // Primera sección permitida: dashboard para quien ve ventas, mesas para el mozo, cocina para cocina
  vistaInicial() {
    return ['dashboard', 'mesas', 'pos', 'cocina', 'pedidos', 'caja', 'stock'].find(v => this.puedeVer(v)) || 'cocina';
  },

  async mostrarWizardSetup() {
    let perfiles = {};
    try { perfiles = await API.getPerfilesNegocio(); } catch(e) { perfiles = {}; }
    const tarjetas = Object.entries(perfiles).map(([key, p]) => `
      <div class="wizard-card" onclick="App.seleccionarPerfil('${key}')" data-perfil="${key}">
        <div class="wizard-card-icon"><i class="fas fa-store"></i></div>
        <div class="wizard-card-label">${esc(p.label)}</div>
      </div>`).join('');
    const div = document.getElementById('wizardSetup');
    if (!div) return;
    div.innerHTML = `
      <div class="wizard-overlay">
        <div class="wizard-modal">
          <div class="wizard-header">
            <h2><i class="fas fa-store"></i> Configurar tipo de negocio</h2>
            <p>Elegí el perfil que mejor describe tu negocio. Podés cambiarlo después desde Configuración.</p>
          </div>
          <div class="tipos-negocio-grid">${tarjetas}</div>
          <div class="wizard-footer">
            <button class="btn btn-outline" onclick="App.cerrarWizard()">Omitir por ahora</button>
          </div>
        </div>
      </div>`;
    div.style.display = 'block';
  },

  async seleccionarPerfil(tipo) {
    try {
      let perfiles = {};
      try { perfiles = await API.getPerfilesNegocio(); } catch(e) {}
      const perfil = perfiles[tipo];
      await API.updateConfig({
        tipo_negocio: tipo,
        modulos_activos: perfil ? perfil.modulos : [],
        terminologia: perfil ? perfil.terminologia : {},
        setup_completado: 1
      });
      if (perfil) this.aplicarModulos(perfil.modulos);
      this.cerrarWizard();
      this.showToast('Perfil configurado: ' + (perfil ? perfil.label : tipo), 'success');
    } catch(err) {
      this.showToast(err.message, 'error');
    }
  },

  cerrarWizard() {
    const div = document.getElementById('wizardSetup');
    if (div) div.style.display = 'none';
  },

  setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const view = item.dataset.view;
        this.navigateTo(view);
      });
    });
  },

  navigateTo(view) {
    // Una sección no permitida (enlace directo, botón de otra vista) lleva a la inicial del rol
    if (!this.puedeVer(view)) view = this.vistaInicial();
    this.currentView = view;

    // Cerrar sidebar en mobile al navegar
    this.closeSidebar();

    // Actualizar sidebar nav items
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.view === view);
    });

    // Actualizar bottom nav
    document.querySelectorAll('.bottom-nav-item[data-view]').forEach(item => {
      item.classList.toggle('active', item.dataset.view === view);
    });

    // Ocultar todas las vistas
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

    // Mostrar la vista seleccionada
    const viewEl = document.getElementById(`view-${view}`);
    if (viewEl) {
      viewEl.classList.add('active');
      this.renderView(view);
    }
  },

  renderView(view) {
    const renderers = {
      'dashboard': () => Dashboard.render(),
      'pos': () => POS.render(),
      'mesas': () => Mesas.render(),
      'pedidos': () => Pedidos.render(),
      'delivery': () => Delivery.render(),
      'cocina': () => Cocina.render(),
      'productos': () => Productos.render(),
      'stock': () => Stock.render(),
      'proveedores': () => Proveedores.render(),
      'clientes': () => Clientes.render(),
      'caja': () => Caja.render(),
      'reportes': () => Reportes.render(),
      'usuarios': () => Usuarios.render(),
      'config': () => ConfigView.render(),
      'integraciones': () => Integraciones.render(),
      'qr': () => QRView.render()
    };

    if (renderers[view]) {
      renderers[view]();
    }
  },

  setupLogout() {
    document.getElementById('btnLogout').addEventListener('click', () => {
      API.clearToken();
      window.location.reload();
    });
  },

  showModal(html, options = {}) {
    const container = document.getElementById('modalContainer');
    container.innerHTML = `
      <div class="modal-overlay" ${options.fijo ? '' : 'onclick="if(event.target===this)App.closeModal()"'}>
        <div class="modal ${options.large ? 'modal-lg' : ''}">
          <div class="modal-header">
            <h3>${esc(options.title || '')}</h3>
            ${options.fijo ? '' : '<button class="modal-close" onclick="App.closeModal()">&times;</button>'}
          </div>
          ${html}
        </div>
      </div>
    `;
  },

  closeModal() {
    document.getElementById('modalContainer').innerHTML = '';
  },

  showToast(message, type = 'info', duration = 3500) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    // El mensaje se trata como texto (puede venir del servidor o de APIs externas)
    const icono = document.createElement('i');
    icono.className = `fas fa-${this.iconFor(type)}`;
    toast.append(icono, ' ', String(message == null ? '' : message));
    // Allow closing on click
    toast.addEventListener('click', () => toast.remove());
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.4s';
      setTimeout(() => toast.remove(), 400);
    }, duration);
  },

  iconFor(type) {
    return { 'success': 'check-circle', 'error': 'exclamation-circle', 'warning': 'exclamation-triangle', 'info': 'info-circle' }[type] || 'info';
  },

  // ===== Impresión de recibo / ticket =====
  generarHTMLRecibo(p) {
    const lineas = (p.items || []).map(i => `
      <tr>
        <td>${i.cantidad} x</td>
        <td>${esc(i.nombre_producto)}</td>
        <td class="right">${fmtMoneda(i.subtotal)}</td>
      </tr>`).join('');
    const desc = (p.pedido && p.pedido.descuento) || p.descuento || 0;
    const propina = (p.pedido && p.pedido.propina) || p.propina || 0;
    const total = (p.pedido && p.pedido.total) || p.total || 0;
    return `
      <!DOCTYPE html>
      <html><head><meta charset="UTF-8"><title>Recibo ${esc(p.numero_pedido)}</title>
      <style>
        body { font-family: monospace; width: 76mm; margin: 0 auto; font-size: 12px; color:#000; }
        .center { text-align: center; }
        .bold { font-weight: bold; }
        table { width: 100%; border-collapse: collapse; }
        td { padding: 2px 0; }
        .right { text-align: right; }
        .sep { border-top: 1px dashed #000; margin: 8px 0; }
        .tot { font-size: 15px; }
      </style></head>
      <body>
        <div class="center bold" style="font-size:15px">${esc(App && App.usuario ? (App.nombreNegocio || 'GastroManager') : 'GastroManager')}</div>
        <div class="center">${esc(p.mesa_nombre || '')}</div>
        <div class="sep"></div>
        <div><span class="bold">Ticket:</span> ${esc(p.numero_pedido)}</div>
        <div><span class="bold">Fecha:</span> ${fmtFechaHora(new Date().toISOString())}</div>
        <div class="sep"></div>
        <table><thead><tr><th>Cant</th><th>Producto</th><th class="right">Subtotal</th></tr></thead>
        <tbody>${lineas}</tbody></table>
        <div class="sep"></div>
        <table>
          <tr><td>Subtotal</td><td class="right">${fmtMoneda((p.pedido && p.pedido.subtotal) || p.subtotal || total)}</td></tr>
          ${desc ? `<tr><td>Descuento</td><td class="right">-${fmtMoneda(desc)}</td></tr>` : ''}
          ${propina ? `<tr><td>Propina</td><td class="right">${fmtMoneda(propina)}</td></tr>` : ''}
          <tr class="tot bold"><td>TOTAL</td><td class="right">${fmtMoneda(total)}</td></tr>
        </table>
        <div class="sep"></div>
        <div class="center">\u00a1Gracias por su visita!</div>
      </body></html>`;
  },

  imprimirRecibo(pedido) {
    const win = window.open('', '_blank', 'width=400,height=600');
    if (!win) { this.showToast('Habilita las ventanas emergentes para imprimir', 'warning'); return; }
    win.document.write(this.generarHTMLRecibo(pedido));
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 300);
  },

  // ===== MOBILE: Sidebar, overlay, bottom nav, swipe =====
  setupMobile() {
    const sidebar  = document.getElementById('sidebar');
    const overlay  = document.getElementById('sidebarOverlay');
    const btnOpen  = document.getElementById('btnHamburger');
    const btnClose = document.getElementById('btnSidebarClose');
    const btnMore  = document.getElementById('btnBottomMore');
    const btnHamb  = document.getElementById('btnHamburger');

    // Abrir sidebar
    const openSidebar = () => {
      if (!sidebar) return;
      sidebar.classList.add('open');
      if (overlay) overlay.classList.add('active');
      if (btnHamb) btnHamb.setAttribute('aria-expanded', 'true');
      document.body.style.overflow = 'hidden';
    };

    // Cerrar sidebar
    this.closeSidebar = () => {
      if (!sidebar) return;
      sidebar.classList.remove('open');
      if (overlay) overlay.classList.remove('active');
      if (btnHamb) btnHamb.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
    };

    if (btnOpen)  btnOpen.addEventListener('click',  openSidebar);
    if (btnClose) btnClose.addEventListener('click',  this.closeSidebar);
    if (overlay)  overlay.addEventListener('click',   this.closeSidebar);
    if (btnMore)  btnMore.addEventListener('click',   openSidebar);

    // Bottom nav: clicks en ítems con data-view
    const bottomNav = document.getElementById('bottomNav');
    if (bottomNav) {
      bottomNav.addEventListener('click', (e) => {
        const item = e.target.closest('.bottom-nav-item[data-view]');
        if (item) {
          e.preventDefault();
          this.navigateTo(item.dataset.view);
        }
      });
    }

    // Swipe izquierda sobre main-content cierra sidebar
    let touchStartX = 0;
    let touchStartY = 0;
    const mainContent = document.querySelector('.main-content');
    if (mainContent) {
      mainContent.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      }, { passive: true });

      mainContent.addEventListener('touchend', (e) => {
        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = e.changedTouches[0].clientY - touchStartY;
        // Swipe izquierda (dx < -60) predominantemente horizontal
        if (dx < -60 && Math.abs(dy) < 80) {
          this.closeSidebar();
        }
        // Swipe derecha desde borde izquierdo abre sidebar
        if (dx > 60 && touchStartX < 24 && Math.abs(dy) < 80) {
          openSidebar();
        }
      }, { passive: true });
    }

    // Swipe desde el overlay también cierra
    if (overlay) {
      overlay.addEventListener('touchend', (e) => {
        const dx = e.changedTouches[0].clientX - touchStartX;
        if (dx < -30) this.closeSidebar();
      }, { passive: true });
    }

    // Escape cierra sidebar
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeSidebar();
    });

    // Inicializar closeSidebar como no-op si sidebar no existe
    if (!this.closeSidebar) this.closeSidebar = () => {};
  },


};

// Inicializar cuando cargue la p\u00e1gina
document.addEventListener('DOMContentLoaded', () => App.init());

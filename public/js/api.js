// =============================================
// GASTROMANAGER - API Client
// Manejador de peticiones HTTP al backend
// =============================================

const API = {
  token: null,
  baseURL: '/api',

  setToken(token) {
    this.token = token;
    localStorage.setItem('gm_token', token);
  },

  getToken() {
    if (!this.token) {
      this.token = localStorage.getItem('gm_token');
    }
    return this.token;
  },

  clearToken() {
    this.token = null;
    localStorage.removeItem('gm_token');
  },

  async request(method, url, data = null) {
    const headers = {};
    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    if (data) {
      headers['Content-Type'] = 'application/json';
    }

    const options = { method, headers };
    if (data) {
      options.body = JSON.stringify(data);
    }

    const response = await fetch(`${this.baseURL}${url}`, options);

    if (response.status === 401) {
      this.clearToken();
      window.location.reload();
      throw new Error('Sesi\u00f3n expirada');
    }

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.error || 'Error en la petici\u00f3n');
    }

    return result;
  },

  // ===== Autenticaci\u00f3n =====
  async login(email, password) {
    const result = await this.request('POST', '/auth/login', { email, password });
    this.setToken(result.token);
    return result;
  },

  async getMe() {
    return this.request('GET', '/auth/me');
  },

  // ===== Configuración =====
  getConfig() { return this.request('GET', '/config'); },
  updateConfig(data) { return this.request('PUT', '/config', data); },
  getPerfilesNegocio() { return this.request('GET', '/config/perfiles'); },

  // ===== Usuarios =====
  getUsuarios() { return this.request('GET', '/usuarios'); },
  createUsuario(data) { return this.request('POST', '/usuarios', data); },
  updateUsuario(id, data) { return this.request('PUT', `/usuarios/${id}`, data); },
  deleteUsuario(id) { return this.request('DELETE', `/usuarios/${id}`); },

  // ===== Categor\u00edas =====
  getCategorias() { return this.request('GET', '/categorias'); },
  createCategoria(data) { return this.request('POST', '/categorias', data); },
  updateCategoria(id, data) { return this.request('PUT', `/categorias/${id}`, data); },
  deleteCategoria(id) { return this.request('DELETE', `/categorias/${id}`); },

  // ===== Productos =====
  getProductos() { return this.request('GET', '/productos'); },
  createProducto(data) { return this.request('POST', '/productos', data); },
  updateProducto(id, data) { return this.request('PUT', `/productos/${id}`, data); },
  deleteProducto(id) { return this.request('DELETE', `/productos/${id}`); },

  // ===== Mesas =====
  getMesas() { return this.request('GET', '/mesas'); },
  createMesa(data) { return this.request('POST', '/mesas', data); },
  updateMesa(id, data) { return this.request('PUT', `/mesas/${id}`, data); },
  deleteMesa(id) { return this.request('DELETE', `/mesas/${id}`); },

  // ===== Reservas =====
  getReservas(fecha = null) {
    const params = new URLSearchParams();
    if (fecha) params.append('fecha', fecha);
    const qs = params.toString();
    return this.request('GET', `/reservas${qs ? '?' + qs : ''}`);
  },
  createReserva(data) { return this.request('POST', '/reservas', data); },
  updateReserva(id, data) { return this.request('PUT', `/reservas/${id}`, data); },
  deleteReserva(id) { return this.request('DELETE', `/reservas/${id}`); },

  // ===== Promociones =====
  getPromociones() { return this.request('GET', '/promociones'); },
  createPromocion(data) { return this.request('POST', '/promociones', data); },
  updatePromocion(id, data) { return this.request('PUT', `/promociones/${id}`, data); },
  deletePromocion(id) { return this.request('DELETE', `/promociones/${id}`); },


  // ===== Pedidos =====
  getPedidos(estado = 'abiertos', fecha = null) {
    const params = new URLSearchParams();
    params.append('estado', estado);
    if (fecha) params.append('fecha', fecha);
    return this.request('GET', `/pedidos?${params.toString()}`);
  },

  getPedido(id) { return this.request('GET', `/pedidos/${id}`); },
  createPedido(data) { return this.request('POST', '/pedidos', data); },
  addItemToPedido(id, data) { return this.request('POST', `/pedidos/${id}/items`, data); },
  aplicarDescuento(id, descuento) { return this.request('PUT', `/pedidos/${id}/descuento`, { descuento }); },
  pagarPedido(id, data) { return this.request('POST', `/pedidos/${id}/pagar`, data); },
  cancelarPedido(id) { return this.request('PUT', `/pedidos/${id}/cancelar`); },

  // ===== Delivery / Plataformas de entrega =====
  getPlataformasDelivery() { return this.request('GET', '/delivery/plataformas'); },
  savePlataformasDelivery(plataformas) { return this.request('PUT', '/delivery/plataformas', { plataformas }); },
  createPlataformaDelivery(data) { return this.request('POST', '/delivery/plataformas', data); },
  deletePlataformaDelivery(id) { return this.request('DELETE', `/delivery/plataformas/${id}`); },
  getPedidosDelivery(estado = 'todos', fecha = null) {
    const params = new URLSearchParams();
    if (estado && estado !== 'todos') params.append('estado', estado);
    if (fecha) params.append('fecha', fecha);
    const qs = params.toString();
    return this.request('GET', `/delivery/pedidos${qs ? '?' + qs : ''}`);
  },
  updateEstadoEntrega(id, data) { return this.request('PUT', `/delivery/pedidos/${id}/estado`, data); },
  getResumenDelivery() { return this.request('GET', '/delivery/resumen'); },

  // ===== Integración de plataformas de delivery (webhook/API) =====
  getIntegracionPlataforma(id) { return this.request('GET', `/delivery/plataformas/${id}/integracion`); },
  saveIntegracionPlataforma(id, data) { return this.request('PUT', `/delivery/plataformas/${id}/integracion`, data); },
  testIntegracionPlataforma(id, data) { return this.request('POST', `/delivery/plataformas/${id}/integracion/test`, data); },

  // ===== Caja =====
  abrirCaja(data) { return this.request('POST', '/caja/abrir', data); },
  cerrarCaja(data) { return this.request('POST', '/caja/cerrar', data); },
  getCajaEstado() { return this.request('GET', '/caja/estado'); },
  getHistorialCaja() { return this.request('GET', '/caja/historial'); },
  getArqueoCaja(id) { return this.request('GET', `/caja/${id}/arqueo`); },
  registrarMovimientoCaja(data) { return this.request('POST', '/caja/movimiento', data); },
// ===== Proveedores =====
  getProveedores() { return this.request('GET', '/proveedores'); },
  createProveedor(data) { return this.request('POST', '/proveedores', data); },
  updateProveedor(id, data) { return this.request('PUT', `/proveedores/${id}`, data); },
  deleteProveedor(id) { return this.request('DELETE', `/proveedores/${id}`); },

  // ===== Stock =====
  getStock() { return this.request('GET', '/stock'); },
  getMovimientosStock() { return this.request('GET', '/stock/movimientos'); },
  registrarMovimientoStock(data) { return this.request('POST', '/stock/movimiento', data); },

  // ===== Clientes =====
  getClientes() { return this.request('GET', '/clientes'); },
  createCliente(data) { return this.request('POST', '/clientes', data); },
  updateCliente(id, data) { return this.request('PUT', `/clientes/${id}`, data); },
  deleteCliente(id) { return this.request('DELETE', `/clientes/${id}`); },

  // ===== Reportes =====
  getDashboard() { return this.request('GET', '/reportes/dashboard'); },
  getReporteVentas(desde = null, hasta = null) {
    const params = new URLSearchParams();
    if (desde) params.append('desde', desde);
    if (hasta) params.append('hasta', hasta);
    const qs = params.toString();
    return this.request('GET', `/reportes/ventas${qs ? '?' + qs : ''}`);
  },
  getRentabilidad() { return this.request('GET', '/reportes/rentabilidad'); },

  // ===== Auditor\u00eda =====
  getAuditoria() { return this.request('GET', '/auditoria'); },

  // ===== Inteligencia de negocio =====
  getInsights() { return this.request('GET', '/insights'); },

  // ===== Cocina / comandas =====
  getCocina() { return this.request('GET', '/cocina'); },

  // ===== Menú público (sin autenticación) =====

  // ===== Integraciones =====
  getIntegracionesConfig()          { return this.request('GET',  '/integraciones/config'); },
  getIntegracionesEstado()          { return this.request('GET',  '/integraciones/estado'); },
  saveIntegracionConfig(tipo, data) { return this.request('PUT',  `/integraciones/config/${tipo}`, data); },
  testIntegracion(tipo)             { return this.request('POST', `/integraciones/test/${tipo}`); },
  getComprobantesAFIP(limit = 10)   { return this.request('GET',  `/integraciones/afip/comprobantes?limit=${limit}`); },
  generarComprobante(data)          { return this.request('POST', '/integraciones/afip/facturar', data); },
  syncProductosTiendaNube()         { return this.request('POST', '/integraciones/tiendanube/sync-productos'); },
  crearLinkMercadoPago(pedidoId)    { return this.request('POST', `/integraciones/mercadopago/link/${pedidoId}`); },

  // ===== Copias de seguridad (admin) =====
  getBackups()  { return this.request('GET', '/backups'); },
  crearBackup() { return this.request('POST', '/backups'); },
  async descargarBackup(nombre) {
    const r = await fetch(`${this.baseURL}/backups/${encodeURIComponent(nombre)}`, {
      headers: { Authorization: `Bearer ${this.getToken()}` }
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'No se pudo descargar la copia');
    return r.blob();
  },

  // ===== Menú público (sin autenticación) =====

  getMenuPublico() { return this.request('GET', '/publico/menu'); }
};

// ===== Utilidades =====
function fmtMoneda(valor) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0
  }).format(valor || 0);
}

// Interpreta las fechas del servidor. SQLite guarda "AAAA-MM-DD HH:MM:SS" en UTC sin
// indicarlo: sin la "Z", el navegador las tomaba como hora local (3 hs de diferencia).
// Una fecha sola "AAAA-MM-DD" es un día local (si se tomara como UTC mostraría el día anterior).
function parseFecha(fecha) {
  if (fecha instanceof Date) return fecha;
  const s = String(fecha);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T00:00:00');
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) return new Date(s.replace(' ', 'T') + 'Z');
  return new Date(s);
}

// Fecha local de hoy (AAAA-MM-DD). toISOString() da la fecha UTC: después de las 21 hs era "mañana".
function hoyLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtFecha(fecha) {
  if (!fecha) return '-';
  return parseFecha(fecha).toLocaleDateString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  });
}

function fmtFechaHora(fecha) {
  if (!fecha) return '-';
  return parseFecha(fecha).toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// Argumento seguro para handlers inline: onclick="fn(${jsArg(valor)})"
// JSON.stringify genera un literal JS válido y esc() lo protege dentro del atributo HTML.
function jsArg(valor) {
  return esc(JSON.stringify(valor === null || valor === undefined ? '' : valor));
}

function fmtEstado(estado) {
  const map = {
    'abierto': '<span class="badge badge-blue">Abierto</span>',
    'pagado': '<span class="badge badge-green">Pagado</span>',
    'cancelado': '<span class="badge badge-red">Cancelado</span>',
    'pendiente': '<span class="badge badge-orange">Pendiente</span>',
    'libre': '<span class="badge badge-green">Libre</span>',
    'ocupada': '<span class="badge badge-red">Ocupada</span>',
    'reservada': '<span class="badge badge-orange">Reservada</span>',
    'cerrado': '<span class="badge badge-gray">Cerrado</span>',
    'confirmada': '<span class="badge badge-green">Confirmada</span>',
    'llego': '<span class="badge badge-blue">Llegó</span>',
    'cancelada': '<span class="badge badge-red">Cancelada</span>'
  };
  return map[estado] || `<span class="badge badge-gray">${esc(estado)}</span>`;
}
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

  async request(method, url, data = null, pin = null) {
    const headers = {};
    if (pin) headers['X-Autorizacion-Pin'] = pin;
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
      // Acción que necesita la autorización de un encargado: se pide el PIN y se reintenta
      if (result.requiere_pin && response.status === 403) {
        const nuevoPin = await pedirPinAutorizacion(result.error);
        if (nuevoPin) return this.request(method, url, data, nuevoPin);
        throw new Error('Acción cancelada: falta la autorización');
      }
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
  getRoles() { return this.request('GET', '/roles'); },

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
  cambiarEstadoMesa(id, estado) { return this.request('PUT', `/mesas/${id}/estado`, { estado }); },
  deleteMesa(id) { return this.request('DELETE', `/mesas/${id}`); },
  // Pedidos y llamados desde el QR de la mesa
  getSolicitudesMesa() { return this.request('GET', '/mesas/solicitudes'); },
  confirmarSolicitudMesa(id, items) { return this.request('POST', `/mesas/solicitudes/${id}/confirmar`, items ? { items } : {}); },
  rechazarSolicitudMesa(id, motivo) { return this.request('POST', `/mesas/solicitudes/${id}/rechazar`, { motivo }); },
  atenderSolicitudMesa(id) { return this.request('POST', `/mesas/solicitudes/${id}/atender`); },
  getQrMesas(base) { return this.request('GET', `/mesas/qr?base=${encodeURIComponent(base)}`); },
  nuevoQrMesa(id) { return this.request('POST', `/mesas/${id}/qr`); },

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
  cobrarEnMesa(id, data) { return this.request('POST', `/pedidos/${id}/cobro`, data); },
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

  // Contabilidad
  getContabilidadOpciones() { return this.request('GET', '/contabilidad/opciones'); },
  getGastos(filtros = {}) {
    const qs = new URLSearchParams(Object.entries(filtros).filter(([, v]) => v !== '' && v !== null && v !== undefined)).toString();
    return this.request('GET', `/contabilidad/gastos${qs ? '?' + qs : ''}`);
  },
  createGasto(data) { return this.request('POST', '/contabilidad/gastos', data); },
  updateGasto(id, data) { return this.request('PUT', `/contabilidad/gastos/${id}`, data); },
  pagarGasto(id, data) { return this.request('POST', `/contabilidad/gastos/${id}/pagar`, data); },
  anularGasto(id) { return this.request('DELETE', `/contabilidad/gastos/${id}`); },
  getCuentasPagar() { return this.request('GET', '/contabilidad/cuentas-pagar'); },
  getResultados(desde, hasta) { return this.request('GET', `/contabilidad/resultados?desde=${desde}&hasta=${hasta}`); },
  getIva(mes) { return this.request('GET', `/contabilidad/iva?mes=${mes}`); },
  getLibroDiario(desde, hasta) { return this.request('GET', `/contabilidad/libro-diario?desde=${desde}&hasta=${hasta}`); },
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
  emitirNotaCredito(data)           { return this.request('POST', '/integraciones/afip/nota-credito', data); },
  // Modo sin conexión: estado de internet y facturas en espera
  getConexion()                     { return this.request('GET', '/conexion'); },
  getFacturasPendientes()           { return this.request('GET', '/integraciones/afip/pendientes'); },
  reintentarFacturasPendientes()    { return this.request('POST', '/integraciones/afip/pendientes/reintentar'); },
  descartarFacturaPendiente(id)     { return this.request('POST', `/integraciones/afip/pendientes/${id}/descartar`); },
  // Personal: fichar, turnos, fichadas del equipo y propinas
  getMiFichaje()                    { return this.request('GET', '/personal/mi-fichaje'); },
  fichar()                          { return this.request('POST', '/personal/fichar'); },
  getMisTurnos()                    { return this.request('GET', '/personal/mis-turnos'); },
  getMisFichajes()                  { return this.request('GET', '/personal/mis-fichajes'); },
  getEmpleados()                    { return this.request('GET', '/personal/empleados'); },
  getFichajesEquipo(desde, hasta)   { return this.request('GET', `/personal/fichajes?desde=${desde}&hasta=${hasta}`); },
  cargarFichaje(data)               { return this.request('POST', '/personal/fichajes', data); },
  corregirFichaje(id, data)         { return this.request('PUT', `/personal/fichajes/${id}`, data); },
  getTurnos(desde, hasta)           { return this.request('GET', `/personal/turnos?desde=${desde}&hasta=${hasta}`); },
  guardarTurno(data, id)            { return id ? this.request('PUT', `/personal/turnos/${id}`, data) : this.request('POST', '/personal/turnos', data); },
  borrarTurno(id)                   { return this.request('DELETE', `/personal/turnos/${id}`); },
  copiarSemanaTurnos(desde)         { return this.request('POST', '/personal/turnos/copiar-semana', { desde }); },
  getPropinas(desde, hasta)         { return this.request('GET', `/personal/propinas?desde=${desde}&hasta=${hasta}`); },
  calcularReparto(data)             { return this.request('POST', '/personal/propinas/calcular', data); },
  guardarReparto(data)              { return this.request('POST', '/personal/propinas/repartos', data); },
  pagarReparto(id, medio)           { return this.request('POST', `/personal/propinas/repartos/${id}/pagar`, { medio }); },
  anularReparto(id)                 { return this.request('POST', `/personal/propinas/repartos/${id}/anular`); },
  enviarComprobanteWhatsApp(pedidoId, telefono) { return this.request('POST', `/whatsapp/comprobante/${pedidoId}`, { telefono }); },
  pruebaWhatsApp(telefono)          { return this.request('POST', '/whatsapp/prueba', { telefono }); },
  getMensajesWhatsApp()             { return this.request('GET',  '/whatsapp/mensajes'); },
  getReceta(productoId)             { return this.request('GET', `/productos/${productoId}/receta`); },
  guardarReceta(productoId, lineas) { return this.request('PUT', `/productos/${productoId}/receta`, { lineas }); },
  definirPin(password, pin)         { return this.request('PUT', '/auth/pin', { password, pin }); },
  consultarPadron(cuit)             { return this.request('GET',  `/integraciones/afip/padron/${encodeURIComponent(cuit)}`); },
  syncProductosTiendaNube()         { return this.request('POST', '/integraciones/tiendanube/sync-productos'); },
  crearLinkMercadoPago(pedidoId)    { return this.request('POST', `/integraciones/mercadopago/link/${pedidoId}`); },

  // ===== Impresoras térmicas =====
  getImpresoras()                  { return this.request('GET', '/impresoras'); },
  getImpresorasSistema()           { return this.request('GET', '/impresoras/sistema'); },
  crearImpresora(data)             { return this.request('POST', '/impresoras', data); },
  actualizarImpresora(id, data)    { return this.request('PUT', `/impresoras/${id}`, data); },
  eliminarImpresora(id)            { return this.request('DELETE', `/impresoras/${id}`); },
  probarImpresora(id)              { return this.request('POST', `/impresoras/${id}/prueba`); },
  getOpcionesImpresion()           { return this.request('GET', '/impresion/config'); },
  guardarOpcionesImpresion(data)   { return this.request('PUT', '/impresion/config', data); },
  imprimirComanda(pedidoId)        { return this.request('POST', `/pedidos/${pedidoId}/imprimir/comanda`); },
  imprimirTicket(pedidoId)         { return this.request('POST', `/pedidos/${pedidoId}/imprimir/ticket`); },

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
// Fecha de hoy en la zona horaria del negocio (la manda el servidor con la sesión). Con la del dispositivo,
// un celular o un navegador en otra zona pedía los pedidos "de mañana" después de las 21 h y la lista salía vacía.
// Cuadro para el PIN del encargado, encima de lo que esté abierto (no cierra el formulario de la acción).
// Devuelve el PIN o null si se cancela.
function pedirPinAutorizacion(mensaje) {
  return new Promise(resolver => {
    const capa = document.createElement('div');
    capa.className = 'modal-overlay pin-overlay';
    capa.innerHTML = `
      <div class="modal pin-modal" role="dialog" aria-label="Autorización">
        <div class="modal-header"><h3><i class="fas fa-user-shield"></i> Autorización</h3></div>
        <form>
          <p>${esc(mensaje || 'Esta acción necesita el PIN de un encargado')}</p>
          <div class="form-group">
            <input type="password" inputmode="numeric" autocomplete="off" maxlength="6" class="pin-input"
              id="pinAutorizacion" placeholder="PIN del encargado" required pattern="[0-9]{4,6}">
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline" data-cancelar>Cancelar</button>
            <button type="submit" class="btn btn-primary"><i class="fas fa-check"></i> Autorizar</button>
          </div>
        </form>
      </div>`;
    const terminar = valor => { capa.remove(); resolver(valor); };
    capa.querySelector('form').addEventListener('submit', e => { e.preventDefault(); terminar(capa.querySelector('input').value); });
    capa.querySelector('[data-cancelar]').addEventListener('click', () => terminar(null));
    document.body.appendChild(capa);
    capa.querySelector('input').focus();
  });
}

function hoyLocal() {
  const zona = typeof App !== 'undefined' && App.usuario && App.usuario.zona_horaria;
  if (zona) {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: zona }).format(new Date()); } catch (e) {}
  }
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

// Imagen QR generada por el propio sistema (funciona sin internet)
function urlQr(texto) {
  return '/api/publico/qr.svg?d=' + encodeURIComponent(texto);
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
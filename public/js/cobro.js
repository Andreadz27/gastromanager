// =============================================
// GASTROMANAGER - Cobro en la mesa
// Cobrar, dividir la cuenta, propina y factura AFIP/ARCA en un solo paso,
// desde la caja o desde el celular del mozo
// =============================================

const Cobro = {
  p: null,
  partes: 1,
  propina: null,      // null = no se cambia la propina del pedido
  pagos: [],
  afipActiva: false,

  METODOS: { efectivo: 'Efectivo', tarjeta: 'Tarjeta', mercadopago: 'Mercado Pago', transferencia: 'Transferencia', otro: 'Otro' },

  // Puede cobrar: cajero/encargado/admin, o el mozo en sus mesas si está activado en Configuración
  puedeCobrar(p) {
    if (App.puede('pedidos.cobrar')) return true;
    return !!(App.config && Number(App.config.mozo_cobra_mesa) === 1 && App.puede('pedidos.tomar')
      && p && p.tipo === 'salon' && p.mesa_id);
  },

  // partes: al dividir la cuenta, cuántas personas faltan pagar (se mantiene entre un pago y el siguiente)
  async abrir(pedidoId, partes = 1) {
    try {
      const [p, estado] = await Promise.all([
        API.getPedido(pedidoId),
        API.getIntegracionesEstado().catch(() => ({}))
      ]);
      if (p.estado !== 'abierto') return App.showToast('El pedido ya fue cobrado o cancelado', 'warning');
      this.p = p;
      this.afipActiva = estado.afip === 'conectada';
      this.waActiva = estado.whatsapp === 'conectada';
      Integraciones._padron = null;
      this.partes = Math.max(1, partes);
      this.propina = null;
      this.pagos = [{ metodo: 'efectivo', monto: this.montoParte(), recibido: '' }];
      this.paint();
    } catch (err) { App.showToast(err.message, 'error'); }
  },

  r2: n => Math.round((Number(n) || 0) * 100) / 100,

  // Saldo contando la propina elegida en esta pantalla
  saldo() {
    const p = this.p;
    const propinaActual = Number(p.propina) || 0;
    const propina = this.propina === null ? propinaActual : this.propina;
    return this.r2(Math.max(0, (Number(p.saldo) || 0) - propinaActual + propina));
  },

  aCobrar() { return this.r2(this.pagos.reduce((s, x) => s + (Number(x.monto) || 0), 0)); },
  completaElTotal() { return this.aCobrar() >= this.saldo() - 0.009; },

  // Base para el % de propina: lo consumido, sin la propina
  baseConsumo() { return Math.max(0, (Number(this.p.total) || 0) - (Number(this.p.propina) || 0)); },

  paint() {
    const p = this.p;
    const saldo = this.saldo();
    const pagado = Number(p.pagado) || 0;
    const base = this.baseConsumo();
    const propinaSel = this.propina === null ? (Number(p.propina) || 0) : this.propina;
    const btnPropina = (pct) => {
      const monto = Math.round(base * pct / 100);
      return `<button type="button" class="btn btn-sm ${propinaSel === monto ? 'btn-primary' : 'btn-outline'}"
        onclick="Cobro.setPropina(${monto})">${pct ? pct + '% (' + fmtMoneda(monto) + ')' : 'Sin propina'}</button>`;
    };
    const filas = this.pagos.map((x, i) => `
      <div class="cobro-pago">
        <select onchange="Cobro.setPago(${i}, 'metodo', this.value)">
          ${Object.entries(this.METODOS).map(([v, t]) => `<option value="${v}" ${x.metodo === v ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
        <input type="number" min="0" step="0.01" value="${x.monto}" aria-label="Monto"
          oninput="Cobro.setPago(${i}, 'monto', this.value)">
        ${x.metodo === 'efectivo' ? `<input type="number" min="0" step="0.01" value="${x.recibido}" placeholder="Recibido"
          aria-label="Efectivo recibido" oninput="Cobro.setPago(${i}, 'recibido', this.value)">` : '<span></span>'}
        ${this.pagos.length > 1 ? `<button type="button" class="btn btn-sm btn-outline" onclick="Cobro.quitarPago(${i})" aria-label="Quitar"><i class="fas fa-times"></i></button>` : '<span></span>'}
      </div>`).join('');

    const html = `
      <div class="cobro-totales">
        <div><span>Total</span><strong>${fmtMoneda(this.r2((Number(p.total) || 0) - (Number(p.propina) || 0) + propinaSel))}</strong></div>
        ${pagado > 0 ? `<div><span>Ya cobrado</span><strong>${fmtMoneda(pagado)}</strong></div>` : ''}
        <div class="cobro-saldo"><span>Falta cobrar</span><strong>${fmtMoneda(saldo)}</strong></div>
      </div>

      <div class="form-group">
        <label><i class="fas fa-hand-holding-usd"></i> Propina</label>
        <div class="cobro-chips">${btnPropina(0)}${btnPropina(10)}${btnPropina(15)}
          <input type="number" min="0" step="1" placeholder="Otro $" aria-label="Otra propina"
            value="${propinaSel && ![0, 10, 15].some(x => Math.round(base * x / 100) === propinaSel) ? propinaSel : ''}"
            onchange="Cobro.setPropina(this.value)">
        </div>
      </div>

      <div class="form-group">
        <label><i class="fas fa-users"></i> Dividir la cuenta</label>
        <div class="cobro-chips">
          <button type="button" class="btn btn-sm btn-outline" onclick="Cobro.setPartes(${this.partes - 1})" aria-label="Menos personas">−</button>
          <strong class="cobro-partes">${this.partes === 1 ? 'Paga uno' : this.partes + ' personas'}</strong>
          <button type="button" class="btn btn-sm btn-outline" onclick="Cobro.setPartes(${this.partes + 1})" aria-label="Más personas">+</button>
          ${this.partes > 1 ? `<span class="text-muted">${fmtMoneda(this.montoParte())} c/u</span>` : ''}
        </div>
      </div>

      <div class="form-group">
        <label><i class="fas fa-credit-card"></i> ${this.partes > 1 ? 'Paga esta persona' : 'Pago'}</label>
        ${filas}
        <button type="button" class="btn btn-sm btn-outline mt-10" onclick="Cobro.agregarPago()">
          <i class="fas fa-plus"></i> Otro medio de pago</button>
      </div>

      <div id="cobroFactura">${this.htmlFactura()}</div>
      <p class="cobro-resumen" id="cobroResumen">${this.textoResumen()}</p>

      <div class="modal-footer">
        <button type="button" class="btn btn-outline" onclick="App.closeModal()">Cancelar</button>
        <button type="button" class="btn btn-outline" onclick="Cobro.qrMercadoPago()"><i class="fas fa-qrcode"></i> QR Mercado Pago</button>
        <button type="button" class="btn btn-success" id="cobroBtn" onclick="Cobro.confirmar()"><i class="fas fa-check"></i> Cobrar ${fmtMoneda(this.aCobrar())}</button>
      </div>`;
    // Con el modal abierto se reemplaza solo el contenido: así no se repite la animación en cada toque
    const cuerpo = document.getElementById('cobroCuerpo');
    if (cuerpo && cuerpo.dataset.pedido === String(p.id)) { cuerpo.innerHTML = html; return; }
    App.showModal(`<div id="cobroCuerpo" data-pedido="${p.id}">${html}</div>`,
      { title: `Cobrar ${p.mesa_nombre ? p.mesa_nombre : 'pedido ' + p.numero_pedido}` });
  },

  htmlFactura() {
    if (!this.afipActiva) return '';
    if (!this.completaElTotal())
      return '<p class="text-muted"><i class="fas fa-file-invoice"></i> La factura ARCA se emite al cobrar el último pago.</p>';
    return `
      <div class="form-group cobro-factura">
        <label class="cobro-check"><input type="checkbox" id="cobroFacturar" checked onchange="Cobro.toggleCuit()"> Emitir factura electrónica ARCA</label>
        <div class="cobro-chips">
          <select id="cobroTipoCbte" onchange="Cobro.toggleCuit()">
            <option value="6">Factura B (consumidor final)</option>
            <option value="1">Factura A (con CUIT)</option>
            <option value="11">Factura C (monotributo)</option>
          </select>
          <input type="text" id="cobroCuit" placeholder="CUIT del cliente" maxlength="13" style="display:none"
            onchange="Integraciones.buscarCuit('cobroCuit', 'cobroPadronInfo')">
        </div>
        <div id="cobroPadronInfo" class="mt-10"></div>
      </div>`;
  },

  toggleCuit() {
    const tipo = document.getElementById('cobroTipoCbte');
    const cuit = document.getElementById('cobroCuit');
    const activo = document.getElementById('cobroFacturar');
    if (tipo && cuit) cuit.style.display = activo.checked && tipo.value === '1' ? '' : 'none';
    const info = document.getElementById('cobroPadronInfo');
    if (info && cuit && cuit.style.display === 'none') info.innerHTML = '';
  },

  textoResumen() {
    const resto = this.r2(this.saldo() - this.aCobrar());
    const vuelto = this.r2(this.pagos.reduce((s, x) =>
      s + (x.metodo === 'efectivo' && Number(x.recibido) > Number(x.monto) ? Number(x.recibido) - Number(x.monto) : 0), 0));
    if (resto < -0.009) return `<span class="text-danger">Se está cobrando ${fmtMoneda(-resto)} de más</span>`;
    return [
      resto > 0.009 ? `Después de este pago faltan <strong>${fmtMoneda(resto)}</strong>; la mesa sigue abierta.` : 'Con este pago se cierra la cuenta.',
      vuelto > 0 ? `Vuelto: <strong>${fmtMoneda(vuelto)}</strong>` : ''
    ].filter(Boolean).join(' ');
  },

  // Actualiza resumen, factura y botón sin redibujar los campos (no se pierde el foco al tipear)
  refrescar() {
    const r = document.getElementById('cobroResumen');
    if (r) r.innerHTML = this.textoResumen();
    const f = document.getElementById('cobroFactura');
    const tieneFactura = !!document.getElementById('cobroFacturar');
    if (f && tieneFactura !== (this.afipActiva && this.completaElTotal())) f.innerHTML = this.htmlFactura();
    const b = document.getElementById('cobroBtn');
    if (b) b.innerHTML = `<i class="fas fa-check"></i> Cobrar ${fmtMoneda(this.aCobrar())}`;
  },

  montoParte() {
    // Se redondea para arriba; la última persona paga lo que quede (absorbe el redondeo)
    return this.partes > 1 ? Math.min(this.saldo(), Math.ceil(this.saldo() / this.partes)) : this.saldo();
  },

  setPartes(n) {
    this.partes = Math.max(1, Math.min(30, n));
    this.pagos = [{ metodo: this.pagos[0].metodo, monto: this.montoParte(), recibido: '' }];
    this.paint();
  },

  setPropina(monto) {
    this.propina = Math.max(0, Math.round(Number(monto) || 0));
    this.pagos = [{ metodo: this.pagos[0].metodo, monto: this.montoParte(), recibido: '' }];
    this.paint();
  },

  setPago(i, campo, valor) {
    this.pagos[i][campo] = valor;
    if (campo === 'metodo') return this.paint();
    this.refrescar();
  },

  agregarPago() {
    const resto = this.r2(Math.max(0, this.saldo() - this.aCobrar()));
    this.pagos.push({ metodo: 'tarjeta', monto: resto, recibido: '' });
    this.paint();
  },

  quitarPago(i) {
    this.pagos.splice(i, 1);
    this.paint();
  },

  async confirmar() {
    const pagos = this.pagos
      .map(x => ({ metodo: x.metodo, monto: this.r2(x.monto), ...(x.metodo === 'efectivo' && x.recibido !== '' ? { recibido: Number(x.recibido) } : {}) }))
      .filter(x => x.monto > 0);
    if (!pagos.length) return App.showToast('Ingresá el monto a cobrar', 'warning');
    if (this.aCobrar() > this.saldo() + 0.009) return App.showToast('El monto supera lo que falta cobrar', 'warning');

    const body = { pagos };
    if (this.propina !== null && this.propina !== (Number(this.p.propina) || 0)) body.propina = this.propina;
    const facturar = document.getElementById('cobroFacturar');
    if (facturar && facturar.checked) {
      const tipo = Number(document.getElementById('cobroTipoCbte').value);
      const cuit = (document.getElementById('cobroCuit').value || '').replace(/\D/g, '');
      if (tipo === 1 && cuit.length !== 11) return App.showToast('Ingresá el CUIT del cliente (11 dígitos) para la Factura A', 'warning');
      body.factura = { tipo_comprobante: tipo, ...(tipo === 1 ? { cuit_receptor: cuit, ...Integraciones.datosReceptor(cuit) } : {}) };
    }

    const btn = document.getElementById('cobroBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cobrando...'; }
    try {
      const r = await API.cobrarEnMesa(this.p.id, body);
      this.mostrarResultado(r);
    } catch (err) {
      if (btn) { btn.disabled = false; btn.innerHTML = `<i class="fas fa-check"></i> Cobrar ${fmtMoneda(this.aCobrar())}`; }
      App.showToast(err.message, 'error');
    }
  },

  async mostrarResultado(r) {
    const id = this.p.id;
    const f = r.factura;
    const p = await API.getPedido(id).catch(() => this.p);
    this.p = p;
    Pedidos.ultimoPedido = p;
    App.showModal(`
      <div class="cobro-ok">
        <i class="fas fa-check-circle"></i>
        <h3>Cobrado ${fmtMoneda(r.cobrado)}</h3>
        ${r.vuelto > 0 ? `<p class="cobro-vuelto">Vuelto: <strong>${fmtMoneda(r.vuelto)}</strong></p>` : ''}
        ${r.cerrado ? '<p>Cuenta cerrada y mesa liberada.</p>' : `<p>Falta cobrar <strong>${fmtMoneda(r.saldo)}</strong>.</p>`}
        ${f && f.ok ? `<p class="text-success"><i class="fas fa-file-invoice"></i> ${esc(f.tipo_nombre)}
            ${String(f.punto_venta).padStart(4, '0')}-${String(f.numero_comprobante).padStart(8, '0')} &mdash; CAE ${esc(f.cae)}</p>` : ''}
        ${f && f.pendiente ? `<p class="text-warning"><i class="fas fa-clock"></i> ${esc(f.mensaje)}</p>` : ''}
        ${f && !f.ok && !f.pendiente ? `<p class="text-danger"><i class="fas fa-exclamation-triangle"></i> La factura no se emitió: ${esc(f.error)}.
            El cobro quedó registrado; podés reintentarla desde el pedido.</p>` : ''}
      </div>
      <div class="modal-footer">
        ${r.cerrado ? '' : `<button class="btn btn-success" onclick="Cobro.abrir(${id}, ${Math.max(1, this.partes - 1)})"><i class="fas fa-user-plus"></i> Cobrar al siguiente</button>`}
        ${f && !f.ok && !f.pendiente ? `<button class="btn btn-primary" onclick="Integraciones.abrirModalFacturar(${id}, ${Number(p.total) || 0})"><i class="fas fa-redo"></i> Reintentar factura</button>` : ''}
        ${r.cerrado ? `<button class="btn btn-outline" onclick="Cobro.whatsapp()"><i class="fab fa-whatsapp"></i> Enviar por WhatsApp</button>
          <button class="btn btn-outline" onclick="Pedidos.imprimirTicket(${id})"><i class="fas fa-print"></i> Ticket</button>` : ''}
        <button class="btn btn-outline" onclick="App.closeModal()">Listo</button>
      </div>
    `, { title: r.cerrado ? 'Cobro completo' : 'Pago parcial registrado' });
  },

  // Comprobante por WhatsApp. Con WhatsApp Business conectado lo manda el sistema al teléfono del cliente;
  // si no, se abre WhatsApp en el dispositivo con el texto listo.
  async compartir(pedidoId) {
    try {
      const [p, estado] = await Promise.all([API.getPedido(pedidoId), API.getIntegracionesEstado().catch(() => ({}))]);
      this.p = p;
      this.waActiva = estado.whatsapp === 'conectada';
      this.whatsapp();
    } catch (err) { App.showToast(err.message, 'error'); }
  },

  whatsapp() {
    if (this.waActiva) return this.pedirTelefono();
    this.whatsappManual();
  },

  pedirTelefono() {
    const p = this.p;
    const tel = (p.entrega && p.entrega.telefono) || '';
    App.showModal(`
      <form onsubmit="Cobro.enviarWhatsApp(event)">
        <div class="form-group">
          <label><i class="fab fa-whatsapp"></i> Celular del cliente</label>
          <input type="tel" id="waTelCliente" value="${esc(tel)}" placeholder="11 1234-5678" required autofocus>
          <small class="form-hint">Con característica, sin 0 ni 15 (también se aceptan).</small>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline" onclick="Cobro.whatsappManual()">Abrir WhatsApp acá</button>
          <button type="submit" class="btn btn-success" id="waEnviarBtn"><i class="fas fa-paper-plane"></i> Enviar comprobante</button>
        </div>
      </form>
    `, { title: `Comprobante ${p.numero_pedido}` });
  },

  async enviarWhatsApp(e) {
    e.preventDefault();
    const btn = document.getElementById('waEnviarBtn');
    btn.disabled = true;
    try {
      const r = await API.enviarComprobanteWhatsApp(this.p.id, document.getElementById('waTelCliente').value);
      App.closeModal();
      App.showToast(`Comprobante enviado por WhatsApp a +${r.telefono}`, 'success');
    } catch (err) {
      btn.disabled = false;
      App.showToast(err.message, 'error', 8000);
    }
  },

  whatsappManual() {
    const p = this.p;
    const negocio = (App.config && App.config.nombre_negocio) || '';
    const c = (p.comprobantes || [])[0];
    const lineas = [
      negocio ? `*${negocio}*` : '',
      `Pedido ${p.numero_pedido}${p.mesa_nombre ? ' - ' + p.mesa_nombre : ''}`,
      ...p.items.map(i => `${i.cantidad} x ${i.nombre_producto}: ${fmtMoneda(i.subtotal)}`),
      p.descuento ? `Descuento: -${fmtMoneda(p.descuento)}` : '',
      p.propina ? `Propina: ${fmtMoneda(p.propina)}` : '',
      `*Total: ${fmtMoneda(p.total)}*`,
      ...p.pagos.map(x => `Pago ${this.METODOS[x.metodo] || x.metodo}: ${fmtMoneda(x.monto)}`),
      c ? `${c.tipo_comprobante_nombre} ${String(c.punto_venta).padStart(4, '0')}-${String(c.numero_comprobante).padStart(8, '0')} - CAE ${c.cae}` : '',
      '¡Gracias por tu visita!'
    ].filter(Boolean);
    window.open('https://wa.me/?text=' + encodeURIComponent(lineas.join('\n')), '_blank', 'noopener');
  },

  // QR en pantalla: el cliente lo escanea con su celular y paga; el pedido se cierra solo al aprobarse
  async qrMercadoPago() {
    try {
      const r = await API.crearLinkMercadoPago(this.p.id);
      this._link = r.link;
      const img = urlQr(r.link);
      App.showModal(`
        <div class="cobro-ok">
          <p>Que el cliente escanee el código con la cámara o la app de Mercado Pago.</p>
          <img src="${img}" alt="QR de pago" width="260" height="260" class="cobro-qr">
          <h3>${fmtMoneda(r.monto)}</h3>
          <p class="text-muted">${r.notificaciones
            ? 'Cuando el pago se apruebe, la cuenta se cierra sola.'
            : 'Sin BASE_URL pública HTTPS, al aprobarse el pago hay que registrarlo a mano.'}</p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" onclick="Cobro.abrir(${this.p.id})"><i class="fas fa-arrow-left"></i> Volver</button>
          <button class="btn btn-outline" onclick="window.open(Cobro._link, '_blank', 'noopener')"><i class="fas fa-external-link-alt"></i> Abrir link</button>
        </div>
      `, { title: 'Pagar con Mercado Pago' });
    } catch (err) { App.showToast(err.message, 'error'); }
  }
};

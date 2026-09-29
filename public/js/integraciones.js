// =============================================
// GASTROMANAGER - Integraciones
// Mercado Pago, Delivery (PedidosYa/Rappi/iFood/UberEats),
// AFIP Factura Electrónica, Tienda Nube
// =============================================

const Integraciones = {

  async render() {
    const view = document.getElementById('view-integraciones');
    view.innerHTML = '<div class="text-center mt-20"><i class="fas fa-spinner fa-spin fa-3x"></i></div>';
    try {
      const [cfg, estado] = await Promise.all([
        API.getIntegracionesConfig(),
        API.getIntegracionesEstado()
      ]);
      this.cfg    = cfg    || {};
      this.estado = estado || {};
      this._paint(view);
    } catch (err) {
      view.innerHTML = `<div class="empty-state"><i class="fas fa-plug"></i><p>Error: ${esc(err.message)}</p></div>`;
    }
  },

  _badgeEstado(estado) {
    const map = {
      'conectada':      '<span class="badge badge-green"><i class="fas fa-check-circle"></i> Conectada</span>',
      'configurada':    '<span class="badge badge-blue"><i class="fas fa-cog"></i> Configurada</span>',
      'error':          '<span class="badge badge-red"><i class="fas fa-times-circle"></i> Error</span>',
      'no_configurada': '<span class="badge badge-gray">Sin configurar</span>'
    };
    return map[estado] || '<span class="badge badge-gray">Sin configurar</span>';
  },

  _setWebhookUrls() {
    const base = window.location.origin;
    const mpEl = document.getElementById('mpWebhookUrl');
    const tnEl = document.getElementById('tnWebhookUrl');
    if (mpEl) mpEl.textContent = `${base}/api/mp/notificacion`;
    if (tnEl) tnEl.textContent = `${base}/api/tiendanube/webhook`;
  },

  async _cargarDeliveryPlataformas() {
    const cont = document.getElementById('deliveryPlataformasLista');
    if (!cont) return;
    try {
      const plats = await API.getPlataformasDelivery();
      if (!plats || plats.length === 0) {
        cont.innerHTML = '<p class="text-muted">No hay plataformas configuradas. Creá una desde la sección Delivery.</p>';
        return;
      }
      cont.innerHTML = plats.map(p => {
        let cfg = {}; try { cfg = JSON.parse(p.config || '{}'); } catch (e) {}
        const estadoBadge = cfg.modo === 'api'
          ? (cfg.estado === 'conectada'
              ? '<span class="badge badge-green">Conectada</span>'
              : '<span class="badge badge-blue">Configurada</span>')
          : '<span class="badge badge-gray">Manual</span>';
        return `<div class="delivery-integracion-row">
          <span class="delivery-plataforma-chip" style="--chip-color:${esc(p.color||'#6A0DAD')}">
            <i class="fas fa-${esc(p.icono||'motorcycle')}"></i> ${esc(p.nombre)}
          </span>
          ${estadoBadge}
          <span class="text-muted text-sm">Comisión: ${p.comision||0}%</span>
          <button class="btn btn-outline btn-sm" onclick="App.navigateTo('delivery');setTimeout(()=>Delivery.abrirIntegracion(${p.id}),400);">
            <i class="fas fa-cog"></i> Configurar
          </button>
        </div>`;
      }).join('');
    } catch (e) {
      cont.innerHTML = '<p class="text-muted">No se pudieron cargar las plataformas.</p>';
    }
  },

  _paint(view) {
    const mp   = this.cfg.mercadopago || {};
    const afip = this.cfg.afip        || {};
    const tn   = this.cfg.tiendanube  || {};
    const est  = this.estado;
    const mpHtml = `
      <div class="integracion-card ${mp.activa ? 'activa' : ''}">
        <div class="integracion-header">
          <div class="integracion-logo mp-logo"><i class="fas fa-credit-card"></i></div>
          <div class="integracion-info">
            <div class="integracion-nombre">Mercado Pago</div>
            <div class="integracion-desc">Cobros online con tarjeta, QR y transferencia en el checkout de pedidos web</div>
          </div>
          <div class="integracion-estado">${this._badgeEstado(est.mercadopago)}</div>
        </div>
        <div class="integracion-body">
          <form onsubmit="Integraciones.guardarMP(event)">
            <div class="grid grid-2">
              <div class="form-group">
                <label>Access Token (producción)</label>
                <input type="password" id="mpAccessToken" value="${esc(mp.access_token||'')}" placeholder="APP_USR-..." autocomplete="off">
                <small class="form-hint">MP Developers → Credenciales de producción</small>
              </div>
              <div class="form-group">
                <label>Access Token (sandbox)</label>
                <input type="password" id="mpAccessTokenTest" value="${esc(mp.access_token_test||'')}" placeholder="TEST-..." autocomplete="off">
                <small class="form-hint">Para pruebas sin dinero real</small>
              </div>
            </div>
            <div class="grid grid-2">
              <div class="form-group"><label>Modo</label>
                <select id="mpModo">
                  <option value="sandbox"    ${(!mp.modo||mp.modo==='sandbox')  ?'selected':''}>Sandbox (pruebas)</option>
                  <option value="produccion" ${mp.modo==='produccion'           ?'selected':''}>Producción</option>
                </select>
              </div>
              <div class="form-group"><label>Estado</label>
                <select id="mpActiva">
                  <option value="0" ${!mp.activa?'selected':''}>Desactivada</option>
                  <option value="1" ${mp.activa ?'selected':''}>Activa</option>
                </select>
              </div>
            </div>
            <div class="card-info mt-10"><i class="fas fa-info-circle"></i>
              <div><strong>URL de notificación IPN:</strong>
                <span class="code-inline" id="mpWebhookUrl">—</span>
                <button type="button" class="btn btn-outline btn-xs ml-5" onclick="Integraciones.copiar('mpWebhookUrl')"><i class="fas fa-copy"></i></button><br>
                <small>Pegá esta URL en MP Developers → Tu app → Notificaciones IPN.</small>
              </div>
            </div>
            <div class="integracion-actions">
              <button type="button" class="btn btn-outline" onclick="Integraciones.testMP()"><i class="fas fa-plug"></i> Probar</button>
              <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Guardar</button>
            </div>
          </form>
        </div>
      </div>`;
    const deliveryHtml = `
      <div class="integracion-card ${est.delivery_activas>0?'activa':''}">
        <div class="integracion-header">
          <div class="integracion-logo delivery-logo"><i class="fas fa-motorcycle"></i></div>
          <div class="integracion-info">
            <div class="integracion-nombre">PedidosYa &middot; Rappi &middot; iFood &middot; Uber Eats</div>
            <div class="integracion-desc">Recibí pedidos automáticamente desde las apps de delivery vía webhook</div>
          </div>
          <div class="integracion-estado">
            ${est.delivery_activas>0
              ? `<span class="badge badge-green">${est.delivery_activas} activa${est.delivery_activas>1?'s':''}</span>`
              : '<span class="badge badge-gray">Sin configurar</span>'}
          </div>
        </div>
        <div class="integracion-body">
          <div id="deliveryPlataformasLista"><div class="text-center"><i class="fas fa-spinner fa-spin"></i></div></div>
          <button class="btn btn-outline mt-10" onclick="Integraciones.irADelivery()">
            <i class="fas fa-external-link-alt"></i> Configurar en Delivery
          </button>
          <div class="card-info mt-10"><i class="fas fa-info-circle"></i>
            <div>Cada plataforma tiene su propia URL de webhook. Activá el modo <em>Automático</em> en cada una
            y copiá la URL a tu partner. Los pedidos entran en tiempo real y aparecen en Cocina y Delivery.</div>
          </div>
        </div>
      </div>`;
    view.innerHTML = `
      <div class="page-header"><div>
        <h2><i class="fas fa-plug"></i> Integraciones</h2>
        <p>Conectá GastroManager con las plataformas más usadas del mercado</p>
      </div></div>
      ${mpHtml}${deliveryHtml}
      <div id="afipCard"></div>
      <div id="tnCard"></div>`;
    this._paintAFIP(afip, est);
    this._paintTN(tn, est);
    this._setWebhookUrls();
    this._cargarDeliveryPlataformas();
    if (est.afip==='conectada'||est.afip==='configurada') this._cargarComprobantes();
  },

  _paintAFIP(afip, est) {
    const el = document.getElementById('afipCard');
    if (!el) return;
    const extra = (est.afip === 'conectada' || est.afip === 'configurada')
      ? `<div class="mt-20"><div class="card-header"><span class="card-title"><i class="fas fa-list"></i> &Uacute;ltimos comprobantes</span></div><div id="listaComprobantes"><i class="fas fa-spinner fa-spin"></i></div></div>` : '';
    el.innerHTML = `
      <div class="integracion-card ${afip.activa ? 'activa' : ''}">
        <div class="integracion-header">
          <div class="integracion-logo afip-logo"><i class="fas fa-file-invoice"></i></div>
          <div class="integracion-info">
            <div class="integracion-nombre">AFIP &mdash; Factura Electr&oacute;nica (WSFE)</div>
            <div class="integracion-desc">Factur&aacute; A, B y C con CAE al cerrar pedidos. V&aacute;lido ante AFIP.</div>
          </div>
          <div class="integracion-estado">${this._badgeEstado(est.afip)}</div>
        </div>
        <div class="integracion-body">
          <form onsubmit="Integraciones.guardarAFIP(event)">
            <div class="grid grid-2">
              <div class="form-group"><label>CUIT del emisor</label>
                <input type="text" id="afipCuit" value="${esc(afip.cuit||'')}" placeholder="20-12345678-9" maxlength="13">
              </div>
              <div class="form-group"><label>Modo</label>
                <select id="afipModo">
                  <option value="homologacion" ${(!afip.modo||afip.modo==='homologacion')?'selected':''}>Homologaci&oacute;n (pruebas)</option>
                  <option value="produccion" ${afip.modo==='produccion'?'selected':''}>Producci&oacute;n</option>
                </select>
              </div>
            </div>
            <div class="form-group">
              <label>Access Token de AfipSDK <span style="font-weight:400;color:var(--text-muted)">(requerido)</span></label>
              <input type="password" id="afipAccessToken" value="${esc(afip.access_token||'')}" placeholder="Obten&eacute;lo gratis en app.afipsdk.com" autocomplete="off">
              <small class="form-hint">
                Registrate gratis en <a href="https://app.afipsdk.com" target="_blank" rel="noopener">app.afipsdk.com</a>
                y copi&aacute; tu token. En homologaci&oacute;n pod&eacute;s usar el CUIT <strong>20-40937847-2</strong> sin certificado propio.
              </small>
            </div>
            <div class="grid grid-2">
              <div class="form-group"><label>Certificado digital (.crt) <span style="font-weight:400;color:var(--text-muted)">(opcional &mdash; solo producci&oacute;n)</span></label>
                <textarea id="afipCert" rows="3" placeholder="Contenido del .crt emitido por AFIP&#10;(dejar vac&iacute;o para usar el cert compartido de AfipSDK)">${esc(afip.cert||'')}</textarea>
                <small class="form-hint"><a href="https://auth.afip.gob.ar" target="_blank" rel="noopener">Clave Fiscal &rarr; Rel. Servicios &rarr; wsfe</a></small>
              </div>
              <div class="form-group"><label>Clave privada (.key) <span style="font-weight:400;color:var(--text-muted)">(opcional)</span></label>
                <textarea id="afipKey" rows="3" placeholder="Clave privada .key&#10;(dejar vac&iacute;o si no ten&eacute;s certificado propio)" autocomplete="off">${esc(afip.key||'')}</textarea>
                <small class="form-hint">Se guarda encriptada. Solo necesaria en producci&oacute;n con cert propio.</small>
              </div>
            </div>
            <div class="grid grid-3">
              <div class="form-group"><label>Punto de venta</label>
                <input type="number" id="afipPtoVenta" value="${esc(afip.pto_venta||1)}" min="1" max="99999">
              </div>
              <div class="form-group"><label>IVA por defecto</label>
                <select id="afipIvaTipo">
                  <option value="5" ${!afip.iva_tipo||afip.iva_tipo==5?'selected':''}>21%</option>
                  <option value="4" ${afip.iva_tipo==4?'selected':''}>10.5%</option>
                  <option value="6" ${afip.iva_tipo==6?'selected':''}>27%</option>
                  <option value="3" ${afip.iva_tipo==3?'selected':''}>0% (exento)</option>
                </select>
              </div>
              <div class="form-group"><label>Activa</label>
                <select id="afipActiva">
                  <option value="0" ${!afip.activa?'selected':''}>No</option>
                  <option value="1" ${afip.activa?'selected':''}>S&iacute;</option>
                </select>
              </div>
            </div>
            <div class="integracion-actions">
              <button type="button" class="btn btn-outline" onclick="Integraciones.testAFIP()"><i class="fas fa-plug"></i> Probar con AFIP</button>
              <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Guardar</button>
            </div>
          </form>${extra}
        </div>
      </div>`;
  },



  _paintTN(tn, est) {
    const el = document.getElementById('tnCard');
    if (!el) return;
    el.innerHTML = `
      <div class="integracion-card ${tn.activa ? 'activa' : ''}">
        <div class="integracion-header">
          <div class="integracion-logo tn-logo"><i class="fas fa-store"></i></div>
          <div class="integracion-info">
            <div class="integracion-nombre">Tienda Nube</div>
            <div class="integracion-desc">Sincroniz&aacute; productos y recib&iacute; pedidos del ecommerce autom&aacute;ticamente</div>
          </div>
          <div class="integracion-estado">${this._badgeEstado(est.tiendanube)}</div>
        </div>
        <div class="integracion-body">
          <form onsubmit="Integraciones.guardarTN(event)">
            <div class="grid grid-2">
              <div class="form-group"><label>ID de tienda</label>
                <input type="text" id="tnStoreId" value="${esc(tn.store_id||'')}" placeholder="123456">
                <small class="form-hint">Tienda Nube &rarr; Mi cuenta &rarr; API</small>
              </div>
              <div class="form-group"><label>Access Token</label>
                <input type="password" id="tnToken" value="${esc(tn.access_token||'')}" placeholder="Token de Tienda Nube" autocomplete="off">
              </div>
            </div>
            <div class="grid grid-2">
              <div class="form-group"><label>Sincronizar productos</label>
                <select id="tnSyncProductos">
                  <option value="0" ${!tn.sync_productos?'selected':''}>No</option>
                  <option value="1" ${tn.sync_productos?'selected':''}>S&iacute; &mdash; precio y stock en tiempo real</option>
                </select>
              </div>
              <div class="form-group"><label>Estado</label>
                <select id="tnActiva">
                  <option value="0" ${!tn.activa?'selected':''}>Desactivada</option>
                  <option value="1" ${tn.activa?'selected':''}>Activa</option>
                </select>
              </div>
            </div>
            <div class="card-info mt-10"><i class="fas fa-info-circle"></i>
              <div><strong>Webhook de pedidos:</strong>
                <span class="code-inline" id="tnWebhookUrl">&mdash;</span>
                <button type="button" class="btn btn-outline btn-xs ml-5" onclick="Integraciones.copiar('tnWebhookUrl')"><i class="fas fa-copy"></i></button><br>
                <small>Tienda Nube &rarr; Ajustes &rarr; Notificaciones &rarr; Webhooks &rarr; evento <em>order/created</em>.</small>
              </div>
            </div>
            <div class="integracion-actions">
              <button type="button" class="btn btn-outline" onclick="Integraciones.syncProductosTN()"><i class="fas fa-sync"></i> Sincronizar productos</button>
              <button type="button" class="btn btn-outline" onclick="Integraciones.testTN()"><i class="fas fa-plug"></i> Probar</button>
              <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Guardar</button>
            </div>
          </form>
        </div>
      </div>`;
  },




  async _cargarComprobantes() {
    const cont = document.getElementById('listaComprobantes');
    if (!cont) return;
    try {
      const lista = await API.getComprobantesAFIP(5);
      if (!lista || lista.length === 0) {
        cont.innerHTML = '<p class="text-muted mt-10">Aún no se generaron comprobantes.</p>';
        return;
      }
      cont.innerHTML = `<div class="table-wrap"><table>
        <thead><tr><th>Tipo</th><th>N&uacute;mero</th><th>CAE</th><th>Fecha</th><th>Total</th><th>Pedido</th></tr></thead>
        <tbody>${lista.map(c => `<tr>
          <td>${esc(c.tipo_comprobante_nombre || c.tipo_comprobante)}</td>
          <td class="font-bold">${String(c.punto_venta||'').padStart(4,'0')}-${String(c.numero_comprobante||'').padStart(8,'0')}</td>
          <td><span class="code-inline">${esc(c.cae)}</span></td>
          <td>${fmtFecha(c.fecha_comprobante)}</td>
          <td class="font-bold">${fmtMoneda(c.total)}</td>
          <td><a href="#" onclick="App.navigateTo('pedidos');return false;">#${esc(c.pedido_id)}</a></td>
        </tr>`).join('')}</tbody>
      </table></div>`;
    } catch (e) {
      cont.innerHTML = '<p class="text-muted mt-10">No se pudieron cargar los comprobantes.</p>';
    }
  },

  // ──────── MERCADO PAGO ────────

  async guardarMP(e) {
    e.preventDefault();
    try {
      await API.saveIntegracionConfig('mercadopago', {
        access_token:      document.getElementById('mpAccessToken').value.trim(),
        access_token_test: document.getElementById('mpAccessTokenTest').value.trim(),
        modo:              document.getElementById('mpModo').value,
        activa:            document.getElementById('mpActiva').value === '1'
      });
      App.showToast('Mercado Pago guardado', 'success');
      this.render();
    } catch (err) { App.showToast(err.message, 'error'); }
  },

  async testMP() {
    try {
      App.showToast('Verificando conexión con Mercado Pago...', 'info');
      const r = await API.testIntegracion('mercadopago');
      App.showToast(r.ok ? `✓ ${r.message}` : `✗ ${r.message}`, r.ok ? 'success' : 'error');
    } catch (err) { App.showToast(err.message, 'error'); }
  },



  // ──────── AFIP ────────

  async guardarAFIP(e) {
    e.preventDefault();
    try {
      await API.saveIntegracionConfig('afip', {
        cuit:         document.getElementById('afipCuit').value.trim(),
        modo:         document.getElementById('afipModo').value,
        access_token: document.getElementById('afipAccessToken').value.trim(),
        cert:         document.getElementById('afipCert').value.trim(),
        key:          document.getElementById('afipKey').value.trim(),
        pto_venta:    parseInt(document.getElementById('afipPtoVenta').value) || 1,
        iva_tipo:     parseInt(document.getElementById('afipIvaTipo').value) || 5,
        activa:       document.getElementById('afipActiva').value === '1'
      });
      App.showToast('Configuración AFIP guardada', 'success');
      this.render();
    } catch (err) { App.showToast(err.message, 'error'); }
  },

  async testAFIP() {
    try {
      App.showToast('Conectando con AFIP...', 'info');
      const r = await API.testIntegracion('afip');
      App.showToast(r.ok ? `✓ ${r.message}` : `✗ ${r.message}`, r.ok ? 'success' : 'error');
    } catch (err) { App.showToast(err.message, 'error'); }
  },

  async facturar(pedidoId, tipoComprobante) {
    const data = { pedido_id: pedidoId, tipo_comprobante: tipoComprobante };
    if (tipoComprobante === 1) {
      data.cuit_receptor = (document.getElementById('afipCuitReceptor')?.value || '').replace(/\D/g, '');
      if (data.cuit_receptor.length !== 11) {
        App.showToast('Ingresá el CUIT del cliente (11 dígitos) para la Factura A', 'warning');
        return;
      }
    }
    try {
      App.showToast('Generando comprobante AFIP...', 'info');
      const r = await API.generarComprobante(data);
      App.showToast(`✓ ${r.tipo_nombre} emitida — CAE: ${r.cae}`, 'success');
      App.closeModal();
      if (typeof Pedidos !== 'undefined') Pedidos.render();
    } catch (err) { App.showToast(err.message, 'error'); }
  },

  // Códigos AFIP: 1 = Factura A, 6 = Factura B, 11 = Factura C
  abrirModalFacturar(pedidoId, total) {
    App.showModal(`
      <p>Seleccioná el tipo de comprobante para el pedido <strong>#${pedidoId}</strong>
        &mdash; Total: <strong>${fmtMoneda(total)}</strong></p>
      <div class="form-group mt-10">
        <label>CUIT del cliente (solo Factura A)</label>
        <input type="text" id="afipCuitReceptor" placeholder="20-12345678-9" maxlength="13">
      </div>
      <div class="grid grid-3 mt-20">
        <button class="btn btn-outline btn-lg" onclick="Integraciones.facturar(${pedidoId},1)">
          <i class="fas fa-file-invoice"></i><br>Factura A<br><small>Cliente Resp. Inscripto</small>
        </button>
        <button class="btn btn-outline btn-lg" onclick="Integraciones.facturar(${pedidoId},6)">
          <i class="fas fa-file-invoice"></i><br>Factura B<br><small>Consumidor Final</small>
        </button>
        <button class="btn btn-outline btn-lg" onclick="Integraciones.facturar(${pedidoId},11)">
          <i class="fas fa-file-invoice"></i><br>Factura C<br><small>Emisor Monotributista</small>
        </button>
      </div>
      <div class="modal-footer">
        <button class="btn btn-danger" onclick="App.closeModal()">Cancelar</button>
      </div>
    `, { title: 'Generar Comprobante AFIP' });
  },



  // ──────── TIENDA NUBE ────────

  async guardarTN(e) {
    e.preventDefault();
    try {
      await API.saveIntegracionConfig('tiendanube', {
        store_id:       document.getElementById('tnStoreId').value.trim(),
        access_token:   document.getElementById('tnToken').value.trim(),
        sync_productos: document.getElementById('tnSyncProductos').value === '1',
        activa:         document.getElementById('tnActiva').value === '1'
      });
      App.showToast('Tienda Nube guardada', 'success');
      this.render();
    } catch (err) { App.showToast(err.message, 'error'); }
  },

  async testTN() {
    try {
      App.showToast('Verificando conexión con Tienda Nube...', 'info');
      const r = await API.testIntegracion('tiendanube');
      App.showToast(r.ok ? `✓ ${r.message}` : `✗ ${r.message}`, r.ok ? 'success' : 'error');
    } catch (err) { App.showToast(err.message, 'error'); }
  },

  async syncProductosTN() {
    try {
      App.showToast('Sincronizando con Tienda Nube...', 'info');
      const r = await API.syncProductosTiendaNube();
      App.showToast(`${r.ok ? '✓' : '✗'} ${r.message} (${r.sincronizados || 0} productos)`, r.ok ? 'success' : 'error');
    } catch (err) { App.showToast(err.message, 'error'); }
  },

  irADelivery() {
    App.navigateTo('delivery');
    setTimeout(() => { if (typeof Delivery !== 'undefined') Delivery.abrirConfigPlataformas(); }, 400);
  },

  copiar(elId) {
    const el = document.getElementById(elId);
    if (!el) return;
    const txt = (el.textContent || el.value || '').trim();
    if (!txt || txt === '—') return;
    navigator.clipboard.writeText(txt).then(() => {
      App.showToast('Copiado al portapapeles', 'success');
    }).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = txt;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      App.showToast('Copiado', 'success');
    });
  }

};

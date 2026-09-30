// =============================================
// GASTROMANAGER - Configuración
// Datos del negocio y preferencias (solo admin)
// =============================================

const ConfigView = {
  config: null,

  async render() {
    const view = document.getElementById('view-config');
    view.innerHTML = '<div class="text-center mt-20"><i class="fas fa-spinner fa-spin fa-3x"></i></div>';
    try {
      const [config, promociones, plataformas, perfiles] = await Promise.all([API.getConfig(), API.getPromociones(), API.getPlataformasDelivery(), API.getPerfilesNegocio().catch(()=>({}))]);
      this.config = config;
      this.promociones = promociones || [];
      this.plataformas = plataformas || [];
      this.perfiles = perfiles || {};
      this.paint(view);
      this._cargarLinks();
    } catch (err) {
      view.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error: ${esc(err.message)}</p></div>`;
    }
  },

  paint(view) {
    const c = this.config || {};
    view.innerHTML = `
      <div class="page-header">
        <div>
          <h2><i class="fas fa-cog"></i> Configuración</h2>
          <p>Información del negocio y preferencias del sistema</p>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title"><i class="fas fa-store"></i> Tipo de negocio</span>
          <span class="card-subtitle">Define qué módulos están activos</span>
        </div>
        <div class="tipos-negocio-grid">
          ${Object.entries(this.perfiles || {}).map(([key, p]) => {
            const iconos = {
              restaurante_grande:  'fa-utensils',
              restaurante_mediano: 'fa-bowl-food',
              restaurante_chico:   'fa-hamburger',
              cafeteria:           'fa-mug-hot',
              panaderia:           'fa-bread-slice',
              heladeria:           'fa-ice-cream',
              kiosco:              'fa-store',
              personalizado:       'fa-sliders',
            };
            const activo = (this.config||{}).tipo_negocio === key ? 'activo' : '';
            const icono  = iconos[key] || 'fa-store';
            return `
              <div class="wizard-card ${activo}" onclick="ConfigView.seleccionarTipo('${key}')" data-perfil="${key}">
                <div class="wizard-card-icon"><i class="fas ${icono}"></i></div>
                <div class="wizard-card-label">${esc(p.label)}</div>
              </div>`;
          }).join('')}
        </div>
      </div>

      <div class="card">
        <form onsubmit="ConfigView.guardar(event)">
          <div class="form-group">
            <label>Nombre del negocio</label>
            <input type="text" id="cfgNombre" value="${esc(c.nombre_negocio || '')}" required>
          </div>
          <div class="grid grid-2">
            <div class="form-group">
              <label>Dirección</label>
              <input type="text" id="cfgDireccion" value="${esc(c.direccion || '')}">
            </div>
            <div class="form-group">
              <label>Teléfono</label>
              <input type="text" id="cfgTelefono" value="${esc(c.telefono || '')}">
            </div>
          </div>
          <div class="grid grid-2">
            <div class="form-group">
              <label>Email</label>
              <input type="email" id="cfgEmail" value="${esc(c.email || '')}">
            </div>
            <div class="form-group">
              <label>CUIT</label>
              <input type="text" id="cfgCuit" value="${esc(c.cuit || '')}">
            </div>
          </div>
          <div class="grid grid-3">
            <div class="form-group">
              <label>IVA (%)</label>
              <input type="number" id="cfgIva" min="0" max="100" value="${c.tasa_iva || 0}">
            </div>
            <div class="form-group">
              <label>Moneda</label>
              <select id="cfgMoneda">
                <option value="ARS" ${c.moneda === 'ARS' ? 'selected' : ''}>ARS - Peso argentino</option>
                <option value="USD" ${c.moneda === 'USD' ? 'selected' : ''}>USD - Dólar</option>
                <option value="EUR" ${c.moneda === 'EUR' ? 'selected' : ''}>EUR - Euro</option>
              </select>
            </div>
            <div class="form-group">
              <label>Impresión automática de comandas</label>
              <select id="cfgImpresion" title="Con impresoras térmicas configuradas, la comanda sale sola al crear el pedido. Sin impresoras, se abre la impresión del navegador.">

                <option value="1" ${c.activar_impresion ? 'selected' : ''}>Activada</option>
                <option value="0" ${!c.activar_impresion ? 'selected' : ''}>Desactivada</option>
              </select>
            </div>
          </div>
          <div class="modal-footer">
            <button type="submit" class="btn btn-success"><i class="fas fa-save"></i> Guardar cambios</button>
          </div>
        </form>
      </div>

      <div class="card mt-20">
        <div class="card-header">
          <span class="card-title"><i class="fas fa-motorcycle"></i> Plataformas de Delivery</span>
          <span class="card-subtitle">PedidosYa, Rappi, Uber Eats y otras</span>
        </div>
        <div class="delivery-plataformas-config">
          ${(this.plataformas || []).map(p => `
            <div class="delivery-plataforma-config-item">
              <span class="delivery-plataforma-dot" style="background:${esc(p.color || '#6A0DAD')}"></span>
              <span class="delivery-plataforma-config-nombre">${esc(p.nombre)}</span>
              <span class="delivery-plataforma-config-comision">${p.comision || 0}%</span>
              <button class="btn btn-outline btn-sm" onclick="Delivery.abrirIntegracion(${p.id})"><i class="fas fa-plug"></i> Integrar</button>
              <label class="switch">
                <input type="checkbox" ${p.activa ? 'checked' : ''} onchange="ConfigView.togglePlataforma(${p.id}, this.checked)">
                <span class="slider"></span>
              </label>
            </div>`).join('') || '<div class="empty-state small"><i class="fas fa-motorcycle"></i><p>Sin plataformas. Agregalas desde la vista Delivery.</p></div>'}
        </div>
        <div class="card-actions">
          <button class="btn btn-outline btn-sm" onclick="App.navigateTo('delivery')">
            <i class="fas fa-cog"></i> Administrar plataformas
          </button>
        </div>
      </div>

      <div class="card mt-20">
        <div class="card-header">
          <span class="card-title"><i class="fas fa-share-alt"></i> Links para compartir</span>
          <span class="card-subtitle">Compartí estos links por WhatsApp o Instagram para recibir pedidos</span>
        </div>
        <div class="links-compartir" id="linksCompartir">
          <div class="link-compartir-item">
            <div class="link-compartir-icon wa"><i class="fab fa-whatsapp"></i></div>
            <div class="link-compartir-info">
              <div class="link-compartir-label">Link para WhatsApp</div>
              <div class="link-compartir-desc">Pega este link en tu bio o mandalo a tus clientes</div>
              <div class="link-compartir-url" id="linkWA">Cargando...</div>
            </div>
            <button class="btn btn-outline btn-sm" onclick="ConfigView.copiarLink('linkWA')" title="Copiar">
              <i class="fas fa-copy"></i> Copiar
            </button>
          </div>
          <div class="link-compartir-item">
            <div class="link-compartir-icon ig"><i class="fab fa-instagram"></i></div>
            <div class="link-compartir-info">
              <div class="link-compartir-label">Link para Instagram</div>
              <div class="link-compartir-desc">Ideal para la bio de tu perfil o stories con link</div>
              <div class="link-compartir-url" id="linkIG">Cargando...</div>
            </div>
            <button class="btn btn-outline btn-sm" onclick="ConfigView.copiarLink('linkIG')" title="Copiar">
              <i class="fas fa-copy"></i> Copiar
            </button>
          </div>
          <div class="link-compartir-item">
            <div class="link-compartir-icon web"><i class="fas fa-utensils"></i></div>
            <div class="link-compartir-info">
              <div class="link-compartir-label">Carta digital (QR)</div>
              <div class="link-compartir-desc">Solo para ver el menú, sin carrito de pedido</div>
              <div class="link-compartir-url" id="linkCarta">Cargando...</div>
            </div>
            <button class="btn btn-outline btn-sm" onclick="ConfigView.copiarLink('linkCarta')" title="Copiar">
              <i class="fas fa-copy"></i> Copiar
            </button>
          </div>
        </div>
      </div>

      <div class="card mt-20">
        <div class="card-header">
          <span class="card-title"><i class="fas fa-qrcode"></i> Código QR — Carta Digital</span>
          <span class="card-subtitle">Imprimilo y colocalo en cada mesa</span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start;padding:16px 0;">
          <div style="display:flex;flex-direction:column;align-items:center;gap:12px;">
            <div id="qrCanvas" style="background:#fff;padding:12px;border-radius:8px;border:2px solid #e5e7eb;"></div>
            <button class="btn btn-primary btn-sm" onclick="ConfigView.descargarQR()">
              <i class="fas fa-download"></i> Descargar QR
            </button>
          </div>
          <div style="flex:1;min-width:220px;">
            <div class="form-group">
              <label>URL del QR</label>
              <input type="text" id="qrUrlInput" value="" style="font-size:13px;" readonly>
            </div>
            <div class="form-group">
              <label>Tamaño</label>
              <select id="qrSize" onchange="ConfigView.generarQR()">
                <option value="180">Pequeño (180px)</option>
                <option value="240" selected>Mediano (240px)</option>
                <option value="320">Grande (320px)</option>
              </select>
            </div>
            <p style="font-size:12px;color:#6b7280;margin-top:8px;">
              <i class="fas fa-info-circle"></i>
              Escaneá el QR con el celular para previsualizar la carta desde la red local.
            </p>
          </div>
        </div>
      </div>

      <div class="card mt-20">
        <div class="card-header">
          <span class="card-title"><i class="fas fa-percent"></i> Promociones / Descuentos</span>
          <button class="btn btn-primary btn-sm" onclick="ConfigView.nuevaPromocion()"><i class="fas fa-plus"></i> Nueva</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Nombre</th><th>Tipo</th><th>Valor</th><th>Descripción</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              ${(this.promociones || []).map(p => `
                <tr>
                  <td class="font-bold">${esc(p.nombre)}</td>
                  <td>${p.tipo === 'porcentaje' ? '%' : '$'}</td>
                  <td>${p.tipo === 'porcentaje' ? `${p.valor}%` : fmtMoneda(p.valor)}</td>
                  <td>${esc(p.descripcion || '-')}</td>
                  <td>${p.activo ? '<span class="badge badge-green">Activa</span>' : '<span class="badge badge-gray">Inactiva</span>'}</td>
                  <td>
                    <button class="btn btn-danger btn-sm" onclick="ConfigView.desactivarPromocion(${p.id})"><i class="fas fa-ban"></i></button>
                  </td>
                </tr>
              `).join('') || '<tr><td colspan="6"><div class="empty-state"><i class="fas fa-percent"></i><p>Sin promociones</p></div></td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card mt-20">
        <div class="card-header">
          <span class="card-title"><i class="fas fa-print"></i> Impresoras térmicas</span>
          <button class="btn btn-primary btn-sm" onclick="ConfigView.editarImpresora()"><i class="fas fa-plus"></i> Agregar impresora</button>
        </div>
        <p class="text-muted">Comandas para cocina y barra, y tickets para el cliente, en impresoras de 58 u 80 mm
          (USB instaladas en esta computadora o de red). Para cada impresora podés elegir qué categorías imprime:
          por ejemplo, la barra solo bebidas.</p>
        <div id="listaImpresoras" class="mt-10"><i class="fas fa-spinner fa-spin"></i></div>
        <form id="formOpcionesImpresion" class="mt-20" onsubmit="ConfigView.guardarOpcionesImpresion(event)">
          <div class="grid grid-3">
            <div class="form-group">
              <label>Ticket al cobrar</label>
              <select id="impTicketCobro">
                <option value="0">No imprimir</option>
                <option value="1">Imprimir automáticamente</option>
              </select>
            </div>
            <div class="form-group">
              <label>Cajón de dinero</label>
              <select id="impCajon">
                <option value="0">No abrir</option>
                <option value="1">Abrir al cobrar en efectivo</option>
              </select>
            </div>
            <div class="form-group">
              <label>Mensaje al pie del ticket</label>
              <input type="text" id="impPie" maxlength="200">
            </div>
          </div>
          <div class="text-right">
            <button type="submit" class="btn btn-outline btn-sm"><i class="fas fa-save"></i> Guardar opciones</button>
          </div>
        </form>
      </div>

      <div class="card mt-20">
        <div class="card-header">
          <span class="card-title"><i class="fas fa-database"></i> Copias de seguridad</span>
          <button class="btn btn-primary btn-sm" onclick="ConfigView.crearBackup()"><i class="fas fa-save"></i> Crear copia ahora</button>
        </div>
        <p class="text-muted">El sistema guarda una copia automática de la base de datos cada 24 horas.
          Descargá una copia de vez en cuando y guardala fuera de esta computadora.</p>
        <div id="listaBackups" class="mt-10"><i class="fas fa-spinner fa-spin"></i></div>
      </div>
    `;
    this._cargarBackups();
    this._cargarImpresoras();
  },

  // ===== Impresoras térmicas =====

  async _cargarImpresoras() {
    const cont = document.getElementById('listaImpresoras');
    if (!cont) return;
    try {
      const [impresoras, categorias, opciones] = await Promise.all([
        API.getImpresoras(), API.getCategorias(), API.getOpcionesImpresion()
      ]);
      this.impresoras = impresoras;
      this.categorias = categorias;
      document.getElementById('impTicketCobro').value = opciones.ticket_al_cobrar ? '1' : '0';
      document.getElementById('impCajon').value = opciones.abrir_cajon ? '1' : '0';
      document.getElementById('impPie').value = opciones.pie || '';

      if (!impresoras.length) {
        cont.innerHTML = '<p class="text-muted">No hay impresoras configuradas: las comandas se imprimen desde el navegador.</p>';
        return;
      }
      const nombreCat = id => (categorias.find(c => c.id === id) || {}).nombre || `#${id}`;
      cont.innerHTML = `<div class="table-wrap"><table>
        <thead><tr><th>Nombre</th><th>Conexión</th><th>Papel</th><th>Imprime</th><th>Categorías</th><th>Último uso</th><th></th></tr></thead>
        <tbody>${impresoras.map(i => {
          const u = i.ultima_impresion;
          const estado = !i.activa ? '<span class="badge badge-gray">Desactivada</span>'
            : !u ? '<span class="badge badge-gray">Sin usar</span>'
            : u.estado === 'ok' ? `<span class="badge badge-green">OK</span> <small>${fmtFechaHora(u.fecha)}</small>`
            : `<span class="badge badge-red" title="${esc(u.error)}">Error</span> <small>${esc(u.error)}</small>`;
          return `<tr>
            <td class="font-bold">${esc(i.nombre)}</td>
            <td>${i.tipo === 'red' ? 'Red' : 'USB'}: <code>${esc(i.destino)}</code></td>
            <td>${i.ancho} mm${i.copias > 1 ? ` · ${i.copias} copias` : ''}</td>
            <td>${[i.imprime_comandas ? 'Comandas' : '', i.imprime_tickets ? 'Tickets' : ''].filter(Boolean).join(' + ')}</td>
            <td>${i.categorias.length ? i.categorias.map(c => esc(nombreCat(c))).join(', ') : 'Todas'}</td>
            <td>${estado}</td>
            <td class="text-right" style="white-space:nowrap">
              <button class="btn btn-outline btn-sm" onclick="ConfigView.probarImpresora(${Number(i.id)})" title="Imprimir prueba"><i class="fas fa-vial"></i></button>
              <button class="btn btn-outline btn-sm" onclick="ConfigView.editarImpresora(${Number(i.id)})" title="Editar"><i class="fas fa-edit"></i></button>
              <button class="btn btn-danger btn-sm" onclick="ConfigView.eliminarImpresora(${Number(i.id)})" title="Eliminar"><i class="fas fa-trash"></i></button>
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`;
    } catch (err) {
      cont.innerHTML = `<p class="text-muted">No se pudieron cargar las impresoras: ${esc(err.message)}</p>`;
    }
  },

  async editarImpresora(id) {
    const i = id ? (this.impresoras || []).find(x => x.id === id) : { tipo: 'red', ancho: 80, imprime_comandas: 1, imprime_tickets: 0, categorias: [], copias: 1, activa: 1 };
    if (!i) return;
    const categorias = this.categorias || await API.getCategorias().catch(() => []);
    App.showModal(`
      <form onsubmit="ConfigView.guardarImpresora(event, ${id ? Number(id) : 'null'})">
        <div class="grid grid-2">
          <div class="form-group">
            <label>Nombre</label>
            <input type="text" id="impNombre" value="${esc(i.nombre || '')}" placeholder="Cocina, Barra, Caja..." required maxlength="40">
          </div>
          <div class="form-group">
            <label>Conexión</label>
            <select id="impTipo" onchange="ConfigView.cambiarTipoImpresora()">
              <option value="red" ${i.tipo === 'red' ? 'selected' : ''}>Red (Ethernet / WiFi)</option>
              <option value="usb" ${i.tipo === 'usb' ? 'selected' : ''}>USB (instalada en esta computadora)</option>
            </select>
          </div>
        </div>
        <div class="form-group" id="impDestinoRed">
          <label>Dirección IP de la impresora</label>
          <input type="text" id="impIp" value="${i.tipo === 'red' ? esc(i.destino || '') : ''}" placeholder="192.168.0.50 o 192.168.0.50:9100">
          <small class="text-muted">La IP figura en la hoja de configuración que imprime la impresora al mantener apretado el botón FEED al encenderla.</small>
        </div>
        <div class="form-group" id="impDestinoUsb">
          <label>Impresora instalada en Windows</label>
          <select id="impNombreSistema"><option value="">Cargando...</option></select>
          <small class="text-muted">Tiene que estar instalada en la computadora donde corre el sistema (con su driver o como "Generic / Text Only").</small>
        </div>
        <div class="grid grid-3">
          <div class="form-group">
            <label>Ancho del papel</label>
            <select id="impAncho">
              <option value="80" ${i.ancho !== 58 ? 'selected' : ''}>80 mm</option>
              <option value="58" ${i.ancho === 58 ? 'selected' : ''}>58 mm</option>
            </select>
          </div>
          <div class="form-group">
            <label>Imprime</label>
            <label class="checkbox-label"><input type="checkbox" id="impComandas" ${i.imprime_comandas ? 'checked' : ''}> Comandas</label>
            <label class="checkbox-label"><input type="checkbox" id="impTickets" ${i.imprime_tickets ? 'checked' : ''}> Tickets</label>
          </div>
          <div class="form-group">
            <label>Copias</label>
            <input type="number" id="impCopias" min="1" max="5" value="${Number(i.copias) || 1}">
          </div>
        </div>
        <div class="form-group">
          <label>Categorías de las comandas (ninguna marcada = todas)</label>
          <div class="grid grid-3">
            ${categorias.map(c => `<label class="checkbox-label"><input type="checkbox" class="impCategoria" value="${Number(c.id)}"
              ${i.categorias.includes(c.id) ? 'checked' : ''}> ${esc(c.nombre)}</label>`).join('')}
          </div>
        </div>
        <div class="form-group">
          <label class="checkbox-label"><input type="checkbox" id="impActiva" ${i.activa ? 'checked' : ''}> Activa</label>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-danger" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-success"><i class="fas fa-save"></i> Guardar</button>
        </div>
      </form>
    `, { title: id ? `Editar impresora ${i.nombre}` : 'Agregar impresora' });
    this.cambiarTipoImpresora();

    // Impresoras instaladas en la computadora del servidor
    const sel = document.getElementById('impNombreSistema');
    const instaladas = await API.getImpresorasSistema().catch(() => []);
    if (!sel) return;
    const actual = i.tipo === 'usb' ? i.destino : '';
    const opciones = [...new Set([...instaladas, ...(actual ? [actual] : [])])];
    sel.innerHTML = opciones.length
      ? opciones.map(n => `<option value="${esc(n)}" ${n === actual ? 'selected' : ''}>${esc(n)}</option>`).join('')
      : '<option value="">No se encontraron impresoras instaladas</option>';
  },

  cambiarTipoImpresora() {
    const red = document.getElementById('impTipo').value === 'red';
    document.getElementById('impDestinoRed').style.display = red ? '' : 'none';
    document.getElementById('impDestinoUsb').style.display = red ? 'none' : '';
  },

  async guardarImpresora(e, id) {
    e.preventDefault();
    const tipo = document.getElementById('impTipo').value;
    const data = {
      nombre: document.getElementById('impNombre').value,
      tipo,
      destino: tipo === 'red' ? document.getElementById('impIp').value : document.getElementById('impNombreSistema').value,
      ancho: parseInt(document.getElementById('impAncho').value, 10),
      imprime_comandas: document.getElementById('impComandas').checked,
      imprime_tickets: document.getElementById('impTickets').checked,
      copias: parseInt(document.getElementById('impCopias').value, 10) || 1,
      categorias: [...document.querySelectorAll('.impCategoria:checked')].map(c => parseInt(c.value, 10)),
      activa: document.getElementById('impActiva').checked
    };
    try {
      if (id) await API.actualizarImpresora(id, data);
      else await API.crearImpresora(data);
      App.closeModal();
      App.showToast('Impresora guardada. Probala con el botón de prueba.', 'success');
      this._cargarImpresoras();
    } catch (err) { App.showToast(err.message, 'error'); }
  },

  async probarImpresora(id) {
    try {
      App.showToast('Enviando prueba...', 'info');
      const r = await API.probarImpresora(id);
      App.showToast(r.message, r.ok ? 'success' : 'error', r.ok ? 3500 : 9000);
      this._cargarImpresoras();
    } catch (err) { App.showToast(err.message, 'error'); }
  },

  async eliminarImpresora(id) {
    const i = (this.impresoras || []).find(x => x.id === id);
    if (!confirm(`¿Eliminar la impresora ${i ? i.nombre : ''}?`)) return;
    try {
      await API.eliminarImpresora(id);
      App.showToast('Impresora eliminada', 'success');
      this._cargarImpresoras();
    } catch (err) { App.showToast(err.message, 'error'); }
  },

  async guardarOpcionesImpresion(e) {
    e.preventDefault();
    try {
      await API.guardarOpcionesImpresion({
        ticket_al_cobrar: document.getElementById('impTicketCobro').value === '1',
        abrir_cajon: document.getElementById('impCajon').value === '1',
        pie: document.getElementById('impPie').value
      });
      App.showToast('Opciones de impresión guardadas', 'success');
    } catch (err) { App.showToast(err.message, 'error'); }
  },

  async _cargarBackups() {
    const cont = document.getElementById('listaBackups');
    if (!cont) return;
    try {
      const lista = await API.getBackups();
      if (!lista.length) {
        cont.innerHTML = '<p class="text-muted">Todavía no hay copias.</p>';
        return;
      }
      cont.innerHTML = `<div class="table-wrap"><table>
        <thead><tr><th>Fecha</th><th>Tamaño</th><th></th></tr></thead>
        <tbody>${lista.map(b => `<tr>
          <td>${fmtFechaHora(b.fecha)}</td>
          <td>${(b.tamano / 1024 / 1024).toFixed(2)} MB</td>
          <td><button class="btn btn-outline btn-sm" onclick="ConfigView.descargarBackup(${jsArg(b.nombre)})"><i class="fas fa-download"></i> Descargar</button></td>
        </tr>`).join('')}</tbody>
      </table></div>`;
    } catch (err) {
      cont.innerHTML = `<p class="text-muted">No se pudieron cargar las copias: ${esc(err.message)}</p>`;
    }
  },

  async crearBackup() {
    try {
      App.showToast('Creando copia de seguridad...', 'info');
      await API.crearBackup();
      App.showToast('Copia de seguridad creada', 'success');
      this._cargarBackups();
    } catch (err) { App.showToast(err.message, 'error'); }
  },

  async descargarBackup(nombre) {
    try {
      const blob = await API.descargarBackup(nombre);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = nombre;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { App.showToast(err.message, 'error'); }
  },

  async desactivarPromocion(id) {
    if (!confirm('¿Desactivar esta promoción?')) return;
    try {
      await API.deletePromocion(id);
      App.showToast('Promoción desactivada', 'success');
      this.render();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  nuevaPromocion() {
    App.showModal(`
      <form onsubmit="ConfigView.guardarPromocion(event)">
        <div class="form-group">
          <label>Nombre</label>
          <input type="text" id="promNombre" required placeholder="Ej: 2x1 en postres">
        </div>
        <div class="grid grid-2">
          <div class="form-group">
            <label>Tipo</label>
            <select id="promTipo">
              <option value="porcentaje">Porcentaje (%)</option>
              <option value="monto">Monto ($)</option>
            </select>
          </div>
          <div class="form-group">
            <label>Valor</label>
            <input type="number" id="promValor" min="0" step="0.01" value="10" required>
          </div>
        </div>
        <div class="form-group">
          <label>Descripción</label>
          <textarea id="promDescripcion" placeholder="Detalles de la promoción"></textarea>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-danger" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-success">Guardar</button>
        </div>
      </form>
    `, { title: 'Nueva promoción' });
  },

  async guardarPromocion(e) {
    e.preventDefault();
    try {
      await API.createPromocion({
        nombre: document.getElementById('promNombre').value,
        tipo: document.getElementById('promTipo').value,
        valor: parseFloat(document.getElementById('promValor').value),
        descripcion: document.getElementById('promDescripcion').value
      });
      App.closeModal();
      App.showToast('Promoción creada', 'success');
      this.render();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  async guardar(e) {
    e.preventDefault();
    const data = {
      nombre_negocio: document.getElementById('cfgNombre').value,
      direccion: document.getElementById('cfgDireccion').value,
      telefono: document.getElementById('cfgTelefono').value,
      email: document.getElementById('cfgEmail').value,
      cuit: document.getElementById('cfgCuit').value,
      tasa_iva: parseInt(document.getElementById('cfgIva').value || 21),
      moneda: document.getElementById('cfgMoneda').value,
      activar_impresion: parseInt(document.getElementById('cfgImpresion').value),
      setup_completado: 1
    };
    if (this._tipoSeleccionado) {
      data.tipo_negocio = this._tipoSeleccionado;
      const p = (this.perfiles || {})[this._tipoSeleccionado];
      if (p) { data.modulos_activos = p.modulos; data.terminologia = p.terminologia; }
    }
    try {
      await API.updateConfig(data);
      App.showToast('Configuración guardada', 'success');
      this.render();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  async togglePlataforma(id, activa) {
    try {
      const lista = (this.plataformas || []).map(p => p.id === id ? { ...p, activa } : p);
      await API.savePlataformasDelivery(lista);
      this.plataformas = lista;
      App.showToast(activa ? 'Plataforma activada' : 'Plataforma desactivada', 'success');
    } catch (err) {
      App.showToast(err.message, 'error');
      this.render();
    }
  },

  async _cargarLinks() {
    try {
      const info = await fetch('/api/publico/info').then(r => r.json());
      const links = info.links || {};
      const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || ''; };
      set('linkWA',    links.whatsapp  || window.location.origin + '/pedido.html?origen=whatsapp');
      set('linkIG',    links.instagram || window.location.origin + '/pedido.html?origen=instagram');
      const urlCarta = links.carta || window.location.origin + '/menu.html';
      set('linkCarta', urlCarta);
      // Generar QR
      const inp = document.getElementById('qrUrlInput');
      if (inp) inp.value = urlCarta;
      this._qrUrl = urlCarta;
      this.generarQR();
    } catch (_) {}
  },

  generarQR() {
    const cont = document.getElementById('qrCanvas');
    if (!cont) return;
    const url  = this._qrUrl || (window.location.origin + '/menu.html');
    const size = parseInt((document.getElementById('qrSize') || {}).value || '240');
    // Usa la API pública de QR sin dependencias externas
    const apiUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=' + size + 'x' + size +
                   '&data=' + encodeURIComponent(url) + '&format=png&margin=10';
    cont.innerHTML = '<img id="qrImg" src="' + apiUrl + '" width="' + size + '" height="' + size +
                     '" alt="QR Carta Digital" style="display:block;border-radius:4px;">';
    this._qrApiUrl = apiUrl;
  },

  descargarQR() {
    const img = document.getElementById('qrImg');
    if (!img) { App.showToast('Generá el QR primero', 'warning'); return; }
    // Descarga directa desde la URL de la API
    const a = document.createElement('a');
    a.href = this._qrApiUrl;
    a.download = 'qr-carta-digital.png';
    a.target = '_blank';
    a.rel = 'noopener';
    a.click();
    App.showToast('Descargando QR...', 'success');
  },

  copiarLink(elId) {
    const el = document.getElementById(elId);
    if (!el) return;
    const texto = el.textContent.trim();
    if (!texto) return;
    navigator.clipboard.writeText(texto).then(() => {
      App.showToast('Link copiado al portapapeles', 'success');
    }).catch(() => {
      // fallback para navegadores sin clipboard API
      const ta = document.createElement('textarea');
      ta.value = texto;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      App.showToast('Link copiado', 'success');
    });
  },

  seleccionarTipo(tipo) {
    this._tipoSeleccionado = tipo;
    document.querySelectorAll('.wizard-card[data-perfil]').forEach(el => {
      el.classList.toggle('activo', el.dataset.perfil === tipo);
    });
  },

  async togglePlataforma(id, activa) {
    try {
      const lista = (this.plataformas || []).map(p => p.id === id ? { ...p, activa } : p);
      await API.savePlataformasDelivery(lista);
      this.plataformas = lista;
      App.showToast(activa ? 'Plataforma activada' : 'Plataforma desactivada', 'success');
    } catch (err) {
      App.showToast(err.message, 'error');
      this.render();
    }
  }
};
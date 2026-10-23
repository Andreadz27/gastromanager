// =============================================
// MORFI - Fidelización
// Programa de puntos, cupones de descuento y gift cards.
// Canjear puntos y cupones se hace al cobrar (Cobro); acá se configuran y se venden las gift cards.
// =============================================

const Fidelizacion = {
  pestana: 'puntos',

  async render() {
    const view = document.getElementById('view-fidelizacion');
    const edita = App.puede('catalogo');
    if (!edita && this.pestana !== 'giftcards') this.pestana = 'giftcards';
    const tab = (id, icono, texto) => `<button class="btn ${this.pestana === id ? 'btn-primary' : 'btn-outline'}" onclick="Fidelizacion.ir('${id}')"><i class="fas fa-${icono}"></i> ${texto}</button>`;
    view.innerHTML = `
      <div class="page-header">
        <div><h2><i class="fas fa-gift"></i> Fidelización</h2><p>Puntos, cupones y gift cards</p></div>
        <div class="personal-tabs">${edita ? tab('puntos', 'star', 'Puntos') + tab('cupones', 'ticket-alt', 'Cupones') : ''}${tab('giftcards', 'credit-card', 'Gift cards')}</div>
      </div>
      <div id="fidelizacionContenido"><div class="text-center mt-20"><i class="fas fa-spinner fa-spin fa-2x"></i></div></div>`;
    try {
      await ({ puntos: () => this.pintarPuntos(), cupones: () => this.pintarCupones(), giftcards: () => this.pintarGiftCards() }[this.pestana])();
    } catch (err) {
      this.contenido(`<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${esc(err.message)}</p></div>`);
    }
  },
  ir(p) { this.pestana = p; this.render(); },
  contenido(html) { document.getElementById('fidelizacionContenido').innerHTML = html; },

  // ===== Puntos =====
  async pintarPuntos() {
    const [cfg, clientes] = await Promise.all([API.getFidelizacionConfig(), API.getClientes()]);
    const ranking = [...clientes].sort((a, b) => (b.puntos || 0) - (a.puntos || 0)).slice(0, 50);
    this.contenido(`
      <div class="card">
        <div class="card-header"><span class="card-title"><i class="fas fa-cog"></i> Programa de puntos</span></div>
        <form onsubmit="Fidelizacion.guardarConfig(event)">
          <div class="grid grid-2">
            <div class="form-group"><label for="ptsActivo">Estado</label>
              <select id="ptsActivo"><option value="0" ${cfg.activo ? '' : 'selected'}>Apagado</option><option value="1" ${cfg.activo ? 'selected' : ''}>Activo</option></select></div>
            <div class="form-group"><label for="ptsCada">1 punto cada ($ consumidos, sin propina)</label>
              <input type="number" id="ptsCada" min="1" step="1" value="${cfg.cada}" required></div>
            <div class="form-group"><label for="ptsValor">Valor de cada punto al canjear ($)</label>
              <input type="number" id="ptsValor" min="0.01" step="0.01" value="${cfg.valor}" required></div>
            <div class="form-group"><label for="ptsMinimo">Se canjean desde (puntos)</label>
              <input type="number" id="ptsMinimo" min="0" step="1" value="${cfg.minimo}" required></div>
          </div>
          <p class="text-muted" id="ptsEjemplo">${this.ejemplo(cfg.cada, cfg.valor)}</p>
          <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Guardar</button>
        </form>
      </div>
      <div class="card mt-20">
        <div class="card-header"><span class="card-title"><i class="fas fa-trophy"></i> Clientes con más puntos</span></div>
        ${ranking.length ? `<div class="table-wrap"><table><thead><tr><th>Cliente</th><th>Teléfono</th><th>Puntos</th><th></th></tr></thead><tbody>
          ${ranking.map(c => `<tr><td>${esc(c.nombre)}</td><td>${esc(c.telefono || '')}</td><td><strong>${c.puntos || 0}</strong></td>
            <td><button class="btn btn-outline btn-sm" onclick="Fidelizacion.verPuntos(${c.id}, ${jsArg(c.nombre)})"><i class="fas fa-history"></i> Movimientos</button>
              <button class="btn btn-outline btn-sm" onclick="Fidelizacion.ajustar(${c.id}, ${jsArg(c.nombre)})"><i class="fas fa-plus-minus"></i> Ajustar</button></td></tr>`).join('')}
        </tbody></table></div>` : '<p class="text-muted">Todavía no hay clientes cargados.</p>'}
      </div>`);
  },

  ejemplo(cada, valor) {
    const gasto = 10000;
    const pts = Math.floor(gasto / cada);
    return `Ejemplo: un consumo de ${fmtMoneda(gasto)} suma ${pts} puntos, que valen ${fmtMoneda(pts * valor)} (${(pts * valor / gasto * 100).toLocaleString('es-AR', { maximumFractionDigits: 1 })}% de vuelta).`;
  },

  async guardarConfig(e) {
    e.preventDefault();
    try {
      App.config = await API.updateConfig({
        puntos_activo: Number(document.getElementById('ptsActivo').value),
        puntos_cada: Number(document.getElementById('ptsCada').value),
        puntos_valor: Number(document.getElementById('ptsValor').value),
        puntos_minimo: Number(document.getElementById('ptsMinimo').value)
      });
      App.showToast('Programa de puntos guardado', 'success');
      this.render();
    } catch (err) { App.showToast(err.message, 'error'); }
  },

  async verPuntos(id, nombre) {
    try {
      const movs = await API.getPuntosCliente(id);
      const TIPO = { gana: 'Compra', canje: 'Canje', devolucion: 'Devolución', ajuste: 'Ajuste' };
      App.showModal(movs.length ? `<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Puntos</th><th>Detalle</th></tr></thead><tbody>
        ${movs.map(m => `<tr><td>${esc(fmtFechaHora(m.creado_en))}</td><td>${TIPO[m.tipo] || esc(m.tipo)}</td>
          <td class="${m.puntos < 0 ? 'text-danger' : 'text-success'}"><strong>${m.puntos > 0 ? '+' : ''}${m.puntos}</strong></td>
          <td>${esc(m.detalle)}${m.usuario_nombre ? ` <small class="text-muted">(${esc(m.usuario_nombre)})</small>` : ''}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="text-muted">Sin movimientos.</p>', { title: `Puntos de ${esc(nombre)}` });
    } catch (err) { App.showToast(err.message, 'error'); }
  },

  ajustar(id, nombre) {
    App.showModal(`
      <form onsubmit="Fidelizacion.guardarAjuste(event, ${id})">
        <div class="form-group"><label for="ajPuntos">Puntos (negativo para restar)</label><input type="number" id="ajPuntos" step="1" required></div>
        <div class="form-group"><label for="ajMotivo">Motivo (queda registrado)</label><input type="text" id="ajMotivo" maxlength="200" required placeholder="Ej: cumpleaños, error de carga"></div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Guardar</button>
        </div>
      </form>`, { title: `Ajustar puntos de ${esc(nombre)}` });
  },

  async guardarAjuste(e, id) {
    e.preventDefault();
    try {
      await API.ajustarPuntos(id, Number(document.getElementById('ajPuntos').value), document.getElementById('ajMotivo').value);
      App.closeModal(); App.showToast('Puntos ajustados', 'success'); this.render();
    } catch (err) { App.showToast(err.message, 'error'); }
  },

  // ===== Cupones =====
  async pintarCupones() {
    const cupones = await API.getCupones();
    this._cupones = cupones;
    const hoy = hoyLocal();
    const vigencia = c => c.hasta && c.hasta < hoy ? '<span class="badge badge-gray">Vencido</span>'
      : c.desde && c.desde > hoy ? '<span class="badge badge-blue">Todavía no empieza</span>'
      : c.activo ? '<span class="badge badge-green">Activo</span>' : '<span class="badge badge-gray">Desactivado</span>';
    this.contenido(`
      <div class="card">
        <div class="card-header"><span class="card-title"><i class="fas fa-ticket-alt"></i> Cupones</span>
          <button class="btn btn-primary btn-sm" onclick="Fidelizacion.editarCupon()"><i class="fas fa-plus"></i> Nuevo cupón</button></div>
        ${cupones.length ? `<div class="table-wrap"><table><thead><tr><th>Código</th><th>Descuento</th><th>Condiciones</th><th>Usos</th><th>Estado</th><th></th></tr></thead><tbody>
          ${cupones.map(c => `<tr>
            <td><strong>${esc(c.codigo)}</strong>${c.descripcion ? `<br><small class="text-muted">${esc(c.descripcion)}</small>` : ''}</td>
            <td>${c.tipo === 'monto' ? fmtMoneda(c.valor) : c.valor + '%'}</td>
            <td><small>${[c.minimo ? `Desde ${fmtMoneda(c.minimo)}` : '', c.desde ? `Del ${fmtFecha(c.desde)}` : '', c.hasta ? `al ${fmtFecha(c.hasta)}` : '',
              c.usos_por_cliente ? `${c.usos_por_cliente} por cliente` : ''].filter(Boolean).map(esc).join(' · ') || 'Sin condiciones'}</small></td>
            <td>${c.usos}${c.usos_max ? ` / ${c.usos_max}` : ''}<br><small class="text-muted">${fmtMoneda(c.descontado)} descontado</small></td>
            <td>${vigencia(c)}</td>
            <td><button class="btn btn-outline btn-sm" onclick="Fidelizacion.editarCupon(${c.id})"><i class="fas fa-edit"></i></button></td>
          </tr>`).join('')}</tbody></table></div>` : '<p class="text-muted">Todavía no hay cupones. Creá uno para promociones, redes sociales o clientes nuevos.</p>'}
      </div>`);
  },

  editarCupon(id) {
    const c = (this._cupones || []).find(x => x.id === id) || { tipo: 'porcentaje', activo: 1 };
    App.showModal(`
      <form onsubmit="Fidelizacion.guardarCupon(event, ${id || 'null'})">
        <div class="grid grid-2">
          <div class="form-group"><label for="cupCodigo">Código</label><input type="text" id="cupCodigo" value="${esc(c.codigo || '')}" required maxlength="30" placeholder="BIENVENIDA" style="text-transform:uppercase"></div>
          <div class="form-group"><label for="cupDesc">Descripción</label><input type="text" id="cupDesc" value="${esc(c.descripcion || '')}" maxlength="120"></div>
          <div class="form-group"><label for="cupTipo">Tipo</label><select id="cupTipo">
            <option value="porcentaje" ${c.tipo === 'porcentaje' ? 'selected' : ''}>Porcentaje (%)</option>
            <option value="monto" ${c.tipo === 'monto' ? 'selected' : ''}>Monto fijo ($)</option></select></div>
          <div class="form-group"><label for="cupValor">Valor</label><input type="number" id="cupValor" min="0.01" step="0.01" value="${c.valor || ''}" required></div>
          <div class="form-group"><label for="cupMinimo">Consumo mínimo ($)</label><input type="number" id="cupMinimo" min="0" step="1" value="${c.minimo || ''}"></div>
          <div class="form-group"><label for="cupPorCliente">Usos por cliente</label><input type="number" id="cupPorCliente" min="1" step="1" value="${c.usos_por_cliente || ''}" placeholder="Sin límite"></div>
          <div class="form-group"><label for="cupDesde">Válido desde</label><input type="date" id="cupDesde" value="${c.desde || ''}"></div>
          <div class="form-group"><label for="cupHasta">Válido hasta</label><input type="date" id="cupHasta" value="${c.hasta || ''}"></div>
          <div class="form-group"><label for="cupMax">Usos en total</label><input type="number" id="cupMax" min="1" step="1" value="${c.usos_max || ''}" placeholder="Sin límite"></div>
          ${id ? `<div class="form-group"><label for="cupActivo">Estado</label><select id="cupActivo"><option value="1" ${c.activo ? 'selected' : ''}>Activo</option><option value="0" ${c.activo ? '' : 'selected'}>Desactivado</option></select></div>` : ''}
        </div>
        <small class="form-hint">Con "usos por cliente" el cupón pide elegir el cliente del pedido al aplicarlo.</small>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Guardar</button>
        </div>
      </form>`, { title: id ? 'Editar cupón' : 'Nuevo cupón' });
  },

  async guardarCupon(e, id) {
    e.preventDefault();
    const v = x => document.getElementById(x).value;
    const data = { codigo: v('cupCodigo'), descripcion: v('cupDesc'), tipo: v('cupTipo'), valor: Number(v('cupValor')), minimo: Number(v('cupMinimo')) || 0,
      usos_por_cliente: v('cupPorCliente') || null, usos_max: v('cupMax') || null, desde: v('cupDesde') || null, hasta: v('cupHasta') || null,
      ...(id ? { activo: v('cupActivo') === '1' } : {}) };
    try { await API.guardarCupon(data, id); App.closeModal(); App.showToast('Cupón guardado', 'success'); this.render(); }
    catch (err) { App.showToast(err.message, 'error'); }
  },

  // ===== Gift cards =====
  async pintarGiftCards() {
    const cards = await API.getGiftCards();
    const hoy = hoyLocal();
    const estado = g => g.estado !== 'activa' ? '<span class="badge badge-gray">Anulada</span>'
      : g.vence && g.vence < hoy ? '<span class="badge badge-gray">Vencida</span>'
      : g.saldo <= 0 ? '<span class="badge badge-blue">Usada</span>' : '<span class="badge badge-green">Con saldo</span>';
    this.contenido(`
      <div class="grid grid-2">
        <div class="card">
          <div class="card-header"><span class="card-title"><i class="fas fa-plus"></i> Vender gift card</span></div>
          <form onsubmit="Fidelizacion.vender(event)">
            <div class="grid grid-2">
              <div class="form-group"><label for="gcMonto">Monto ($)</label><input type="number" id="gcMonto" min="1" step="1" required></div>
              <div class="form-group"><label for="gcMedio">Cobrada en</label><select id="gcMedio">
                <option value="efectivo">Efectivo (entra a la caja)</option><option value="tarjeta">Tarjeta</option>
                <option value="transferencia">Transferencia</option><option value="mercadopago">Mercado Pago</option></select></div>
              <div class="form-group"><label for="gcComprador">Compra</label><input type="text" id="gcComprador" maxlength="80"></div>
              <div class="form-group"><label for="gcPara">Para</label><input type="text" id="gcPara" maxlength="80"></div>
              <div class="form-group"><label for="gcVence">Vence</label><input type="date" id="gcVence" min="${hoy}"></div>
            </div>
            <button type="submit" class="btn btn-success" id="gcVender"><i class="fas fa-check"></i> Vender</button>
          </form>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title"><i class="fas fa-search"></i> Consultar saldo</span></div>
          <form onsubmit="Fidelizacion.consultar(event)" class="cobro-chips">
            <input type="text" id="gcConsulta" placeholder="GM-XXXX-XXXX" maxlength="20" required>
            <button type="submit" class="btn btn-outline"><i class="fas fa-search"></i> Ver</button>
          </form>
          <div id="gcResultado" class="mt-10"></div>
        </div>
      </div>
      <div class="card mt-20">
        <div class="card-header"><span class="card-title"><i class="fas fa-list"></i> Gift cards vendidas</span></div>
        ${cards.length ? `<div class="table-wrap"><table><thead><tr><th>Código</th><th>Para</th><th>Monto</th><th>Saldo</th><th>Vence</th><th>Estado</th></tr></thead><tbody>
          ${cards.map(g => `<tr><td><strong>${esc(g.codigo)}</strong><br><small class="text-muted">${esc(fmtFecha(g.fecha))} · ${esc(g.medio_cobro)}</small></td>
            <td>${esc(g.destinatario || g.comprador || '')}</td><td>${fmtMoneda(g.monto)}</td><td><strong>${fmtMoneda(g.saldo)}</strong></td>
            <td>${g.vence ? esc(fmtFecha(g.vence)) : '—'}</td><td>${estado(g)}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="text-muted">Todavía no se vendieron gift cards.</p>'}
      </div>`);
  },

  async vender(e) {
    e.preventDefault();
    const btn = document.getElementById('gcVender');
    btn.disabled = true;
    try {
      const g = await API.venderGiftCard({ monto: Number(document.getElementById('gcMonto').value), medio: document.getElementById('gcMedio').value,
        comprador: document.getElementById('gcComprador').value, destinatario: document.getElementById('gcPara').value,
        vence: document.getElementById('gcVence').value || null });
      App.showModal(`<div class="cobro-ok"><i class="fas fa-gift"></i><h3>${esc(g.codigo)}</h3><p>Gift card por <strong>${fmtMoneda(g.monto)}</strong>${g.destinatario ? ` para ${esc(g.destinatario)}` : ''}.</p>
        <p class="text-muted">Anotá o imprimí el código: es lo que se usa para pagar.</p>
        <img src="${urlQr(g.codigo)}" alt="QR del código" width="160" height="160"></div>
        <div class="modal-footer"><button class="btn btn-outline" onclick="window.print()"><i class="fas fa-print"></i> Imprimir</button>
        <button class="btn btn-primary" onclick="App.closeModal()">Listo</button></div>`, { title: 'Gift card vendida' });
      this.render();
    } catch (err) { App.showToast(err.message, 'error'); btn.disabled = false; }
  },

  async consultar(e) {
    e.preventDefault();
    const el = document.getElementById('gcResultado');
    try {
      const g = await API.consultarGiftCard(document.getElementById('gcConsulta').value);
      el.innerHTML = `<p><strong>${esc(g.codigo)}</strong>: saldo <strong>${fmtMoneda(g.saldo)}</strong> de ${fmtMoneda(g.monto)}
        ${g.vencida ? `<br><span class="text-danger">Venció el ${esc(fmtFecha(g.vence))}</span>` : g.vence ? `<br><small>Vence el ${esc(fmtFecha(g.vence))}</small>` : ''}</p>`;
    } catch (err) { el.innerHTML = `<p class="text-danger">${esc(err.message)}</p>`; }
  }
};

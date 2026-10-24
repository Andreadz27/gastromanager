// =============================================
// MORFI - Tu plan
// Plan del local, lo que incluye cada plan y los candados del menú (los módulos que el plan no incluye).
// El servidor igual controla cada operación (402 si el plan no la incluye); esto es para mostrarlo claro.
// =============================================

const Plan = {
  datos: null,

  // Secciones del menú que dependen del plan
  VISTA_MODULO: { contabilidad: 'contabilidad', fidelizacion: 'fidelizacion', personal: 'personal' },

  async cargar() {
    try { this.datos = await API.getLicencia(); } catch (e) { return; } // sin servidor: queda como estaba
    this.aplicarCandados();
    this.pintarAviso();
  },

  // Sin datos todavía (o error al cargarlos) no se bloquea nada: el servidor decide
  tiene(modulo) { return !this.datos || this.datos.modulos.includes(modulo); },
  bloqueada(vista) { const m = this.VISTA_MODULO[vista]; return !!m && !this.tiene(m); },

  aplicarCandados() {
    document.querySelectorAll('.nav-item[data-view]').forEach(el => {
      const bloqueada = this.bloqueada(el.dataset.view);
      el.classList.toggle('nav-bloqueado', bloqueada);
      let candado = el.querySelector('.nav-candado');
      if (bloqueada && !candado) el.insertAdjacentHTML('beforeend', '<i class="fas fa-lock nav-candado" aria-label="No incluido en tu plan"></i>');
      if (!bloqueada && candado) candado.remove();
    });
    const fichar = document.getElementById('btnFichar');
    if (fichar) fichar.style.display = this.tiene('personal') ? '' : 'none';
    const nombre = document.getElementById('planNombre');
    if (nombre && this.datos) nombre.textContent = this.datos.plan_nombre;
  },

  // Aviso de vencimiento o fin de la prueba: solo a quien maneja el local
  pintarAviso() {
    const el = document.getElementById('avisoPlan');
    if (!el) return;
    const ver = this.datos && this.datos.aviso && (App.puede('admin') || App.puede('caja.historial'));
    el.style.display = ver ? '' : 'none';
    if (!ver) return;
    el.classList.toggle('pausado', ['vencido', 'prueba_terminada'].includes(this.datos.estado));
    el.innerHTML = `<i class="fas fa-crown"></i> ${esc(this.datos.aviso)}
      ${App.puede('admin') ? '<button class="btn btn-outline btn-sm" onclick="App.navigateTo(\'plan\')">Ver planes</button>' : ''}`;
  },

  // Al tocar una sección o una función que el plan no incluye
  mostrarMejora(modulo) {
    const d = this.datos;
    if (!d) return;
    const minimo = d.plan_minimo[modulo];
    const extra = d.extras_disponibles[minimo];
    const plan = d.planes[minimo];
    const precio = extra ? `+ ${fmtMoneda(extra.precio)} por mes` : plan ? `${fmtMoneda(plan.precio)} por mes${plan.por_local ? ' por local' : ''}` : '';
    const html = `
      <div class="plan-mejora">
        <div class="plan-mejora-icono"><i class="fas fa-lock-open"></i></div>
        <h3>${esc(d.modulos_disponibles[modulo] || 'Esta función')}</h3>
        <p>${d.estado === 'vencido' ? 'Tu plan está pausado. Se reactiva apenas se registre el pago.'
          : `No está incluido en tu plan ${esc(d.plan_nombre)}. Está en ${extra ? esc(extra.nombre) : 'el plan ' + esc(plan ? plan.nombre : minimo)}${precio ? ` (${precio})` : ''}.`}</p>
        <p class="text-muted">Lo que ya cargaste no se borra: vuelve a aparecer cuando lo actives.</p>
        <div class="plan-mejora-acciones">
          ${App.puede('admin') ? '<button class="btn btn-primary" onclick="App.closeModal(); App.navigateTo(\'plan\')"><i class="fas fa-crown"></i> Ver planes</button>' : '<p class="text-muted">Pedile al administrador que cambie el plan.</p>'}
          <button class="btn btn-outline" onclick="App.closeModal()">Cerrar</button>
        </div>
      </div>`;
    App.showModal(html, { title: 'Mejorá tu plan' });
  },

  linkVentas(texto) {
    const v = (this.datos && this.datos.ventas) || {};
    if (v.whatsapp) return `https://wa.me/${encodeURIComponent(v.whatsapp)}?text=${encodeURIComponent(texto)}`;
    if (v.email) return `mailto:${v.email}?subject=${encodeURIComponent('Plan de Morfi')}&body=${encodeURIComponent(texto)}`;
    return '';
  },

  async render() {
    const view = document.getElementById('view-plan');
    view.innerHTML = '<div class="text-center mt-20"><i class="fas fa-spinner fa-spin fa-2x"></i></div>';
    await this.cargar();
    const d = this.datos;
    if (!d) { view.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>No se pudo cargar el plan</p></div>'; return; }
    const negocio = (App.config && App.config.nombre_negocio) || 'mi local';
    const estado = {
      activo: d.vence ? `Al día hasta el ${fmtFecha(d.vence)}` : 'Activo',
      por_vencer: `Vence el ${fmtFecha(d.vence)}`, gracia: `Venció: en gracia hasta el ${fmtFecha(d.gracia_hasta)}`,
      vencido: 'Pausado por falta de pago', prueba: `Prueba gratis hasta el ${fmtFecha(d.vence)} (${d.dias} días)`,
      prueba_terminada: 'Terminó la prueba gratis'
    }[d.estado] || '';
    const actual = d.origen === 'licencia' ? d.contratado : d.plan;
    const tarjeta = ([id, p]) => {
      const pedido = `Hola, quiero el plan ${p.nombre} de Morfi para ${negocio}.`;
      const link = this.linkVentas(pedido);
      const anual = Math.round(p.precio * 12 * (1 - d.descuentos.anual));
      return `
      <div class="plan-tarjeta ${id === 'pro' ? 'destacado' : ''} ${id === actual ? 'actual' : ''}">
        ${id === 'pro' ? '<span class="plan-cinta">El más elegido</span>' : ''}
        <h3>${esc(p.nombre)}</h3>
        <p class="text-muted">${esc(p.para)}</p>
        <div class="plan-precio">${fmtMoneda(p.precio)}<small>/mes${p.por_local ? ' por local' : ''}</small></div>
        <p class="text-muted plan-anual">o ${fmtMoneda(anual)} por año${p.por_local ? ' por local' : ''} (2 meses gratis)</p>
        ${p.minimo_locales ? `<p class="text-muted">Desde ${p.minimo_locales} locales</p>` : ''}
        <ul class="plan-lista">
          <li><i class="fas fa-check"></i> Pedidos, mesas, cocina, caja y cobros</li>
          <li><i class="fas fa-check"></i> Factura electrónica ARCA incluida</li>
          <li><i class="fas fa-check"></i> Funciona sin internet y copia en la nube</li>
          <li><i class="fas fa-check"></i> Carta QR y llamado al mozo desde la mesa</li>
          <li><i class="fas fa-check"></i> Usuarios ilimitados</li>
          ${id === 'cadenas' ? '<li><i class="fas fa-check"></i> Todo lo del plan Pro</li>' : ''}
          ${p.modulos.filter(m => id === 'pro' || !d.planes.pro.modulos.includes(m)).map(m => `<li><i class="fas fa-check"></i> ${esc(d.modulos_disponibles[m])}</li>`).join('')}
        </ul>
        ${id === actual ? '<button class="btn btn-outline" disabled>Tu plan</button>'
          : link ? `<a class="btn btn-primary" href="${esc(link)}" target="_blank" rel="noopener">Quiero este plan</a>`
            : '<p class="text-muted">Pedíselo a quien te instaló Morfi.</p>'}
      </div>`;
    };
    view.innerHTML = `
      <div class="page-header">
        <div><h2><i class="fas fa-crown"></i> Tu plan</h2><p>Qué incluye tu plan y cómo cambiarlo</p></div>
      </div>
      <div class="card">
        <div class="plan-actual">
          <div><span class="text-muted">Plan actual</span><h3>${esc(d.plan_nombre)}${d.extras.length ? ' + ' + d.extras.map(e => esc((d.extras_disponibles[e] || {}).nombre || e)).join(', ') : ''}</h3></div>
          <div class="plan-estado plan-estado-${esc(d.estado)}">${esc(estado)}</div>
        </div>
        ${d.aviso ? `<p>${esc(d.aviso)}</p>` : ''}
        <p class="text-muted">Lo básico nunca se corta, ni con el plan vencido: pedidos, mesas, cocina, caja, cobros y facturación.</p>
      </div>
      <div class="planes-grid mt-20">${Object.entries(d.planes).map(tarjeta).join('')}</div>
      <div class="card mt-20">
        <div class="card-header"><span class="card-title"><i class="fas fa-puzzle-piece"></i> Extras</span></div>
        ${Object.entries(d.extras_disponibles).map(([id, x]) => `<p><strong>${esc(x.nombre)}</strong>: + ${fmtMoneda(x.precio)} por mes.
          ${esc(x.nota || '')} ${d.modulos.includes(id) ? '<span class="badge badge-green">Activo</span>' : ''}</p>`).join('')}
        <p class="text-muted">Pagando 6 meses juntos, 10 % menos; el año completo, 2 meses gratis. Alta, carga de la carta y capacitación a distancia sin cargo.</p>
      </div>
      <div class="card mt-20">
        <div class="card-header"><span class="card-title"><i class="fas fa-key"></i> Licencia</span></div>
        <p class="text-muted">Si el local está conectado a Morfi Nube, el plan se actualiza solo. Si no, pegá acá la licencia que te dio soporte.</p>
        <form onsubmit="Plan.guardarLicencia(event)">
          <div class="form-group"><label for="licenciaTexto">Licencia</label>
            <textarea id="licenciaTexto" rows="3" required placeholder="eyJ2Ijox..."></textarea></div>
          <button type="submit" class="btn btn-primary"><i class="fas fa-check"></i> Guardar licencia</button>
        </form>
      </div>`;
  },

  async guardarLicencia(e) {
    e.preventDefault();
    try {
      await API.guardarLicencia(document.getElementById('licenciaTexto').value);
      App.showToast('Licencia guardada', 'success');
      this.render();
    } catch (err) { App.showToast(err.message, 'error'); }
  }
};

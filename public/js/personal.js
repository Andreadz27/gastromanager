// =============================================
// MORFI - Personal
// Fichar entrada y salida, turnos, fichadas del equipo y reparto de propinas.
// Cualquiera ficha y ve lo suyo; lo del equipo es del encargado (permiso "personal").
// =============================================

const Personal = {
  pestana: 'mio',
  semana: null,      // lunes de la semana de la planilla (AAAA-MM-DD)
  empleados: [],
  reparto: null,     // vista previa del reparto de propinas

  DIAS: ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'],

  // Fechas AAAA-MM-DD sin zona horaria (se suman días en UTC para no correrse)
  sumarDias(fecha, n) {
    const d = new Date(fecha + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  },
  lunes(fecha) {
    const dia = (new Date(fecha + 'T00:00:00Z').getUTCDay() + 6) % 7;
    return this.sumarDias(fecha, -dia);
  },
  hora: f => f ? String(f).slice(11, 16) : '—',
  horas: h => `${Number(h || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })} h`,

  async render() {
    const view = document.getElementById('view-personal');
    if (!this.semana) this.semana = this.lunes(hoyLocal());
    const equipo = App.puede('personal');
    if (!equipo) this.pestana = 'mio';
    const tab = (id, icono, texto) => `<button class="btn ${this.pestana === id ? 'btn-primary' : 'btn-outline'}" onclick="Personal.ir('${id}')"><i class="fas fa-${icono}"></i> ${texto}</button>`;
    view.innerHTML = `
      <div class="page-header">
        <div><h2><i class="fas fa-user-clock"></i> Personal</h2><p>Fichadas, turnos${equipo ? ' y propinas' : ''}</p></div>
        ${equipo ? `<div class="personal-tabs">${tab('mio', 'user', 'Mi turno')}${tab('equipo', 'users', 'Fichadas')}${tab('turnos', 'calendar-alt', 'Turnos')}${tab('propinas', 'hand-holding-usd', 'Propinas')}</div>` : ''}
      </div>
      <div id="personalContenido"><div class="text-center mt-20"><i class="fas fa-spinner fa-spin fa-2x"></i></div></div>`;
    try {
      if (equipo && !this.empleados.length) this.empleados = await API.getEmpleados();
      await ({ mio: () => this.pintarMio(), equipo: () => this.pintarEquipo(), turnos: () => this.pintarTurnos(), propinas: () => this.pintarPropinas() }[this.pestana])();
    } catch (err) {
      document.getElementById('personalContenido').innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${esc(err.message)}</p></div>`;
    }
  },

  ir(pestana) { this.pestana = pestana; this.render(); },
  contenido(html) { document.getElementById('personalContenido').innerHTML = html; },

  // ===== Mi turno =====
  async pintarMio() {
    const [f, turnos, fichadas] = await Promise.all([API.getMiFichaje(), API.getMisTurnos(), API.getMisFichajes()]);
    App.marcarFichaje(f);
    this.contenido(`
      <div class="grid grid-2">
        <div class="card fichar-card ${f.adentro ? 'adentro' : ''}">
          <div class="fichar-estado">${f.adentro
            ? `<i class="fas fa-door-open"></i> Estás trabajando desde las <strong>${this.hora(f.fichada.entrada_local)}</strong>`
            : '<i class="fas fa-door-closed"></i> No estás fichado'}</div>
          <button class="btn ${f.adentro ? 'btn-danger' : 'btn-success'} btn-lg btn-block" onclick="Personal.fichar()">
            <i class="fas fa-fingerprint"></i> ${f.adentro ? 'Fichar salida' : 'Fichar entrada'}</button>
          <p class="text-muted mt-10">Hoy llevás ${this.horas(f.horas_hoy)}.</p>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title"><i class="fas fa-calendar-alt"></i> Mis próximos turnos</span></div>
          ${turnos.length ? `<div class="table-wrap"><table><tbody>${turnos.map(t => `<tr>
            <td>${esc(fmtFecha(t.fecha))}</td><td><strong>${esc(t.inicio)} a ${esc(t.fin)}</strong></td><td>${esc(t.puesto)}</td></tr>`).join('')}
          </tbody></table></div>` : '<p class="text-muted">No tenés turnos cargados.</p>'}
        </div>
      </div>
      <div class="card mt-20">
        <div class="card-header"><span class="card-title"><i class="fas fa-history"></i> Mis fichadas (últimos 7 días)</span></div>
        ${this.tablaFichadas(fichadas, false)}
      </div>`);
  },

  async fichar() {
    try {
      const f = await API.fichar();
      if (!f.repetido) App.showToast(f.adentro ? 'Entrada registrada' : `Salida registrada. Hoy: ${this.horas(f.horas_hoy)}`, 'success');
      App.marcarFichaje(f);
      if (App.currentView === 'personal') this.render();
    } catch (err) { App.showToast(err.message, 'error'); }
  },

  tablaFichadas(fichadas, conAcciones) {
    if (!fichadas.length) return '<p class="text-muted">Sin fichadas en el período.</p>';
    return `<div class="table-wrap"><table>
      <thead><tr>${conAcciones ? '<th>Empleado</th>' : ''}<th>Día</th><th>Entrada</th><th>Salida</th><th>Horas</th><th></th></tr></thead>
      <tbody>${fichadas.map(f => `<tr>
        ${conAcciones ? `<td>${esc(f.usuario_nombre)}</td>` : ''}
        <td>${esc(fmtFecha(f.entrada_local.slice(0, 10)))}</td>
        <td>${this.hora(f.entrada_local)}</td>
        <td>${f.abierta ? '<span class="badge badge-blue">Trabajando</span>' : this.hora(f.salida_local)}</td>
        <td>${this.horas(f.horas)}${f.revisar ? ' <span class="badge badge-red" title="Más de 16 horas: ¿se olvidó de fichar la salida?">Revisar</span>' : ''}</td>
        <td>${f.motivo_correccion ? `<span class="badge badge-orange" title="${esc(f.motivo_correccion)} (${esc(f.corregido_por_nombre || '')})">Corregida</span>` : ''}
          ${conAcciones ? `<button class="btn btn-outline btn-sm" onclick="Personal.corregir(${f.id})"><i class="fas fa-edit"></i> Corregir</button>` : ''}</td>
      </tr>`).join('')}</tbody></table></div>`;
  },

  // ===== Fichadas del equipo =====
  periodo: null,
  filtroPeriodo() {
    if (!this.periodo) this.periodo = { desde: this.sumarDias(hoyLocal(), -6), hasta: hoyLocal() };
    return `<div class="filtros-periodo">
      <label>Desde <input type="date" id="perDesde" value="${this.periodo.desde}"></label>
      <label>Hasta <input type="date" id="perHasta" value="${this.periodo.hasta}"></label>
      <button class="btn btn-outline btn-sm" onclick="Personal.cambiarPeriodo()"><i class="fas fa-search"></i> Ver</button>
    </div>`;
  },
  cambiarPeriodo() {
    this.periodo = { desde: document.getElementById('perDesde').value, hasta: document.getElementById('perHasta').value };
    this.reparto = null;
    this.render();
  },

  async pintarEquipo() {
    this.filtroPeriodo();
    const d = await API.getFichajesEquipo(this.periodo.desde, this.periodo.hasta);
    this._fichadas = d.fichajes;
    this.contenido(`
      <div class="card">
        <div class="card-header"><span class="card-title"><i class="fas fa-users"></i> Horas por persona</span>
          <button class="btn btn-primary btn-sm" onclick="Personal.cargarFichada()"><i class="fas fa-plus"></i> Cargar fichada</button></div>
        ${this.filtroPeriodo()}
        ${d.horas.length ? `<div class="table-wrap"><table><thead><tr><th>Empleado</th><th>Horas</th><th>Fichadas</th><th></th></tr></thead><tbody>
          ${d.horas.map(h => `<tr><td>${esc(h.nombre)}</td><td><strong>${this.horas(h.horas)}</strong></td><td>${h.fichadas}</td>
            <td>${h.abiertas ? '<span class="badge badge-blue">Trabajando ahora</span>' : ''}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="text-muted">Nadie fichó en el período.</p>'}
      </div>
      <div class="card mt-20">
        <div class="card-header"><span class="card-title"><i class="fas fa-list"></i> Fichadas</span></div>
        ${this.tablaFichadas(d.fichajes, true)}
      </div>`);
  },

  formFichada(titulo, f, alGuardar) {
    const local = v => v ? v.slice(0, 16).replace(' ', 'T') : '';
    App.showModal(`
      <form onsubmit="${alGuardar}">
        ${f ? `<p><strong>${esc(f.usuario_nombre)}</strong></p>` : `<div class="form-group"><label for="fichEmpleado">Empleado</label>
          <select id="fichEmpleado" required>${this.empleados.map(e => `<option value="${e.id}">${esc(e.nombre)}</option>`).join('')}</select></div>`}
        <div class="grid grid-2">
          <div class="form-group"><label for="fichEntrada">Entrada</label><input type="datetime-local" id="fichEntrada" value="${local(f && f.entrada_local)}" required></div>
          <div class="form-group"><label for="fichSalida">Salida</label><input type="datetime-local" id="fichSalida" value="${local(f && f.salida_local)}" ${f ? '' : 'required'}></div>
        </div>
        <div class="form-group"><label for="fichMotivo">Motivo (queda registrado)</label>
          <input type="text" id="fichMotivo" required maxlength="200" placeholder="Ej: se olvidó de fichar la salida"></div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Guardar</button>
        </div>
      </form>`, { title: titulo });
  },
  datosFichada() {
    return { entrada: document.getElementById('fichEntrada').value, salida: document.getElementById('fichSalida').value || null,
      motivo: document.getElementById('fichMotivo').value };
  },
  corregir(id) {
    const f = (this._fichadas || []).find(x => x.id === id);
    if (f) this.formFichada('Corregir fichada', f, `Personal.guardarCorreccion(event, ${id})`);
  },
  async guardarCorreccion(e, id) {
    e.preventDefault();
    try { await API.corregirFichaje(id, this.datosFichada()); App.closeModal(); App.showToast('Fichada corregida', 'success'); this.render(); }
    catch (err) { App.showToast(err.message, 'error'); }
  },
  cargarFichada() { this.formFichada('Cargar fichada', null, 'Personal.guardarFichadaNueva(event)'); },
  async guardarFichadaNueva(e) {
    e.preventDefault();
    try {
      await API.cargarFichaje({ usuario_id: Number(document.getElementById('fichEmpleado').value), ...this.datosFichada() });
      App.closeModal(); App.showToast('Fichada cargada', 'success'); this.render();
    } catch (err) { App.showToast(err.message, 'error'); }
  },

  // ===== Turnos (planilla semanal) =====
  async pintarTurnos() {
    const dias = [0, 1, 2, 3, 4, 5, 6].map(i => this.sumarDias(this.semana, i));
    const turnos = await API.getTurnos(dias[0], dias[6]);
    this._turnos = turnos;
    const celda = (emp, fecha) => turnos.filter(t => t.usuario_id === emp.id && t.fecha === fecha).map(t => {
      const estado = t.minutos_tarde > 5 ? `<span class="badge badge-orange">Llegó ${t.llegada} (+${t.minutos_tarde}')</span>`
        : t.llegada ? `<span class="badge badge-green">Llegó ${t.llegada}</span>` : t.ausente ? '<span class="badge badge-red">No fichó</span>' : '';
      return `<button class="turno-chip" onclick="Personal.editarTurno(${t.id})">${esc(t.inicio)}–${esc(t.fin)}${t.puesto ? `<small>${esc(t.puesto)}</small>` : ''}${estado}</button>`;
    }).join('') + `<button class="turno-agregar" title="Agregar turno" onclick="Personal.nuevoTurno(${emp.id}, '${fecha}')">+</button>`;
    const hoy = hoyLocal();
    this.contenido(`
      <div class="card">
        <div class="card-header">
          <span class="card-title"><i class="fas fa-calendar-alt"></i> Semana del ${esc(fmtFecha(dias[0]))}</span>
          <div>
            <button class="btn btn-outline btn-sm" onclick="Personal.moverSemana(-7)"><i class="fas fa-chevron-left"></i></button>
            <button class="btn btn-outline btn-sm" onclick="Personal.moverSemana(0)">Esta semana</button>
            <button class="btn btn-outline btn-sm" onclick="Personal.moverSemana(7)"><i class="fas fa-chevron-right"></i></button>
            <button class="btn btn-outline btn-sm" onclick="Personal.copiarSemana()"><i class="fas fa-copy"></i> Copiar a la semana siguiente</button>
          </div>
        </div>
        <div class="table-wrap"><table class="planilla-turnos">
          <thead><tr><th>Empleado</th>${dias.map((d, i) => `<th class="${d === hoy ? 'hoy' : ''}">${this.DIAS[i]} ${d.slice(8)}</th>`).join('')}</tr></thead>
          <tbody>${this.empleados.map(emp => `<tr><td><strong>${esc(emp.nombre)}</strong></td>
            ${dias.map(d => `<td class="${d === hoy ? 'hoy' : ''}">${celda(emp, d)}</td>`).join('')}</tr>`).join('')}</tbody>
        </table></div>
      </div>`);
  },
  moverSemana(n) { this.semana = n ? this.sumarDias(this.semana, n) : this.lunes(hoyLocal()); this.render(); },

  formTurno(t, titulo) {
    App.showModal(`
      <form onsubmit="Personal.guardarTurno(event, ${t.id || 'null'})">
        <div class="form-group"><label for="turEmpleado">Empleado</label>
          <select id="turEmpleado">${this.empleados.map(e => `<option value="${e.id}" ${e.id === t.usuario_id ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}</select></div>
        <div class="grid grid-3">
          <div class="form-group"><label for="turFecha">Día</label><input type="date" id="turFecha" value="${esc(t.fecha)}" required></div>
          <div class="form-group"><label for="turInicio">Entra</label><input type="time" id="turInicio" value="${esc(t.inicio || '')}" required></div>
          <div class="form-group"><label for="turFin">Sale</label><input type="time" id="turFin" value="${esc(t.fin || '')}" required></div>
        </div>
        <div class="form-group"><label for="turPuesto">Puesto</label><input type="text" id="turPuesto" value="${esc(t.puesto || '')}" maxlength="40" placeholder="Salón, cocina, caja..."></div>
        <small class="form-hint">Si sale después de medianoche (ej. 20:00 a 02:00), el turno termina al día siguiente.</small>
        <div class="modal-footer">
          ${t.id ? `<button type="button" class="btn btn-danger" onclick="Personal.borrarTurno(${t.id})"><i class="fas fa-trash"></i> Borrar</button>` : ''}
          <button type="button" class="btn btn-outline" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Guardar</button>
        </div>
      </form>`, { title: titulo });
  },
  nuevoTurno(usuarioId, fecha) { this.formTurno({ usuario_id: usuarioId, fecha }, 'Nuevo turno'); },
  editarTurno(id) { const t = this._turnos.find(x => x.id === id); if (t) this.formTurno(t, 'Editar turno'); },
  async guardarTurno(e, id) {
    e.preventDefault();
    const datos = { usuario_id: Number(document.getElementById('turEmpleado').value), fecha: document.getElementById('turFecha').value,
      inicio: document.getElementById('turInicio').value, fin: document.getElementById('turFin').value, puesto: document.getElementById('turPuesto').value };
    try { await API.guardarTurno(datos, id); App.closeModal(); this.render(); } catch (err) { App.showToast(err.message, 'error'); }
  },
  async borrarTurno(id) {
    try { await API.borrarTurno(id); App.closeModal(); this.render(); } catch (err) { App.showToast(err.message, 'error'); }
  },
  async copiarSemana() {
    try {
      const r = await API.copiarSemanaTurnos(this.semana);
      App.showToast(`${r.copiados} turnos copiados a la semana siguiente`, 'success');
      this.moverSemana(7);
    } catch (err) { App.showToast(err.message, 'error'); }
  },

  // ===== Propinas =====
  async pintarPropinas() {
    this.filtroPeriodo();
    const d = await API.getPropinas(this.periodo.desde, this.periodo.hasta);
    const r = this.reparto;
    const ESTADO = { pendiente: '<span class="badge badge-orange">Sin pagar</span>', pagado: '<span class="badge badge-green">Pagado</span>', anulado: '<span class="badge badge-gray">Anulado</span>' };
    this.contenido(`
      <div class="card">
        <div class="card-header"><span class="card-title"><i class="fas fa-hand-holding-usd"></i> Repartir propinas</span></div>
        ${this.filtroPeriodo()}
        <p>Propinas cobradas en el período: <strong class="font-bold">${fmtMoneda(d.total)}</strong></p>
        <div class="tipo-reparto">
          <label><input type="radio" name="metodoReparto" value="horas" ${!r || r.metodo === 'horas' ? 'checked' : ''}> Por horas trabajadas (según las fichadas)</label>
          <label><input type="radio" name="metodoReparto" value="iguales" ${r && r.metodo === 'iguales' ? 'checked' : ''}> En partes iguales</label>
        </div>
        <button class="btn btn-primary" onclick="Personal.calcularReparto()"><i class="fas fa-calculator"></i> Calcular</button>
        ${r ? `
          ${r.fichadas_abiertas ? `<p class="text-warning mt-10"><i class="fas fa-exclamation-triangle"></i> Hay ${r.fichadas_abiertas} fichada(s) sin salida: esas horas no cuentan hasta cerrarlas.</p>` : ''}
          <div class="table-wrap mt-10"><table><thead><tr><th></th><th>Empleado</th><th>Horas</th><th>Le toca</th></tr></thead><tbody>
            ${this.empleados.map(e => { const p = r.participantes.find(x => x.usuario_id === e.id); return `<tr>
              <td><input type="checkbox" class="repartoParticipa" value="${e.id}" ${p ? 'checked' : ''} onchange="Personal.calcularReparto(true)" aria-label="Participa ${esc(e.nombre)}"></td>
              <td>${esc(e.nombre)}</td><td>${p ? this.horas(p.horas) : '—'}</td><td><strong>${p ? fmtMoneda(p.monto) : '—'}</strong></td></tr>`; }).join('')}
          </tbody></table></div>
          <button class="btn btn-success mt-10" onclick="Personal.guardarReparto()" ${r.total > 0 && r.participantes.length ? '' : 'disabled'}>
            <i class="fas fa-check"></i> Guardar reparto de ${fmtMoneda(r.total)}</button>` : ''}
      </div>
      <div class="card mt-20">
        <div class="card-header"><span class="card-title"><i class="fas fa-list"></i> Repartos</span></div>
        ${d.repartos.length ? `<div class="table-wrap"><table><thead><tr><th>Período</th><th>Total</th><th>Reparto</th><th>Estado</th><th></th></tr></thead><tbody>
          ${d.repartos.map(x => `<tr>
            <td>${esc(fmtFecha(x.desde))} al ${esc(fmtFecha(x.hasta))}</td><td><strong>${fmtMoneda(x.total)}</strong></td>
            <td><small>${x.detalle.map(p => `${esc(p.nombre)}: ${fmtMoneda(p.monto)}`).join('<br>')}</small></td>
            <td>${ESTADO[x.estado] || esc(x.estado)}${x.estado === 'pagado' ? `<br><small>${esc(x.medio_pago)} · ${esc(fmtFecha(x.pagado_en))}</small>` : ''}</td>
            <td>${x.estado === 'pendiente' ? `
              <button class="btn btn-success btn-sm" onclick="Personal.pagarReparto(${x.id}, 'efectivo')" title="Sale de la caja abierta"><i class="fas fa-money-bill-wave"></i> Pagar en efectivo</button>
              <button class="btn btn-outline btn-sm" onclick="Personal.pagarReparto(${x.id}, 'transferencia')"><i class="fas fa-university"></i> Transferencia</button>
              <button class="btn btn-outline btn-sm" onclick="Personal.anularReparto(${x.id})">Anular</button>` : ''}</td>
          </tr>`).join('')}</tbody></table></div>` : '<p class="text-muted">Todavía no se repartieron propinas.</p>'}
      </div>`);
  },

  datosReparto(conElegidos) {
    const metodo = (document.querySelector('input[name="metodoReparto"]:checked') || {}).value || 'horas';
    const elegidos = [...document.querySelectorAll('.repartoParticipa:checked')].map(c => Number(c.value));
    return { desde: this.periodo.desde, hasta: this.periodo.hasta, metodo, ...(conElegidos ? { usuarios: elegidos } : {}) };
  },
  // conElegidos: después de tildar o destildar a alguien; si no, entran los que ficharon
  async calcularReparto(conElegidos = false) {
    try {
      const datos = this.datosReparto(conElegidos);
      if (conElegidos && !datos.usuarios.length) { this.reparto = { ...this.reparto, participantes: [] }; return this.pintarPropinas(); }
      this.reparto = await API.calcularReparto(datos);
      this.pintarPropinas();
    } catch (err) { App.showToast(err.message, 'error'); }
  },
  async guardarReparto() {
    try {
      await API.guardarReparto({ ...this.datosReparto(true) });
      this.reparto = null;
      App.showToast('Reparto guardado', 'success');
      this.pintarPropinas();
    } catch (err) { App.showToast(err.message, 'error'); }
  },
  async pagarReparto(id, medio) {
    if (!confirm(medio === 'efectivo' ? '¿Pagar las propinas en efectivo? Sale de la caja abierta.' : '¿Marcar el reparto como pagado por transferencia?')) return;
    try { await API.pagarReparto(id, medio); App.showToast('Reparto pagado', 'success'); this.pintarPropinas(); } catch (err) { App.showToast(err.message, 'error'); }
  },
  async anularReparto(id) {
    if (!confirm('¿Anular este reparto? El período queda libre para repartirlo de nuevo.')) return;
    try { await API.anularReparto(id); this.pintarPropinas(); } catch (err) { App.showToast(err.message, 'error'); }
  }
};

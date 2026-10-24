// =============================================
// MORFI - Ganancias
// Cuánto queda de lo que se vende: por día, semana, mes o año; por plato, canal, medio de pago, horario y mozo;
// qué se come la ganancia y cuánto hay que vender para cubrir los gastos fijos.
// Los cálculos y las definiciones están en src/servicios/ganancias.js.
// =============================================

const Ganancias = {
  tab: 'resumen',
  desde: null,
  hasta: null,
  agrupar: 'dia',
  mes: null,
  filtroClase: '',
  datos: null,
  cfg: null,

  TABS: [
    ['resumen', 'fa-chart-line', 'Resumen'],
    ['platos', 'fa-utensils', 'Por plato'],
    ['canales', 'fa-store', 'Canales y horarios'],
    ['fugas', 'fa-faucet-drip', 'Qué se come la ganancia'],
    ['equilibrio', 'fa-scale-balanced', 'Punto de equilibrio'],
    ['config', 'fa-sliders', 'Comisiones y gastos fijos']
  ],

  hoy() { return new Intl.DateTimeFormat('en-CA', { timeZone: (App.usuario && App.usuario.zona_horaria) || undefined }).format(new Date()); },
  menos(fecha, n) { const x = new Date(fecha + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() - n); return x.toISOString().slice(0, 10); },

  async render() {
    if (!this.desde) { this.hasta = this.hoy(); this.desde = this.hasta.slice(0, 8) + '01'; }
    if (!this.mes) this.mes = this.hoy().slice(0, 7);
    const view = document.getElementById('view-ganancias');
    view.innerHTML = '<div class="text-center mt-20"><i class="fas fa-spinner fa-spin fa-2x"></i></div>';
    const q = `desde=${this.desde}&hasta=${this.hasta}`;
    try {
      this.datos = await {
        resumen: () => API.request('GET', `/ganancias/resumen?${q}&agrupar=${this.agrupar}`),
        platos: () => API.request('GET', `/ganancias/productos?${q}`),
        canales: () => API.request('GET', `/ganancias/canales?${q}`),
        fugas: () => API.request('GET', `/ganancias/fugas?${q}`),
        equilibrio: () => API.request('GET', `/ganancias/equilibrio?mes=${this.mes}`),
        config: () => API.request('GET', '/ganancias/config')
      }[this.tab]();
      this.paint(view);
    } catch (err) {
      view.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${esc(err.message)}</p></div>`;
    }
  },

  setTab(t) { this.tab = t; this.render(); },

  paint(view) {
    const tabs = this.TABS.map(([id, icono, texto]) => `
      <button class="btn ${this.tab === id ? 'btn-primary' : 'btn-outline'}" onclick="Ganancias.setTab('${id}')"><i class="fas ${icono}"></i> ${texto}</button>`).join('');
    const conPeriodo = !['equilibrio', 'config'].includes(this.tab);
    view.innerHTML = `
      <div class="page-header">
        <div><h2><i class="fas fa-sack-dollar"></i> Ganancias</h2><p>Cuánto te queda de lo que vendés, y por qué</p></div>
        <div>
          ${['resumen', 'platos', 'canales'].includes(this.tab) ? '<button class="btn btn-outline" onclick="Ganancias.exportar()"><i class="fas fa-file-excel"></i> Exportar a Excel</button>' : ''}
          <button class="btn btn-outline" onclick="Ganancias.render()"><i class="fas fa-sync-alt"></i> Refrescar</button>
        </div>
      </div>
      <div class="filter-bar mb-20 cont-tabs">${tabs}</div>
      ${conPeriodo ? this.barraPeriodo() : ''}
      ${this['html_' + this.tab]()}`;
  },

  // ===== Período =====
  barraPeriodo() {
    const hoy = this.hoy();
    const mesAnt = new Date(Date.UTC(+hoy.slice(0, 4), +hoy.slice(5, 7) - 2, 1)).toISOString().slice(0, 10);
    const finMesAnt = this.menos(hoy.slice(0, 8) + '01', 1);
    const presets = [
      ['Hoy', hoy, hoy, 'dia'], ['Últimos 7 días', this.menos(hoy, 6), hoy, 'dia'], ['Este mes', hoy.slice(0, 8) + '01', hoy, 'dia'],
      ['Mes anterior', mesAnt, finMesAnt, 'dia'], ['Últimos 12 meses', this.menos(hoy, 364).slice(0, 8) + '01', hoy, 'mes'],
      ['Este año', hoy.slice(0, 4) + '-01-01', hoy, 'mes']
    ];
    let marcado = false;
    const botones = presets.map(([texto, d, h, ag]) => {
      const activo = !marcado && this.desde === d && this.hasta === h;
      marcado = marcado || activo;
      return `<button class="btn btn-sm ${activo ? 'btn-primary' : 'btn-outline'}" onclick="Ganancias.periodo('${d}','${h}','${ag}')">${texto}</button>`;
    }).join('');
    const agrupar = this.tab === 'resumen' ? `<label>Ver por <select id="ganAgrupar" onchange="Ganancias.setAgrupar(this.value)">
        ${[['dia', 'Día'], ['semana', 'Semana'], ['mes', 'Mes'], ['anio', 'Año']].map(([v, t]) => `<option value="${v}" ${this.agrupar === v ? 'selected' : ''}>${t}</option>`).join('')}
      </select></label>` : '';
    return `
      <div class="card mb-20 cont-periodo">
        <div class="cont-presets">${botones}</div>
        <div class="cont-fechas">
          <label>Desde <input type="date" id="ganDesde" value="${this.desde}" onchange="Ganancias.fechas()"></label>
          <label>Hasta <input type="date" id="ganHasta" value="${this.hasta}" onchange="Ganancias.fechas()"></label>
          ${agrupar}
        </div>
      </div>`;
  },
  periodo(d, h, ag) { this.desde = d; this.hasta = h; this.agrupar = ag; this.render(); },
  fechas() {
    const d = document.getElementById('ganDesde').value, h = document.getElementById('ganHasta').value;
    if (d && h && d <= h) { this.desde = d; this.hasta = h; this.render(); }
  },
  setAgrupar(v) { this.agrupar = v; this.render(); },

  stat(icono, color, valor, texto, extra = '') {
    return `<div class="stat-card"><div class="stat-icon ${color}"><i class="fas ${icono}"></i></div>
      <div class="stat-info"><h3>${valor}</h3><span>${texto}</span>${extra ? `<div>${extra}</div>` : ''}</div></div>`;
  },
  variacion(v, texto) {
    if (v === null || v === undefined) return `<small class="text-muted">Sin datos ${texto}</small>`;
    return `<small class="${v >= 0 ? 'text-success' : 'text-danger'}"><i class="fas fa-arrow-${v >= 0 ? 'up' : 'down'}"></i> ${Math.abs(v)} % ${texto}</small>`;
  },
  nombrePeriodo(p) {
    const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    if (this.datos.agrupar === 'anio') return p;
    if (this.datos.agrupar === 'mes') return `${meses[+p.slice(5, 7) - 1]} ${p.slice(0, 4)}`;
    if (this.datos.agrupar === 'semana') return `Semana del ${fmtFecha(p)}`;
    return fmtFecha(p);
  },

  // ===== Resumen =====
  html_resumen() {
    const r = this.datos, t = r.totales, c = r.comparacion;
    const color = v => v >= 0 ? 'green' : 'red';
    const cascada = [
      ['Ventas (sin propinas)', t.ventas, 'pos'],
      ...(r.tasa_iva ? [['IVA incluido en las ventas', -t.iva, 'neg']] : []),
      ['Costo de lo vendido (mercadería)', -t.costo, 'neg'],
      ['Comisiones (tarjetas, Mercado Pago y apps)', -t.comisiones, 'neg'],
      ['Ganancia bruta', t.ganancia_bruta, 'sub'],
      ['Gastos (alquiler, sueldos, servicios, etc.)', -t.gastos, 'neg'],
      ['Ganancia', t.ganancia, 'total']
    ];
    const maxC = Math.max(1, ...cascada.map(x => Math.abs(x[1])));
    const filasCascada = cascada.map(([texto, monto, tipo]) => `
      <div class="gan-cascada-fila ${tipo}">
        <span class="gan-cascada-texto">${texto}</span>
        <span class="gan-cascada-barra"><span style="width:${Math.abs(monto) / maxC * 100}%" class="${monto < 0 ? 'neg' : 'pos'}"></span></span>
        <span class="gan-cascada-monto">${fmtContable(monto)}</span>
      </div>`).join('');
    const max = Math.max(1, ...r.periodos.map(p => Math.max(p.ventas, Math.abs(p.ganancia))));
    const barras = r.periodos.length <= 62 ? r.periodos.map(p => `
      <div class="cont-barra" title="${esc(this.nombrePeriodo(p.periodo))} · Ventas ${fmtContable(p.ventas)} · Ganancia ${fmtContable(p.ganancia)}">
        <div class="cont-barra-par">
          <span class="v" style="height:${p.ventas / max * 100}%"></span>
          <span class="${p.ganancia >= 0 ? 'gan' : 'perd'}" style="height:${Math.abs(p.ganancia) / max * 100}%"></span>
        </div>
        <small>${esc(r.agrupar === 'dia' ? p.periodo.slice(8) : r.agrupar === 'mes' ? p.periodo.slice(5) : r.agrupar === 'semana' ? p.periodo.slice(8) + '/' + p.periodo.slice(5, 7) : p.periodo)}</small>
      </div>`).join('') : '';
    const filas = [...r.periodos].reverse().map(p => `
      <tr><td>${esc(this.nombrePeriodo(p.periodo))}</td><td class="text-right">${fmtContable(p.ventas)}</td>
        <td class="text-right">${fmtContable(p.costo)}</td><td class="text-right">${fmtContable(p.comisiones)}</td>
        <td class="text-right">${fmtContable(p.ganancia_bruta)}</td><td class="text-right">${fmtContable(p.gastos)}</td>
        <td class="text-right font-bold ${p.ganancia >= 0 ? 'text-success' : 'text-danger'}">${fmtContable(p.ganancia)}</td>
        <td class="text-right">${p.tickets}</td><td class="text-right">${fmtContable(p.ticket_promedio)}</td></tr>`).join('');
    const sinCosto = r.sin_costo.length ? `
      <div class="aviso-plan mb-20"><i class="fas fa-triangle-exclamation"></i> <strong>${r.sin_costo.length} producto(s) vendidos sin costo cargado</strong>:
        ${r.sin_costo.slice(0, 6).map(x => esc(x.producto)).join(', ')}${r.sin_costo.length > 6 ? '…' : ''}. Con ellos la ganancia sale más alta de lo real.
        ${App.puede('catalogo') ? '<button class="btn btn-outline btn-sm" onclick="App.navigateTo(\'productos\')">Cargar costos</button>' : ''}</div>` : '';
    return `
      ${sinCosto}
      <div class="grid grid-4 mb-20">
        ${this.stat('fa-cash-register', 'blue', fmtContable(t.ventas), 'Ventas', this.variacion(c.anterior.variacion_ventas, 'vs. período anterior'))}
        ${this.stat('fa-coins', 'orange', fmtContable(t.ganancia_bruta), 'Ganancia bruta', `<small class="text-muted">Te quedan $${Math.round(t.ganancia_bruta / (t.ventas || 1) * 100)} de cada $100 vendidos</small>`)}
        ${this.stat('fa-file-invoice-dollar', 'purple', fmtContable(t.gastos), 'Gastos cargados', `<small class="text-muted">${App.puede('contabilidad') ? '<a href="#" onclick="App.navigateTo(\'contabilidad\');return false;">Cargar gastos</a>' : 'Desde Contabilidad'}</small>`)}
        ${this.stat(t.ganancia >= 0 ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down', color(t.ganancia), fmtContable(t.ganancia), 'Ganancia', this.variacion(c.anterior.variacion_ganancia, 'vs. período anterior'))}
      </div>
      <div class="grid grid-2 mb-20">
        <div class="card">
          <div class="card-header"><span class="card-title"><i class="fas fa-water"></i> De la venta a la ganancia</span></div>
          <div class="gan-cascada">${filasCascada}</div>
          <p class="text-muted mt-10">Margen bruto ${t.margen_bruto_pct} % · Margen neto ${t.margen_neto_pct} % · Costo de mercadería ${t.costo_pct} % de las ventas netas.</p>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title"><i class="fas fa-code-compare"></i> Comparado con</span></div>
          <table><thead><tr><th></th><th class="text-right">Ventas</th><th class="text-right">Ganancia</th></tr></thead><tbody>
            <tr><td><strong>Este período</strong><br><small class="text-muted">${fmtFecha(r.desde)} al ${fmtFecha(r.hasta)}</small></td>
              <td class="text-right">${fmtContable(t.ventas)}</td><td class="text-right">${fmtContable(t.ganancia)}</td></tr>
            <tr><td>Período anterior<br><small class="text-muted">${fmtFecha(c.anterior.desde)} al ${fmtFecha(c.anterior.hasta)}</small></td>
              <td class="text-right">${fmtContable(c.anterior.ventas)}<br>${this.variacion(c.anterior.variacion_ventas, '')}</td>
              <td class="text-right">${fmtContable(c.anterior.ganancia)}<br>${this.variacion(c.anterior.variacion_ganancia, '')}</td></tr>
            <tr><td>Mismo período del año pasado<br><small class="text-muted">${fmtFecha(c.anio_pasado.desde)} al ${fmtFecha(c.anio_pasado.hasta)}</small></td>
              <td class="text-right">${fmtContable(c.anio_pasado.ventas)}<br>${this.variacion(c.anio_pasado.variacion_ventas, '')}</td>
              <td class="text-right">${fmtContable(c.anio_pasado.ganancia)}<br>${this.variacion(c.anio_pasado.variacion_ganancia, '')}</td></tr>
          </tbody></table>
        </div>
      </div>
      <div class="card mb-20">
        <div class="card-header"><span class="card-title"><i class="fas fa-chart-column"></i> Ventas y ganancia por ${{ dia: 'día', semana: 'semana', mes: 'mes', anio: 'año' }[r.agrupar]}</span>
          <span class="cont-leyenda"><span class="v"></span> Ventas <span class="gan"></span> Ganancia <span class="perd"></span> Pérdida</span></div>
        ${barras ? `<div class="cont-grafico">${barras}</div>` : '<p class="text-muted">Demasiados períodos para el gráfico: elegí ver por semana o por mes.</p>'}
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title"><i class="fas fa-table"></i> Detalle</span></div>
        <div class="table-wrap"><table><thead><tr><th>Período</th><th class="text-right">Ventas</th><th class="text-right">Costo</th><th class="text-right">Comisiones</th>
          <th class="text-right">Ganancia bruta</th><th class="text-right">Gastos</th><th class="text-right">Ganancia</th><th class="text-right">Tickets</th><th class="text-right">Ticket prom.</th></tr></thead>
          <tbody>${filas}</tbody></table></div>
        <p class="text-muted mt-10">Ventas sin propinas (son del personal). El costo sale del costo cargado en cada producto o receta. Los gastos son los cargados en
          Contabilidad, sin mercadería (ya está en el costo) ni comisiones (ya están estimadas).</p>
      </div>`;
  },

  // ===== Por plato =====
  CLASE_ICONO: { estrella: 'fa-star', caballo: 'fa-horse', rompecabezas: 'fa-puzzle-piece', perro: 'fa-dog' },
  html_platos() {
    const r = this.datos;
    if (!r.productos.length) return '<div class="empty-state"><i class="fas fa-utensils"></i><p>No hay ventas en el período</p></div>';
    const cuenta = k => r.productos.filter(p => p.clase === k).length;
    const tarjetas = Object.entries(r.clases).map(([k, c]) => `
      <div class="gan-clase gan-clase-${k} ${this.filtroClase === k ? 'activa' : ''}" onclick="Ganancias.filtrar('${k}')">
        <div class="gan-clase-titulo"><i class="fas ${this.CLASE_ICONO[k]}"></i> ${esc(c.nombre)} <span class="badge">${cuenta(k)}</span></div>
        <small>${esc(c.consejo)}</small>
      </div>`).join('');
    const lista = r.productos.filter(p => !this.filtroClase || p.clase === this.filtroClase);
    const filas = lista.map(p => `
      <tr><td>${esc(p.producto)} ${p.sin_costo ? '<span class="badge badge-orange" title="Sin costo cargado">sin costo</span>' : ''}<br><small class="text-muted">${esc(p.categoria)}</small></td>
        <td><span class="gan-badge gan-clase-${p.clase}"><i class="fas ${this.CLASE_ICONO[p.clase]}"></i> ${esc(r.clases[p.clase].nombre)}</span></td>
        <td class="text-right">${p.unidades}</td><td class="text-right">${fmtContable(p.ventas)}</td><td class="text-right">${fmtContable(p.costo)}</td>
        <td class="text-right font-bold">${fmtContable(p.ganancia)}</td><td class="text-right">${p.margen_pct} %</td>
        <td class="text-right">${fmtContable(p.ganancia_unidad)}</td><td class="text-right">${p.participacion_pct} %</td></tr>`).join('');
    const cats = r.categorias.map(c => `<tr><td>${esc(c.categoria)}</td><td class="text-right">${c.unidades}</td><td class="text-right">${fmtContable(c.ventas)}</td>
      <td class="text-right">${fmtContable(c.costo)}</td><td class="text-right font-bold">${fmtContable(c.ganancia)}</td><td class="text-right">${c.margen_pct} %</td></tr>`).join('');
    return `
      <div class="gan-clases mb-20">${tarjetas}</div>
      <p class="text-muted mb-20">Popular: se vendieron ${Math.ceil(r.referencias.unidades_minimas_popular)} unidades o más (70 % del promedio). Rentable: deja más de
        ${fmtContable(r.referencias.ganancia_media_unidad)} por unidad (el promedio de la carta). ${this.filtroClase ? '<a href="#" onclick="Ganancias.filtrar(\'\');return false;">Ver todos</a>' : 'Tocá un grupo para filtrar.'}</p>
      <div class="card mb-20"><div class="card-header"><span class="card-title"><i class="fas fa-utensils"></i> Platos y productos</span></div>
        <div class="table-wrap"><table><thead><tr><th>Producto</th><th>Grupo</th><th class="text-right">Unidades</th><th class="text-right">Ventas</th><th class="text-right">Costo</th>
          <th class="text-right">Ganancia</th><th class="text-right">Margen</th><th class="text-right">Por unidad</th><th class="text-right">% de la ganancia</th></tr></thead><tbody>${filas}</tbody></table></div>
        <p class="text-muted mt-10">Ganancia antes de comisiones y descuentos del pedido (se ven en "Qué se come la ganancia").</p></div>
      <div class="card"><div class="card-header"><span class="card-title"><i class="fas fa-layer-group"></i> Por categoría</span></div>
        <div class="table-wrap"><table><thead><tr><th>Categoría</th><th class="text-right">Unidades</th><th class="text-right">Ventas</th><th class="text-right">Costo</th>
          <th class="text-right">Ganancia</th><th class="text-right">Margen</th></tr></thead><tbody>${cats}</tbody></table></div></div>`;
  },
  filtrar(k) { this.filtroClase = this.filtroClase === k ? '' : k; this.paint(document.getElementById('view-ganancias')); },

  // ===== Canales, medios, horarios y mozos =====
  tabla(filas, columnas) {
    return `<div class="table-wrap"><table><thead><tr>${columnas.map(c => `<th class="${c[2] || ''}">${c[0]}</th>`).join('')}</tr></thead>
      <tbody>${filas.map(f => `<tr>${columnas.map(c => `<td class="${c[2] || ''}">${c[1](f)}</td>`).join('')}</tr>`).join('') ||
        `<tr><td colspan="${columnas.length}" class="text-muted">Sin datos en el período</td></tr>`}</tbody></table></div>`;
  },
  html_canales() {
    const r = this.datos, $ = fmtContable, R = 'text-right';
    const max = Math.max(1, ...r.horas.map(h => h.ventas));
    const horas = r.horas.map(h => `<div class="cont-barra" title="${h.nombre} · ${$(h.ventas)} · ${h.tickets} tickets">
      <div class="cont-barra-par"><span class="v" style="height:${h.ventas / max * 100}%"></span></div><small>${String(h.clave).padStart(2, '0')}</small></div>`).join('');
    return `
      <div class="grid grid-2 mb-20">
        <div class="card"><div class="card-header"><span class="card-title"><i class="fas fa-store"></i> Por canal</span></div>
          ${this.tabla(r.canales, [['Canal', f => esc(f.nombre)], ['Ventas', f => $(f.ventas), R], ['%', f => f.participacion_pct + ' %', R],
            ['Comisiones', f => $(f.comisiones), R], ['Ganancia bruta', f => `<strong>${$(f.ganancia_bruta)}</strong>`, R], ['Margen', f => f.margen_bruto_pct + ' %', R]])}
          <p class="text-muted mt-10">Las apps de delivery descuentan su comisión (se edita en Delivery → Plataformas).</p></div>
        <div class="card"><div class="card-header"><span class="card-title"><i class="fas fa-credit-card"></i> Por medio de pago</span></div>
          ${this.tabla(r.medios, [['Medio', f => esc(f.nombre)], ['Cobrado', f => $(f.cobrado), R], ['%', f => f.participacion_pct + ' %', R],
            ['Comisión', f => `${$(f.comision)} <small class="text-muted">(${f.porcentaje} %)</small>`, R]])}
          <p class="text-muted mt-10">Los porcentajes se cambian en "Comisiones y gastos fijos".</p></div>
      </div>
      <div class="card mb-20"><div class="card-header"><span class="card-title"><i class="fas fa-clock"></i> Ventas por hora</span></div>
        ${horas ? `<div class="cont-grafico gan-horas">${horas}</div>` : '<p class="text-muted">Sin ventas en el período.</p>'}</div>
      <div class="grid grid-2">
        <div class="card"><div class="card-header"><span class="card-title"><i class="fas fa-calendar-week"></i> Por día de la semana (promedio por día)</span></div>
          ${this.tabla(r.dias_semana, [['Día', f => esc(f.nombre)], ['Ventas prom.', f => $(f.ventas_promedio), R], ['Ganancia bruta prom.', f => $(f.ganancia_promedio), R], ['Tickets', f => f.tickets, R]])}</div>
        <div class="card"><div class="card-header"><span class="card-title"><i class="fas fa-user-tie"></i> Por mozo / cajero</span></div>
          ${this.tabla(r.mozos, [['Usuario', f => esc(f.nombre)], ['Ventas', f => $(f.ventas), R], ['Tickets', f => f.tickets, R],
            ['Ticket prom.', f => $(f.ticket_promedio), R], ['Propinas', f => $(f.propinas), R]])}</div>
      </div>`;
  },

  // ===== Fugas =====
  html_fugas() {
    const r = this.datos;
    const max = Math.max(1, ...r.items.map(i => i.monto));
    const items = r.items.map(i => `
      <div class="gan-cascada-fila neg"><span class="gan-cascada-texto">${esc(i.nombre)}</span>
        <span class="gan-cascada-barra"><span class="neg" style="width:${i.monto / max * 100}%"></span></span>
        <span class="gan-cascada-monto">${fmtContable(i.monto)} <small class="text-muted">${i.pct_ventas} %</small></span></div>`).join('');
    return `
      <div class="grid grid-3 mb-20">
        ${this.stat('fa-faucet-drip', 'red', fmtContable(r.total), 'Se fue en el período', `<small class="text-muted">${r.total_pct_ventas} % de las ventas</small>`)}
        ${this.stat('fa-ban', 'orange', r.cancelados.cantidad, 'Pedidos cancelados', `<small class="text-muted">${fmtContable(r.cancelados.monto)} que no se vendieron</small>`)}
        ${this.stat('fa-percent', 'purple', r.medios.map(m => `${esc(m.medio)} ${m.porcentaje} %`).join(' · ') || '—', 'Comisiones configuradas')}
      </div>
      <div class="card mb-20"><div class="card-header"><span class="card-title"><i class="fas fa-list-ol"></i> De mayor a menor</span></div>
        <div class="gan-cascada">${items}</div>
        <p class="text-muted mt-10">Consejos: pasar clientes de tarjeta a transferencia o efectivo baja comisiones; si las apps se llevan mucho, empujá tu carta
          online propia (sin comisión); revisá los descuentos manuales con el PIN del encargado.</p></div>
      <div class="card"><div class="card-header"><span class="card-title"><i class="fas fa-trash-can"></i> Mermas y salidas de stock a mano</span></div>
        ${this.tabla(r.mermas, [['Producto', f => esc(f.producto)], ['Cantidad', f => f.cantidad, 'text-right'], ['Costo', f => fmtContable(f.costo), 'text-right'], ['Motivos', f => esc(f.motivos || '')]])}</div>`;
  },

  // ===== Punto de equilibrio =====
  html_equilibrio() {
    const e = this.datos;
    const sinFijos = !e.gastos_fijos;
    const avance = Math.min(100, e.avance_pct || 0);
    const cabecera = `
      <div class="card mb-20 cont-periodo"><div class="cont-fechas">
        <label>Mes <input type="month" id="ganMes" value="${e.mes}" onchange="Ganancias.setMes(this.value)"></label>
      </div></div>`;
    if (sinFijos) {
      return `${cabecera}<div class="empty-state"><i class="fas fa-scale-balanced"></i>
        <p>Cargá tus gastos fijos del mes (alquiler, sueldos, servicios…) para saber cuánto tenés que vender por día para no perder plata.</p>
        ${e.sugerencia_fijos && e.sugerencia_fijos.monto ? `<p class="text-muted">El mes pasado cargaste ${fmtContable(e.sugerencia_fijos.monto)} en gastos.</p>` : ''}
        ${App.puede('admin') ? '<button class="btn btn-primary" onclick="Ganancias.setTab(\'config\')"><i class="fas fa-sliders"></i> Cargar gastos fijos</button>' : ''}</div>`;
    }
    const mensaje = e.ventas_necesarias_mes === null
      ? 'Todavía no hay ventas para calcular el margen.'
      : e.alcanzado ? `<strong class="text-success">Ya cubriste los gastos fijos del mes.</strong> Lo que vendas de acá en adelante deja ganancia.`
        : e.necesario_por_dia_restante !== null ? `Te falta vender ${fmtContable(e.falta_vender)}: ${fmtContable(e.necesario_por_dia_restante)} por día en los ${e.dias_del_mes - e.dias_transcurridos} días que quedan.`
          : `Faltaron ${fmtContable(e.falta_vender)} para cubrir los gastos fijos.`;
    return `${cabecera}
      <div class="grid grid-4 mb-20">
        ${this.stat('fa-building', 'purple', fmtContable(e.gastos_fijos), 'Gastos fijos del mes')}
        ${this.stat('fa-percent', 'orange', e.margen_contribucion_pct + ' %', 'Margen de cada venta', '<small class="text-muted">Lo que queda después de costo y comisiones</small>')}
        ${this.stat('fa-bullseye', 'blue', e.ventas_necesarias_mes === null ? '—' : fmtContable(e.ventas_necesarias_mes), 'Hay que vender en el mes',
          e.ventas_necesarias_dia === null ? '' : `<small class="text-muted">${fmtContable(e.ventas_necesarias_dia)} por día</small>`)}
        ${this.stat(e.ganancia_proyectada >= 0 ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down', e.ganancia_proyectada >= 0 ? 'green' : 'red', fmtContable(e.ganancia_proyectada), 'Ganancia proyectada del mes',
          `<small class="text-muted">Si seguís vendiendo ${fmtContable(e.promedio_diario)} por día</small>`)}
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title"><i class="fas fa-flag-checkered"></i> Avance del mes</span></div>
        <div class="gan-progreso"><span style="width:${avance}%" class="${e.alcanzado ? 'ok' : ''}"></span></div>
        <p>Vendido: <strong>${fmtContable(e.vendido)}</strong> de ${e.ventas_necesarias_mes === null ? '—' : fmtContable(e.ventas_necesarias_mes)} (${e.avance_pct ?? 0} %) ·
          Día ${e.dias_transcurridos} de ${e.dias_del_mes} · Proyección del mes: ${fmtContable(e.proyeccion_mes)}</p>
        <p>${mensaje}</p>
        <p class="text-muted">Gastos fijos: ${e.detalle_fijos.map(g => `${esc(g.concepto)} ${fmtContable(g.monto)}`).join(' · ')}</p>
      </div>`;
  },
  setMes(v) { if (v) { this.mes = v; this.render(); } },

  // ===== Comisiones y gastos fijos =====
  html_config() {
    const c = this.datos;
    const admin = App.puede('admin');
    const medios = Object.entries(c.medios).map(([k, nombre]) => `
      <div class="form-group"><label for="com_${k}">${esc(nombre)} (%)</label>
        <input type="number" id="com_${k}" min="0" max="50" step="0.01" value="${c.comisiones[k]}" ${admin ? '' : 'disabled'}>
        <small class="text-muted">Típico: ${c.comisiones_tipicas[k]} %</small></div>`).join('');
    const fijos = (c.gastos_fijos.length ? c.gastos_fijos : [{ concepto: '', monto: '' }]).map(g => this.filaFijo(g, admin)).join('');
    return `
      <div class="grid grid-2">
        <div class="card"><div class="card-header"><span class="card-title"><i class="fas fa-credit-card"></i> Comisión de cada medio de pago</span></div>
          <p class="text-muted">Lo que te descuenta el banco, la tarjeta o Mercado Pago, con IVA incluido. Vienen con valores típicos: poné los de tu contrato.</p>
          <div class="grid grid-2">${medios}</div>
          <p class="text-muted">Apps de delivery: ${c.plataformas.map(p => `${esc(p.nombre)} ${p.comision} %`).join(' · ') || 'ninguna'}.
            ${App.puede('admin') ? '<a href="#" onclick="App.navigateTo(\'delivery\');return false;">Editar en Delivery</a>' : ''}</p>
          ${admin ? '<button class="btn btn-primary" onclick="Ganancias.guardarComisiones()"><i class="fas fa-save"></i> Guardar comisiones</button>' : ''}</div>
        <div class="card"><div class="card-header"><span class="card-title"><i class="fas fa-building"></i> Gastos fijos del mes</span></div>
          <p class="text-muted">Lo que pagás todos los meses aunque no vendas: alquiler, sueldos, servicios, contador, sistema. Se usan para el punto de
            equilibrio y para estimar la ganancia de cada día.</p>
          <div id="ganFijos">${fijos}</div>
          ${admin ? `<button class="btn btn-outline btn-sm" onclick="Ganancias.agregarFijo()"><i class="fas fa-plus"></i> Agregar</button>` : ''}
          <p class="mt-10">Total: <strong id="ganTotalFijos">${fmtContable(c.total_gastos_fijos)}</strong> por mes</p>
          ${admin ? '<button class="btn btn-primary" onclick="Ganancias.guardarFijos()"><i class="fas fa-save"></i> Guardar gastos fijos</button>' : ''}</div>
      </div>`;
  },
  filaFijo(g, admin = true) {
    return `<div class="gan-fijo">
      <input type="text" class="gan-fijo-concepto" placeholder="Ej: Alquiler" maxlength="60" value="${esc(g.concepto)}" aria-label="Concepto" ${admin ? '' : 'disabled'}>
      <input type="number" class="gan-fijo-monto" placeholder="Monto" min="0" step="0.01" value="${esc(g.monto)}" aria-label="Monto por mes" oninput="Ganancias.totalFijos()" ${admin ? '' : 'disabled'}>
      ${admin ? '<button class="btn btn-outline btn-sm" onclick="this.parentElement.remove(); Ganancias.totalFijos()" aria-label="Quitar"><i class="fas fa-trash"></i></button>' : ''}
    </div>`;
  },
  agregarFijo() { document.getElementById('ganFijos').insertAdjacentHTML('beforeend', this.filaFijo({ concepto: '', monto: '' })); },
  leerFijos() {
    return [...document.querySelectorAll('#ganFijos .gan-fijo')].map(f => ({
      concepto: f.querySelector('.gan-fijo-concepto').value.trim(), monto: Number(f.querySelector('.gan-fijo-monto').value) || 0
    })).filter(g => g.concepto || g.monto);
  },
  totalFijos() { document.getElementById('ganTotalFijos').textContent = fmtContable(this.leerFijos().reduce((s, g) => s + g.monto, 0)); },
  async guardarFijos() {
    try {
      await API.request('PUT', '/ganancias/config', { gastos_fijos: this.leerFijos() });
      App.showToast('Gastos fijos guardados', 'success');
      this.render();
    } catch (err) { App.showToast(err.message, 'error'); }
  },
  async guardarComisiones() {
    const comisiones = Object.fromEntries(Object.keys(this.datos.medios).map(k => [k, Number(document.getElementById('com_' + k).value) || 0]));
    try {
      await API.request('PUT', '/ganancias/config', { comisiones });
      App.showToast('Comisiones guardadas', 'success');
      this.render();
    } catch (err) { App.showToast(err.message, 'error'); }
  },

  // ===== Exportar (CSV que abre Excel) =====
  exportar() {
    const r = this.datos;
    const n = v => String(v).replace('.', ','); // Excel en español usa coma decimal
    let encabezado, filas;
    if (this.tab === 'resumen') {
      encabezado = ['Período', 'Ventas', 'Ventas netas', 'Costo', 'Comisiones', 'Ganancia bruta', 'Gastos', 'Ganancia', 'Tickets', 'Ticket promedio'];
      filas = r.periodos.map(p => [this.nombrePeriodo(p.periodo), p.ventas, p.ventas_netas, p.costo, p.comisiones, p.ganancia_bruta, p.gastos, p.ganancia, p.tickets, p.ticket_promedio]);
    } else if (this.tab === 'platos') {
      encabezado = ['Producto', 'Categoría', 'Grupo', 'Unidades', 'Ventas', 'Costo', 'Ganancia', 'Margen %', 'Ganancia por unidad'];
      filas = r.productos.map(p => [p.producto, p.categoria, r.clases[p.clase].nombre, p.unidades, p.ventas, p.costo, p.ganancia, p.margen_pct, p.ganancia_unidad]);
    } else {
      encabezado = ['Canal', 'Ventas', 'Tickets', 'Comisiones', 'Ganancia bruta', 'Margen %'];
      filas = r.canales.map(c => [c.nombre, c.ventas, c.tickets, c.comisiones, c.ganancia_bruta, c.margen_bruto_pct]);
    }
    const celda = v => typeof v === 'number' ? n(v) : `"${String(v).replace(/"/g, '""')}"`;
    const csv = '﻿' + [encabezado, ...filas].map(f => f.map(celda).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `ganancias-${this.tab}-${this.desde}-al-${this.hasta}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
};

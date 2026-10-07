// =============================================
// GASTROMANAGER - Contabilidad
// Estado de resultados, gastos, cuentas a pagar, IVA y libro diario
// =============================================

// Importes contables: con centavos se muestran los dos decimales ($ 1.325.273,55, no $ 1.325.273,6)
function fmtContable(valor) {
  const v = Math.round((Number(valor) || 0) * 100) / 100;
  return new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2
  }).format(v);
}

const Contabilidad = {
  tab: 'resultados',
  opciones: null,
  proveedores: [],
  desde: '',
  hasta: '',
  mes: '',
  filtroEstado: '',
  filtroCategoria: '',
  datos: null,

  TABS: [
    ['resultados', 'fa-chart-column', 'Estado de resultados'],
    ['gastos', 'fa-file-invoice', 'Gastos y compras'],
    ['pagar', 'fa-calendar-check', 'Cuentas a pagar'],
    ['iva', 'fa-percent', 'IVA del mes'],
    ['diario', 'fa-book', 'Libro diario']
  ],

  async render() {
    const view = document.getElementById('view-contabilidad');
    view.innerHTML = '<div class="text-center mt-20"><i class="fas fa-spinner fa-spin fa-3x"></i></div>';
    try {
      if (!this.opciones) {
        [this.opciones, this.proveedores] = await Promise.all([
          API.getContabilidadOpciones(),
          API.getProveedores().catch(() => [])
        ]);
        this.hasta = this.opciones.hoy;
        this.desde = this.opciones.hoy.slice(0, 8) + '01';
        this.mes = this.opciones.hoy.slice(0, 7);
      }
      const cargar = {
        resultados: () => API.getResultados(this.desde, this.hasta),
        gastos: () => API.getGastos({ desde: this.desde, hasta: this.hasta, estado: this.filtroEstado, categoria: this.filtroCategoria }),
        pagar: () => API.getCuentasPagar(),
        iva: () => API.getIva(this.mes),
        diario: () => API.getLibroDiario(this.desde, this.hasta)
      };
      this.datos = await cargar[this.tab]();
      this.paint(view);
    } catch (err) {
      view.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error: ${esc(err.message)}</p></div>`;
    }
  },

  setTab(tab) {
    this.tab = tab;
    this.render();
  },

  // ===== Período =====
  setPeriodo(preset) {
    const hoy = this.opciones.hoy;
    const d = new Date(hoy + 'T00:00:00');
    const iso = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    if (preset === '7') { const a = new Date(d); a.setDate(a.getDate() - 6); this.desde = iso(a); this.hasta = hoy; }
    if (preset === '30') { const a = new Date(d); a.setDate(a.getDate() - 29); this.desde = iso(a); this.hasta = hoy; }
    if (preset === 'mes') { this.desde = hoy.slice(0, 8) + '01'; this.hasta = hoy; }
    if (preset === 'anterior') {
      const fin = new Date(d.getFullYear(), d.getMonth(), 0);
      this.desde = iso(new Date(fin.getFullYear(), fin.getMonth(), 1)); this.hasta = iso(fin);
    }
    this.render();
  },

  aplicarFechas() {
    const desde = document.getElementById('contDesde').value;
    const hasta = document.getElementById('contHasta').value;
    if (desde && hasta) { this.desde = desde; this.hasta = hasta; this.render(); }
  },

  barraPeriodo() {
    const hoy = this.opciones.hoy;
    let marcado = false; // si dos atajos dan el mismo período, se marca solo el primero
    const activo = (desde, hasta) => { const si = !marcado && this.desde === desde && this.hasta === hasta; marcado = marcado || si; return si ? 'btn-primary' : 'btn-outline'; };
    const menos = n => { const x = new Date(hoy + 'T00:00:00'); x.setDate(x.getDate() - n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
    return `
      <div class="card mb-20 cont-periodo">
        <div class="cont-presets">
          <button class="btn btn-sm ${activo(menos(6), hoy)}" onclick="Contabilidad.setPeriodo('7')">Últimos 7 días</button>
          <button class="btn btn-sm ${activo(menos(29), hoy)}" onclick="Contabilidad.setPeriodo('30')">Últimos 30 días</button>
          <button class="btn btn-sm ${activo(hoy.slice(0, 8) + '01', hoy)}" onclick="Contabilidad.setPeriodo('mes')">Este mes</button>
          <button class="btn btn-sm btn-outline" onclick="Contabilidad.setPeriodo('anterior')">Mes anterior</button>
        </div>
        <div class="cont-fechas">
          <label>Desde <input type="date" id="contDesde" value="${this.desde}" onchange="Contabilidad.aplicarFechas()"></label>
          <label>Hasta <input type="date" id="contHasta" value="${this.hasta}" onchange="Contabilidad.aplicarFechas()"></label>
        </div>
      </div>`;
  },

  nombreCategoria(id) {
    const c = this.opciones.categorias.find(x => x.id === id);
    return c ? c.nombre : id;
  },

  paint(view) {
    const tabs = this.TABS.map(([id, icono, texto]) => `
      <button class="btn ${this.tab === id ? 'btn-primary' : 'btn-outline'}" onclick="Contabilidad.setTab('${id}')">
        <i class="fas ${icono}"></i> ${texto}
      </button>`).join('');
    const contenido = {
      resultados: () => this.htmlResultados(),
      gastos: () => this.htmlGastos(),
      pagar: () => this.htmlPagar(),
      iva: () => this.htmlIva(),
      diario: () => this.htmlDiario()
    }[this.tab]();
    view.innerHTML = `
      <div class="page-header">
        <div>
          <h2><i class="fas fa-calculator"></i> Contabilidad</h2>
          <p>Resultados del negocio, gastos, deudas con proveedores e IVA, listos para tu contador</p>
        </div>
        <div>
          <button class="btn btn-success" onclick="Contabilidad.nuevoGasto()"><i class="fas fa-plus"></i> Cargar gasto</button>
          <button class="btn btn-outline" onclick="Contabilidad.render()"><i class="fas fa-sync-alt"></i> Refrescar</button>
        </div>
      </div>
      <div class="filter-bar mb-20 cont-tabs">${tabs}</div>
      ${contenido}`;
  },

  stat(icono, color, valor, texto, extra = '') {
    return `
      <div class="stat-card">
        <div class="stat-icon ${color}"><i class="fas ${icono}"></i></div>
        <div class="stat-info"><h3>${valor}</h3><span>${texto}</span>${extra}</div>
      </div>`;
  },

  // ===== Estado de resultados =====
  htmlResultados() {
    const r = this.datos;
    const pct = v => r.ventas_netas > 0 ? (v / r.ventas_netas * 100).toFixed(1) + ' %' : '-';
    const fila = (texto, monto, clase = '', conPct = true) =>
      `<tr class="${clase}"><td>${texto}</td><td class="text-right">${fmtContable(monto)}</td><td class="text-right text-muted">${conPct ? pct(monto) : ''}</td></tr>`;
    const gastos = r.gastos_operativos.map(g => fila(`&nbsp;&nbsp;${esc(g.nombre)}`, -g.monto)).join('')
      || '<tr><td colspan="3" class="text-muted">&nbsp;&nbsp;Sin gastos cargados en el período</td></tr>';
    const max = Math.max(1, ...r.serie.map(d => Math.max(d.ventas, d.gastos)));
    const barras = r.serie.length <= 62 ? r.serie.map(d => `
      <div class="cont-barra" title="${fmtFecha(d.fecha)} · Ventas ${fmtContable(d.ventas)} · Gastos ${fmtContable(d.gastos)}">
        <div class="cont-barra-par">
          <span class="v" style="height:${d.ventas / max * 100}%"></span>
          <span class="g" style="height:${d.gastos / max * 100}%"></span>
        </div>
        <small>${d.fecha.slice(8)}</small>
      </div>`).join('') : '';
    const resultadoColor = r.resultado >= 0 ? 'green' : 'red';
    return `
      ${this.barraPeriodo()}
      <div class="grid grid-4 mb-20">
        ${this.stat('fa-sack-dollar', 'blue', fmtContable(r.ventas_netas), 'Ventas netas de IVA', `<small class="text-muted">${r.cantidad_ventas} cobros</small>`)}
        ${this.stat('fa-receipt', 'orange', fmtContable(r.costo_mercaderia + r.total_gastos_operativos), 'Costos y gastos')}
        ${this.stat(r.resultado >= 0 ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down', resultadoColor, fmtContable(r.resultado), 'Resultado del período', `<small class="${r.resultado >= 0 ? 'text-success' : 'text-danger'}">Margen ${r.margen_neto_pct} %</small>`)}
        ${this.stat('fa-utensils', 'purple', `${r.food_cost_real} %`, 'Costo de mercadería', `<small class="text-muted">Teórico según carta: ${r.food_cost_teorico} %</small>`)}
      </div>
      <div class="grid grid-2">
        <div class="card">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-file-lines"></i> Estado de resultados</span>
            <span class="text-muted">${fmtFecha(r.desde)} al ${fmtFecha(r.hasta)}</span>
          </div>
          <table class="cont-estado">
            <thead><tr><th></th><th class="text-right">Importe</th><th class="text-right">% ventas</th></tr></thead>
            <tbody>
              ${fila('Ventas cobradas (con IVA)', r.ventas_brutas, '', false)}
              ${r.tasa_iva ? fila(`− IVA débito fiscal (${r.tasa_iva} %)`, -r.iva_debito, 'text-muted', false) : ''}
              ${fila('Ventas netas', r.ventas_netas, 'cont-subtotal')}
              ${fila('− Mercadería e insumos', -r.costo_mercaderia)}
              ${fila('Margen bruto', r.margen_bruto, 'cont-subtotal')}
              <tr><td colspan="3" class="font-bold">Gastos operativos</td></tr>
              ${gastos}
              ${fila('Total gastos operativos', -r.total_gastos_operativos, 'cont-subtotal')}
              ${fila('Resultado del período', r.resultado, 'cont-total ' + (r.resultado >= 0 ? 'text-success' : 'text-danger'))}
            </tbody>
          </table>
          <p class="text-muted mt-10 cont-nota"><i class="fas fa-circle-info"></i>
            ${r.tasa_iva ? 'Responsable inscripto: el IVA de las facturas A es crédito fiscal y no se cuenta como gasto.' : 'Sin IVA configurado (monotributo): los gastos se toman por su total.'}
            El costo teórico sale del costo cargado en cada plato; si el real es mucho mayor, hay mermas o compras de más.</p>
        </div>
        <div class="card">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-chart-column"></i> Ventas y gastos por día</span>
            <span class="cont-leyenda"><span class="v"></span> Ventas netas <span class="g"></span> Gastos</span>
          </div>
          ${barras ? `<div class="cont-grafico">${barras}</div>` : '<p class="text-muted">Elegí un período de hasta dos meses para ver el gráfico diario.</p>'}
        </div>
      </div>`;
  },

  // ===== Gastos =====
  htmlGastos() {
    const gastos = this.datos;
    const total = gastos.reduce((s, g) => s + g.total, 0);
    const pendiente = gastos.filter(g => g.estado === 'pendiente').reduce((s, g) => s + g.total, 0);
    const cats = this.opciones.categorias.map(c => `<option value="${c.id}" ${this.filtroCategoria === c.id ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('');
    const filas = gastos.map(g => `
      <tr>
        <td>${fmtFecha(g.fecha)}</td>
        <td class="font-bold">${esc(g.descripcion)}<br><small class="text-muted">${esc(this.nombreCategoria(g.categoria))}</small></td>
        <td>${esc(g.proveedor_nombre || '-')}</td>
        <td>${esc(this.opciones.comprobantes[g.tipo_comprobante] || '')}${g.numero_comprobante ? '<br><small class="text-muted">' + esc(g.numero_comprobante) + '</small>' : ''}</td>
        <td class="text-right">${g.iva ? fmtContable(g.iva) : '-'}</td>
        <td class="text-right font-bold">${fmtContable(g.total)}</td>
        <td>${g.estado === 'pagado'
          ? `<span class="badge badge-green">Pagado</span><br><small class="text-muted">${esc(this.opciones.metodos[g.metodo_pago] || '')} ${fmtFecha(g.fecha_pago)}</small>`
          : `<span class="badge badge-orange">A pagar</span>${g.vencimiento ? `<br><small class="text-muted">Vence ${fmtFecha(g.vencimiento)}</small>` : ''}`}</td>
        <td class="cont-acciones">
          ${g.estado === 'pendiente' ? `<button class="btn btn-success btn-sm" onclick="Contabilidad.pagar(${g.id})" title="Registrar pago"><i class="fas fa-money-check-dollar"></i></button>` : ''}
          <button class="btn btn-outline btn-sm" onclick="Contabilidad.editarGasto(${g.id})" title="Editar"><i class="fas fa-edit"></i></button>
          <button class="btn btn-danger btn-sm" onclick="Contabilidad.anular(${g.id})" title="Anular"><i class="fas fa-ban"></i></button>
        </td>
      </tr>`).join('');
    return `
      ${this.barraPeriodo()}
      <div class="card">
        <div class="card-header cont-filtros">
          <span class="card-title"><i class="fas fa-file-invoice"></i> ${gastos.length} gastos · ${fmtContable(total)}${pendiente ? ` · <span class="text-warning">${fmtContable(pendiente)} a pagar</span>` : ''}</span>
          <div>
            <select onchange="Contabilidad.filtroCategoria = this.value; Contabilidad.render()">
              <option value="">Todas las categorías</option>${cats}
            </select>
            <select onchange="Contabilidad.filtroEstado = this.value; Contabilidad.render()">
              <option value="">Pagados y a pagar</option>
              <option value="pendiente" ${this.filtroEstado === 'pendiente' ? 'selected' : ''}>A pagar</option>
              <option value="pagado" ${this.filtroEstado === 'pagado' ? 'selected' : ''}>Pagados</option>
            </select>
            <button class="btn btn-outline btn-sm" onclick="Contabilidad.exportarGastos()"><i class="fas fa-file-excel"></i> Excel</button>
          </div>
        </div>
        ${gastos.length ? `
        <div class="table-wrap">
          <table>
            <thead><tr><th>Fecha</th><th>Concepto</th><th>Proveedor</th><th>Comprobante</th><th class="text-right">IVA</th><th class="text-right">Total</th><th>Estado</th><th></th></tr></thead>
            <tbody>${filas}</tbody>
          </table>
        </div>` : `<div class="empty-state"><i class="fas fa-file-invoice"></i><p>No hay gastos cargados en este período</p>
          <button class="btn btn-success" onclick="Contabilidad.nuevoGasto()"><i class="fas fa-plus"></i> Cargar el primero</button></div>`}
      </div>`;
  },

  // ===== Cuentas a pagar =====
  htmlPagar() {
    const d = this.datos;
    const vence = g => g.dias_para_vencer < 0 ? `<span class="badge badge-red">Vencida hace ${-g.dias_para_vencer} d</span>`
      : g.dias_para_vencer === 0 ? '<span class="badge badge-orange">Vence hoy</span>'
        : g.dias_para_vencer <= 7 ? `<span class="badge badge-orange">En ${g.dias_para_vencer} días</span>`
          : `<span class="badge badge-gray">En ${g.dias_para_vencer} días</span>`;
    const filas = d.gastos.map(g => `
      <tr>
        <td>${fmtFecha(g.vencimiento || g.fecha)}</td>
        <td>${vence(g)}</td>
        <td class="font-bold">${esc(g.proveedor_nombre || '-')}</td>
        <td>${esc(g.descripcion)}${g.numero_comprobante ? `<br><small class="text-muted">${esc(this.opciones.comprobantes[g.tipo_comprobante] || '')} ${esc(g.numero_comprobante)}</small>` : ''}</td>
        <td class="text-right font-bold">${fmtContable(g.total)}</td>
        <td><button class="btn btn-success btn-sm" onclick="Contabilidad.pagar(${g.id})"><i class="fas fa-money-check-dollar"></i> Pagar</button></td>
      </tr>`).join('');
    const provs = d.por_proveedor.map(p => `<tr><td>${esc(p.proveedor)}</td><td>${p.cantidad}</td><td class="text-right font-bold">${fmtContable(p.total)}</td></tr>`).join('');
    return `
      <div class="grid grid-3 mb-20">
        ${this.stat('fa-file-invoice-dollar', 'blue', fmtContable(d.total), 'Deuda total con proveedores')}
        ${this.stat('fa-triangle-exclamation', 'red', fmtContable(d.vencido), 'Vencido')}
        ${this.stat('fa-calendar-week', 'orange', fmtContable(d.proximos_7_dias), 'Vence en los próximos 7 días')}
      </div>
      <div class="grid cont-pagar">
        <div class="card">
          <div class="card-header"><span class="card-title"><i class="fas fa-calendar-check"></i> Vencimientos</span></div>
          ${d.gastos.length ? `<div class="table-wrap"><table>
            <thead><tr><th>Vence</th><th></th><th>Proveedor</th><th>Concepto</th><th class="text-right">Importe</th><th></th></tr></thead>
            <tbody>${filas}</tbody></table></div>`
          : '<div class="empty-state"><i class="fas fa-circle-check"></i><p>No hay deudas pendientes</p></div>'}
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title"><i class="fas fa-truck"></i> Por proveedor</span></div>
          ${provs ? `<table><thead><tr><th>Proveedor</th><th>Comp.</th><th class="text-right">Saldo</th></tr></thead><tbody>${provs}</tbody></table>` : '<p class="text-muted">Sin saldos</p>'}
        </div>
      </div>`;
  },

  // ===== IVA =====
  htmlIva() {
    const d = this.datos;
    const facturas = d.ventas.facturas.length
      ? d.ventas.facturas.map(f => `${f.cantidad} ${esc(f.tipo || 'comprobantes')} por ${fmtContable(f.total)}`).join(' · ')
      : 'Sin facturas electrónicas emitidas este mes';
    const compras = d.compras.comprobantes.map(g => `
      <tr>
        <td>${fmtFecha(g.fecha)}</td>
        <td>${esc(g.proveedor_nombre || '-')}<br><small class="text-muted">${esc(g.proveedor_cuit || '')}</small></td>
        <td>${esc(this.opciones.comprobantes[g.tipo_comprobante] || '')} ${esc(g.numero_comprobante || '')}</td>
        <td class="text-right">${fmtContable(g.neto)}</td>
        <td class="text-right">${fmtContable(g.iva)}</td>
        <td class="text-right">${fmtContable(g.total)}</td>
      </tr>`).join('');
    const aPagar = d.saldo >= 0;
    return `
      <div class="card mb-20 cont-periodo">
        <div class="cont-fechas">
          <label>Mes <input type="month" id="contMes" value="${this.mes}" onchange="Contabilidad.mes = this.value; Contabilidad.render()"></label>
        </div>
        <button class="btn btn-outline btn-sm" onclick="Contabilidad.exportarIva()"><i class="fas fa-file-excel"></i> Libro IVA compras (Excel)</button>
      </div>
      ${d.tasa_iva ? '' : '<div class="card mb-20"><p class="text-muted"><i class="fas fa-circle-info"></i> La tasa de IVA está en 0 % (monotributo) en Configuración: no hay débito fiscal sobre las ventas.</p></div>'}
      <div class="grid grid-3 mb-20">
        ${this.stat('fa-arrow-up', 'blue', fmtContable(d.ventas.iva), 'IVA débito (ventas)', `<small class="text-muted">Sobre ${fmtContable(d.ventas.brutas)} cobrados</small>`)}
        ${this.stat('fa-arrow-down', 'green', fmtContable(d.compras.iva), 'IVA crédito (compras)', `<small class="text-muted">${d.compras.comprobantes.length} facturas A</small>`)}
        ${this.stat('fa-scale-balanced', aPagar ? 'orange' : 'green', fmtContable(Math.abs(d.saldo)), aPagar ? 'Saldo estimado a pagar' : 'Saldo técnico a favor')}
      </div>
      <div class="card">
        <div class="card-header">
          <span class="card-title"><i class="fas fa-book-open"></i> IVA compras</span>
          <span class="text-muted">${facturas}</span>
        </div>
        ${compras ? `<div class="table-wrap"><table>
          <thead><tr><th>Fecha</th><th>Proveedor / CUIT</th><th>Comprobante</th><th class="text-right">Neto</th><th class="text-right">IVA</th><th class="text-right">Total</th></tr></thead>
          <tbody>${compras}</tbody>
          <tfoot><tr><td colspan="3" class="font-bold">Total</td><td class="text-right font-bold">${fmtContable(d.compras.neto)}</td><td class="text-right font-bold">${fmtContable(d.compras.iva)}</td><td></td></tr></tfoot>
        </table></div>` : '<p class="text-muted">No hay facturas A de compras cargadas este mes.</p>'}
        <p class="text-muted mt-10 cont-nota"><i class="fas fa-circle-info"></i> Es una estimación para planificar el pago: el débito se calcula sobre lo cobrado con la tasa configurada. La declaración jurada la confirma tu contador.</p>
      </div>`;
  },

  // ===== Libro diario =====
  htmlDiario() {
    const d = this.datos;
    const asientos = d.asientos.slice(-300).reverse().map(a => `
      <tbody class="cont-asiento">
        <tr class="cont-asiento-cab"><td>N° ${a.numero}</td><td>${fmtFecha(a.fecha)}</td><td colspan="3">${esc(a.concepto)}</td></tr>
        ${a.lineas.map(l => `<tr>
          <td></td><td class="text-muted">${l.codigo}</td>
          <td class="${l.haber ? 'cont-haber' : ''}">${esc(l.cuenta)}</td>
          <td class="text-right">${l.debe ? fmtContable(l.debe) : ''}</td>
          <td class="text-right">${l.haber ? fmtContable(l.haber) : ''}</td>
        </tr>`).join('')}
      </tbody>`).join('');
    const balance = d.balance.map(c => `
      <tr><td class="text-muted">${c.codigo}</td><td>${esc(c.cuenta)}</td>
        <td class="text-right">${fmtContable(c.debe)}</td><td class="text-right">${fmtContable(c.haber)}</td>
        <td class="text-right font-bold">${c.saldo >= 0 ? fmtContable(c.saldo) + ' D' : fmtContable(-c.saldo) + ' H'}</td></tr>`).join('');
    const cuadra = Math.abs(d.total_debe - d.total_haber) < 0.01;
    return `
      ${this.barraPeriodo()}
      <div class="cont-diario">
        <div class="card">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-scale-balanced"></i> Sumas y saldos</span>
            ${cuadra ? '<span class="badge badge-green">Debe = Haber</span>' : '<span class="badge badge-red">No balancea</span>'}
          </div>
          <div class="table-wrap"><table>
            <thead><tr><th>Cuenta</th><th></th><th class="text-right">Debe</th><th class="text-right">Haber</th><th class="text-right">Saldo</th></tr></thead>
            <tbody>${balance}</tbody>
            <tfoot><tr><td></td><td class="font-bold">Totales</td><td class="text-right font-bold">${fmtContable(d.total_debe)}</td><td class="text-right font-bold">${fmtContable(d.total_haber)}</td><td></td></tr></tfoot>
          </table></div>
          <p class="text-muted mt-10 cont-nota"><i class="fas fa-circle-info"></i> Los asientos se generan solos a partir de los cobros, los gastos cargados y los movimientos de caja.</p>
        </div>
        <div class="card">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-book"></i> Libro diario · ${d.asientos.length} asientos</span>
            <button class="btn btn-outline btn-sm" onclick="Contabilidad.exportarDiario()"><i class="fas fa-file-excel"></i> Excel</button>
          </div>
          ${d.asientos.length ? `<div class="table-wrap"><table class="cont-libro">
            <thead><tr><th>Asiento</th><th>Fecha / Cuenta</th><th>Concepto</th><th class="text-right">Debe</th><th class="text-right">Haber</th></tr></thead>
            ${asientos}
          </table></div>${d.asientos.length > 300 ? '<p class="text-muted mt-10">Se muestran los últimos 300 asientos; el Excel tiene todos.</p>' : ''}`
          : '<div class="empty-state"><i class="fas fa-book"></i><p>Sin movimientos en el período</p></div>'}
        </div>
      </div>`;
  },

  // ===== Alta y edición de gastos =====
  nuevoGasto() {
    this.abrirForm(null);
  },

  async editarGasto(id) {
    const g = (Array.isArray(this.datos) ? this.datos : []).find(x => x.id === id);
    if (g) this.abrirForm(g);
  },

  abrirForm(g) {
    const o = this.opciones;
    const opt = (lista, actual) => Object.entries(lista).map(([v, t]) => `<option value="${v}" ${actual === v ? 'selected' : ''}>${esc(t)}</option>`).join('');
    const cats = o.categorias.map(c => `<option value="${c.id}" ${g && g.categoria === c.id ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('');
    const provs = this.proveedores.map(p => `<option value="${p.id}" ${g && g.proveedor_id === p.id ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('');
    const pagado = g && g.estado === 'pagado';
    App.showModal(`
      <form onsubmit="Contabilidad.guardar(event, ${g ? g.id : 'null'})" id="formGasto">
        <div class="grid grid-2">
          <div class="form-group"><label>Fecha del comprobante</label><input type="date" id="gasFecha" value="${g ? g.fecha : o.hoy}" required></div>
          <div class="form-group"><label>Categoría</label><select id="gasCategoria" required>${cats}</select></div>
        </div>
        <div class="form-group"><label>Descripción</label><input type="text" id="gasDescripcion" maxlength="200" placeholder="Ej.: Compra de carne, factura de luz" value="${g ? esc(g.descripcion) : ''}" required></div>
        <div class="grid grid-2">
          <div class="form-group"><label>Proveedor</label><select id="gasProveedor"><option value="">Sin proveedor</option>${provs}</select></div>
          <div class="form-group"><label>Comprobante</label>
            <div class="cont-comprobante">
              <select id="gasTipo" onchange="Contabilidad.actualizarForm()">${opt(o.comprobantes, g ? g.tipo_comprobante : 'factura_a')}</select>
              <input type="text" id="gasNumero" placeholder="0001-00001234" value="${g ? esc(g.numero_comprobante || '') : ''}">
            </div>
          </div>
        </div>
        <div class="grid grid-3">
          <div class="form-group"><label id="gasNetoLabel">Neto gravado</label><input type="number" id="gasNeto" min="0" step="0.01" value="${g ? g.neto : ''}" oninput="Contabilidad.actualizarForm(true)" required></div>
          <div class="form-group" id="gasIvaGrupo"><label>IVA</label><input type="number" id="gasIva" min="0" step="0.01" value="${g ? g.iva : ''}" oninput="Contabilidad.actualizarForm()"></div>
          <div class="form-group"><label>Percepciones / otros</label><input type="number" id="gasOtros" min="0" step="0.01" value="${g ? g.otros_impuestos || '' : ''}" oninput="Contabilidad.actualizarForm()"></div>
        </div>
        <p class="cont-total-form">Total del comprobante: <strong id="gasTotal">${fmtContable(g ? g.total : 0)}</strong></p>
        ${pagado ? '<p class="text-muted"><i class="fas fa-circle-check"></i> Este gasto ya está pagado.</p>' : `
        <div class="grid grid-2">
          <div class="form-group"><label>Vencimiento</label><input type="date" id="gasVence" value="${g && g.vencimiento ? g.vencimiento : ''}"></div>
          ${g ? '' : `<div class="form-group"><label class="cont-check"><input type="checkbox" id="gasPagado" onchange="Contabilidad.actualizarForm()"> Ya está pagado</label></div>`}
        </div>
        ${g ? '' : `<div class="grid grid-2" id="gasPagoGrupo" style="display:none">
          <div class="form-group"><label>Medio de pago</label><select id="gasMetodo" onchange="Contabilidad.actualizarForm()">${opt(o.metodos, 'efectivo')}</select></div>
          <div class="form-group" id="gasCajaGrupo"><label class="cont-check"><input type="checkbox" id="gasDesdeCaja"> Sacar el efectivo de la caja abierta</label></div>
        </div>`}`}
        <div class="modal-footer">
          <button type="button" class="btn btn-danger" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-success">Guardar</button>
        </div>
      </form>
    `, { title: g ? 'Editar gasto' : 'Cargar gasto o compra' });
    this.actualizarForm();
  },

  // Factura A: neto + IVA (se sugiere la tasa configurada). Otros comprobantes: un solo importe.
  actualizarForm(cambioNeto) {
    const tipo = document.getElementById('gasTipo').value;
    const esA = tipo === 'factura_a';
    document.getElementById('gasIvaGrupo').style.display = esA ? '' : 'none';
    document.getElementById('gasNetoLabel').textContent = esA ? 'Neto gravado' : 'Importe';
    const neto = Number(document.getElementById('gasNeto').value) || 0;
    const ivaInput = document.getElementById('gasIva');
    if (!esA) ivaInput.value = '';
    else if (cambioNeto && this.opciones.tasa_iva) ivaInput.value = (Math.round(neto * this.opciones.tasa_iva) / 100).toFixed(2);
    const total = neto + (esA ? Number(ivaInput.value) || 0 : 0) + (Number(document.getElementById('gasOtros').value) || 0);
    document.getElementById('gasTotal').textContent = fmtContable(total);
    const pagado = document.getElementById('gasPagado');
    if (pagado) {
      document.getElementById('gasPagoGrupo').style.display = pagado.checked ? '' : 'none';
      const efectivo = document.getElementById('gasMetodo').value === 'efectivo';
      document.getElementById('gasCajaGrupo').style.display = efectivo && App.puede('caja.operar') ? '' : 'none';
      if (!efectivo) document.getElementById('gasDesdeCaja').checked = false;
    }
  },

  async guardar(e, id) {
    e.preventDefault();
    const val = i => { const el = document.getElementById(i); return el ? el.value : undefined; };
    const data = {
      fecha: val('gasFecha'), categoria: val('gasCategoria'), descripcion: val('gasDescripcion'),
      proveedor_id: val('gasProveedor') || null, tipo_comprobante: val('gasTipo'), numero_comprobante: val('gasNumero'),
      neto: Number(val('gasNeto')) || 0, iva: val('gasTipo') === 'factura_a' ? Number(val('gasIva')) || 0 : 0,
      otros_impuestos: Number(val('gasOtros')) || 0
    };
    if (val('gasVence') !== undefined) data.vencimiento = val('gasVence') || null;
    const pagado = document.getElementById('gasPagado');
    if (pagado && pagado.checked) {
      Object.assign(data, { pagado: true, metodo_pago: val('gasMetodo'), fecha_pago: data.fecha,
        desde_caja: document.getElementById('gasDesdeCaja').checked });
      if (data.fecha_pago > this.opciones.hoy) data.fecha_pago = this.opciones.hoy;
    }
    try {
      if (id) await API.updateGasto(id, data);
      else await API.createGasto(data);
      App.showToast(id ? 'Gasto actualizado' : 'Gasto registrado', 'success');
      App.closeModal();
      this.render();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  // ===== Pago y anulación =====
  pagar(id) {
    const lista = Array.isArray(this.datos) ? this.datos : (this.datos.gastos || []);
    const g = lista.find(x => x.id === id);
    if (!g) return;
    const o = this.opciones;
    const metodos = Object.entries(o.metodos).map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('');
    App.showModal(`
      <form onsubmit="Contabilidad.confirmarPago(event, ${id})">
        <p class="mb-10"><strong>${esc(g.descripcion)}</strong>${g.proveedor_nombre ? ' · ' + esc(g.proveedor_nombre) : ''}</p>
        <p class="cont-total-form mb-20">Importe: <strong>${fmtContable(g.total)}</strong></p>
        <div class="grid grid-2">
          <div class="form-group"><label>Medio de pago</label>
            <select id="pagMetodo" onchange="document.getElementById('pagCajaGrupo').style.display = this.value === 'efectivo' && App.puede('caja.operar') ? '' : 'none'">${metodos}</select></div>
          <div class="form-group"><label>Fecha de pago</label><input type="date" id="pagFecha" value="${o.hoy}" min="${g.fecha}" max="${o.hoy}" required></div>
        </div>
        <div class="form-group" id="pagCajaGrupo" style="${App.puede('caja.operar') ? '' : 'display:none'}">
          <label class="cont-check"><input type="checkbox" id="pagDesdeCaja"> Sacar el efectivo de la caja abierta (queda como egreso en el arqueo)</label>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-danger" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-success"><i class="fas fa-check"></i> Registrar pago</button>
        </div>
      </form>`, { title: 'Registrar pago' });
  },

  async confirmarPago(e, id) {
    e.preventDefault();
    const metodo = document.getElementById('pagMetodo').value;
    try {
      await API.pagarGasto(id, {
        metodo_pago: metodo, fecha_pago: document.getElementById('pagFecha').value,
        desde_caja: metodo === 'efectivo' && document.getElementById('pagDesdeCaja').checked
      });
      App.showToast('Pago registrado', 'success');
      App.closeModal();
      this.render();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  async anular(id) {
    if (!confirm('¿Anular este gasto? Deja de contarse en los resultados y en el IVA.')) return;
    try {
      await API.anularGasto(id);
      App.showToast('Gasto anulado', 'success');
      this.render();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  // ===== Exportar para el contador (CSV con ; y BOM, abre directo en Excel) =====
  descargar(nombre, filas) {
    if (!filas.length) { App.showToast('No hay datos para exportar', 'warning'); return; }
    const cab = Object.keys(filas[0]);
    const celda = v => {
      const s = v === null || v === undefined ? '' : (typeof v === 'number' ? String(v).replace('.', ',') : String(v));
      return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const csv = '﻿' + [cab.join(';')].concat(filas.map(f => cab.map(c => celda(f[c])).join(';'))).join('\n');
    Reportes._descargarContenido(csv, nombre, 'text/csv;charset=utf-8;');
    App.showToast('Archivo exportado', 'success');
  },

  exportarGastos() {
    this.descargar(`gastos-${this.desde}-al-${this.hasta}.csv`, this.datos.map(g => ({
      Fecha: g.fecha, Categoria: this.nombreCategoria(g.categoria), Descripcion: g.descripcion,
      Proveedor: g.proveedor_nombre || '', CUIT: g.proveedor_cuit || '',
      Comprobante: this.opciones.comprobantes[g.tipo_comprobante] || '', Numero: g.numero_comprobante,
      Neto: g.neto, IVA: g.iva, Otros: g.otros_impuestos, Total: g.total,
      Estado: g.estado === 'pagado' ? 'Pagado' : 'A pagar', Vencimiento: g.vencimiento || '',
      'Fecha de pago': g.fecha_pago || '', 'Medio de pago': this.opciones.metodos[g.metodo_pago] || ''
    })));
  },

  exportarIva() {
    this.descargar(`iva-compras-${this.mes}.csv`, this.datos.compras.comprobantes.map(g => ({
      Fecha: g.fecha, Proveedor: g.proveedor_nombre || '', CUIT: g.proveedor_cuit || '',
      Comprobante: this.opciones.comprobantes[g.tipo_comprobante] || '', Numero: g.numero_comprobante,
      Neto: g.neto, IVA: g.iva, Otros: g.otros_impuestos, Total: g.total
    })));
  },

  exportarDiario() {
    const filas = [];
    for (const a of this.datos.asientos) for (const l of a.lineas) {
      filas.push({ Asiento: a.numero, Fecha: a.fecha, Concepto: a.concepto, Codigo: l.codigo, Cuenta: l.cuenta, Debe: l.debe, Haber: l.haber });
    }
    this.descargar(`libro-diario-${this.desde}-al-${this.hasta}.csv`, filas);
  }
};

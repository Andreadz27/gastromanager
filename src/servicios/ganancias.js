'use strict';
// Ganancias del negocio: cuánto queda de lo que se vende, por día, semana, mes o año; por plato, canal, medio de
// pago, horario y mozo; qué se come la ganancia, y cuánto hay que vender para no perder plata.
// Definiciones (las mismas en toda la sección y en la pantalla):
// - Ventas: lo cobrado de los pedidos pagados, sin propina (es del personal). Día: el del cierre del pedido.
// - Ventas netas: sin el IVA que contienen (solo si el negocio discrimina IVA: configuracion.tasa_iva > 0).
// - Costo de lo vendido: cantidad × costo actual de cada producto (ficha o receta). Los productos vendidos sin
//   costo cargado se listan aparte: con ellos la ganancia sale más alta de lo real.
// - Comisiones: % de cada medio de pago (editable; sin cargar = típicos) y % de la app de delivery del pedido.
// - Ganancia bruta = ventas netas − costo − comisiones.
// - Gastos: los cargados en Contabilidad, sin mercadería (ya está en el costo) ni comisiones (ya estimadas),
//   más los egresos de caja sueltos. Ganancia = ganancia bruta − gastos.
// - Gastos fijos del mes (configurables): para el punto de equilibrio y la ganancia estimada de hoy.
const { get, all, run } = require('../db');
const { LOCAL, fechaLocal, ZONA_HORARIA } = require('../tiempo');
const { errorHttp } = require('../util');

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const pct = (parte, total) => total > 0 ? Math.round(parte / total * 1000) / 10 : 0;

// Valores típicos en Argentina (octubre 2026), con IVA de la comisión incluido. Cada local los ajusta.
const COMISIONES_TIPICAS = { efectivo: 0, tarjeta: 3, mercadopago: 4, transferencia: 0, giftcard: 0, otro: 0 };
const MEDIOS = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', mercadopago: 'Mercado Pago', transferencia: 'Transferencia',
  giftcard: 'Gift card', otro: 'Otro' };
const CANALES = { salon: 'Salón', takeaway: 'Para llevar', delivery: 'Delivery propio' };
const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

const leerJson = (texto, def) => { try { const v = JSON.parse(texto); return v == null ? def : v; } catch (e) { return def; } };

async function configGanancias() {
  const c = await get('SELECT tasa_iva, comisiones_pago, gastos_fijos FROM configuracion WHERE id = 1') || {};
  const propias = leerJson(c.comisiones_pago, {});
  const comisiones = Object.fromEntries(Object.keys(COMISIONES_TIPICAS).map(m =>
    [m, Number.isFinite(Number(propias[m])) && propias[m] !== '' && propias[m] != null ? Number(propias[m]) : COMISIONES_TIPICAS[m]]));
  const gastosFijos = (Array.isArray(leerJson(c.gastos_fijos, [])) ? leerJson(c.gastos_fijos, []) : [])
    .map(g => ({ concepto: String(g.concepto || ''), monto: r2(g.monto) }));
  const plataformas = await all('SELECT nombre, comision FROM plataformas_delivery ORDER BY nombre');
  const tasa = Number(c.tasa_iva) > 0 ? Number(c.tasa_iva) : 0;
  return { comisiones, comisiones_tipicas: COMISIONES_TIPICAS, medios: MEDIOS, gastos_fijos: gastosFijos,
    total_gastos_fijos: r2(gastosFijos.reduce((s, g) => s + g.monto, 0)), tasa_iva: tasa,
    plataformas: plataformas.map(p => ({ nombre: p.nombre, comision: Number(p.comision) || 0 })) };
}

async function guardarConfigGanancias({ comisiones, gastos_fijos: fijos } = {}) {
  const sets = [], valores = [];
  if (comisiones !== undefined) {
    if (!comisiones || typeof comisiones !== 'object') throw errorHttp(400, 'Comisiones inválidas');
    const limpias = {};
    for (const [m, v] of Object.entries(comisiones)) {
      if (!MEDIOS[m]) throw errorHttp(400, `Medio de pago desconocido: ${m}`);
      const n = Number(v);
      if (!(n >= 0 && n <= 50)) throw errorHttp(400, `La comisión de ${MEDIOS[m]} tiene que estar entre 0 y 50 %`);
      limpias[m] = r2(n);
    }
    sets.push('comisiones_pago = ?'); valores.push(JSON.stringify(limpias));
  }
  if (fijos !== undefined) {
    if (!Array.isArray(fijos) || fijos.length > 40) throw errorHttp(400, 'Gastos fijos inválidos (hasta 40)');
    const limpios = fijos.map(g => {
      const concepto = String((g && g.concepto) || '').trim().slice(0, 60);
      const monto = Number(g && g.monto);
      if (!concepto) throw errorHttp(400, 'Cada gasto fijo necesita un concepto');
      if (!(monto >= 0 && monto < 1e10)) throw errorHttp(400, `Monto inválido en "${concepto}"`);
      return { concepto, monto: r2(monto) };
    });
    sets.push('gastos_fijos = ?'); valores.push(JSON.stringify(limpios));
  }
  if (sets.length) await run(`UPDATE configuracion SET ${sets.join(', ')} WHERE id = 1`, valores);
  return configGanancias();
}

// ---------- Datos base ----------

const DIA = () => `date(COALESCE(p.cerrado_en, p.creado_en), ${LOCAL()})`;

// Pedidos pagados del período con su costo, comisiones y ganancia bruta
async function pedidosDelPeriodo(desde, hasta, cfg) {
  const pedidos = await all(`
    SELECT p.id, p.tipo, p.usuario_id, u.nombre AS mozo, p.total, p.propina, p.descuento, p.descuento_puntos, p.descuento_cupon,
      ${DIA()} AS dia, CAST(strftime('%H', COALESCE(p.cerrado_en, p.creado_en), ${LOCAL()}) AS INTEGER) AS hora,
      CAST(strftime('%w', COALESCE(p.cerrado_en, p.creado_en), ${LOCAL()}) AS INTEGER) AS dow,
      (SELECT e.plataforma FROM entregas e WHERE e.pedido_id = p.id AND e.plataforma <> '' LIMIT 1) AS plataforma,
      (SELECT COALESCE(SUM(pi.cantidad * COALESCE(pr.costo, 0)), 0) FROM pedido_items pi
        LEFT JOIN productos pr ON pr.id = pi.producto_id WHERE pi.pedido_id = p.id) AS costo
    FROM pedidos p LEFT JOIN usuarios u ON u.id = p.usuario_id
    WHERE p.estado = 'pagado' AND ${DIA()} BETWEEN ? AND ?`, [desde, hasta]);
  const pagos = await all(`SELECT pg.pedido_id, pg.metodo, SUM(pg.monto) AS monto FROM pagos pg JOIN pedidos p ON p.id = pg.pedido_id
    WHERE p.estado = 'pagado' AND ${DIA()} BETWEEN ? AND ? GROUP BY pg.pedido_id, pg.metodo`, [desde, hasta]);
  const porPedido = new Map();
  for (const pg of pagos) { if (!porPedido.has(pg.pedido_id)) porPedido.set(pg.pedido_id, []); porPedido.get(pg.pedido_id).push(pg); }
  const app = Object.fromEntries(cfg.plataformas.map(x => [x.nombre, x.comision]));
  return pedidos.map(p => {
    const venta = r2((Number(p.total) || 0) - (Number(p.propina) || 0));
    const iva = cfg.tasa_iva > 0 ? r2(venta - venta / (1 + cfg.tasa_iva / 100)) : 0;
    const medios = (porPedido.get(p.id) || []).map(x => ({ metodo: x.metodo, monto: r2(x.monto),
      comision: r2(x.monto * (cfg.comisiones[x.metodo] || 0) / 100) }));
    const comisionPago = r2(medios.reduce((s, m) => s + m.comision, 0));
    const comisionApp = p.plataforma ? r2(venta * (app[p.plataforma] || 0) / 100) : 0;
    const costo = r2(p.costo);
    return { ...p, venta, iva, neto: r2(venta - iva), costo, medios, comision_pago: comisionPago, comision_app: comisionApp,
      comisiones: r2(comisionPago + comisionApp), descuentos: r2((+p.descuento || 0) + (+p.descuento_puntos || 0) + (+p.descuento_cupon || 0)),
      bruta: r2(venta - iva - costo - comisionPago - comisionApp) };
  });
}

// Gastos del período (sin mercadería ni comisiones) y egresos de caja sueltos, por día
async function gastosDelPeriodo(desde, hasta, tasa) {
  const gastos = await all(`SELECT fecha AS dia, categoria, total, iva FROM gastos
    WHERE anulado = 0 AND fecha BETWEEN ? AND ? AND categoria NOT IN ('mercaderia', 'comisiones')`, [desde, hasta]);
  const sueltos = await all(`SELECT date(m.fecha, ${LOCAL()}) AS dia, m.monto FROM movimientos_caja m
    WHERE m.tipo = 'egreso' AND date(m.fecha, ${LOCAL()}) BETWEEN ? AND ?
      AND m.id NOT IN (SELECT caja_movimiento_id FROM gastos WHERE caja_movimiento_id IS NOT NULL)
      AND m.id NOT IN (SELECT caja_movimiento_id FROM repartos_propinas WHERE caja_movimiento_id IS NOT NULL)
      AND m.id NOT IN (SELECT caja_movimiento_id FROM gift_cards WHERE caja_movimiento_id IS NOT NULL)`, [desde, hasta]);
  return [...gastos.map(g => ({ dia: g.dia, monto: r2(tasa > 0 ? g.total - g.iva : g.total) })), ...sueltos.map(m => ({ dia: m.dia, monto: r2(m.monto) }))];
}

function sumar(lista) {
  const t = { ventas: 0, iva: 0, ventas_netas: 0, costo: 0, comisiones: 0, descuentos: 0, ganancia_bruta: 0, tickets: 0, propinas: 0 };
  for (const p of lista) {
    t.ventas += p.venta; t.iva += p.iva; t.ventas_netas += p.neto; t.costo += p.costo; t.comisiones += p.comisiones;
    t.descuentos += p.descuentos; t.ganancia_bruta += p.bruta; t.tickets++; t.propinas += Number(p.propina) || 0;
  }
  for (const k of Object.keys(t)) if (k !== 'tickets') t[k] = r2(t[k]);
  t.ticket_promedio = t.tickets ? r2(t.ventas / t.tickets) : 0;
  t.margen_bruto_pct = pct(t.ganancia_bruta, t.ventas_netas);
  t.costo_pct = pct(t.costo, t.ventas_netas);
  return t;
}

// ---------- Períodos ----------

const sumarDias = (fecha, n) => new Date(Date.parse(fecha + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const diasEntre = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
const lunes = dia => sumarDias(dia, -((new Date(dia + 'T12:00:00Z').getUTCDay() + 6) % 7));
const diasDelMes = mes => new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).getUTCDate();
const AGRUPAR = {
  dia: d => d,
  semana: d => lunes(d),
  mes: d => d.slice(0, 7),
  anio: d => d.slice(0, 4)
};
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

function validarPeriodo(desde, hasta) {
  const hoy = fechaLocal();
  desde = desde || hoy.slice(0, 8) + '01';
  hasta = hasta || hoy;
  if (!FECHA.test(desde) || !FECHA.test(hasta) || isNaN(Date.parse(desde)) || isNaN(Date.parse(hasta))) throw errorHttp(400, 'Fechas inválidas (AAAA-MM-DD)');
  if (desde > hasta) throw errorHttp(400, 'La fecha "desde" es posterior a "hasta"');
  if (diasEntre(desde, hasta) > 3 * 366) throw errorHttp(400, 'El período puede ser de hasta 3 años');
  return { desde, hasta };
}

async function totales(desde, hasta, cfg) {
  const pedidos = await pedidosDelPeriodo(desde, hasta, cfg);
  const gastos = await gastosDelPeriodo(desde, hasta, cfg.tasa_iva);
  const t = sumar(pedidos);
  t.gastos = r2(gastos.reduce((s, g) => s + g.monto, 0));
  t.ganancia = r2(t.ganancia_bruta - t.gastos);
  t.margen_neto_pct = pct(t.ganancia, t.ventas_netas);
  return { t, pedidos, gastos };
}

const variacion = (actual, anterior) => anterior ? Math.round((actual - anterior) / Math.abs(anterior) * 1000) / 10 : null;

// Resumen del período agrupado por día, semana, mes o año, comparado con el período anterior y el año pasado
async function resumenGanancias({ desde, hasta, agrupar = 'dia' } = {}) {
  ({ desde, hasta } = validarPeriodo(desde, hasta));
  if (!AGRUPAR[agrupar]) throw errorHttp(400, 'Agrupar por dia, semana, mes o anio');
  const cfg = await configGanancias();
  const { t, pedidos, gastos } = await totales(desde, hasta, cfg);

  const clave = AGRUPAR[agrupar];
  const filas = new Map();
  // Todos los períodos aunque no haya ventas (un día sin ventas también cuenta)
  for (let d = desde, n = 0; d <= hasta && n < 1200; d = sumarDias(d, 1), n++) if (!filas.has(clave(d))) filas.set(clave(d), { pedidos: [], gastos: 0 });
  for (const p of pedidos) filas.get(clave(p.dia)).pedidos.push(p);
  for (const g of gastos) { const f = filas.get(clave(g.dia)); if (f) f.gastos += g.monto; }
  const periodos = [...filas.entries()].map(([periodo, f]) => {
    const s = sumar(f.pedidos);
    return { periodo, ventas: s.ventas, ventas_netas: s.ventas_netas, costo: s.costo, comisiones: s.comisiones,
      ganancia_bruta: s.ganancia_bruta, gastos: r2(f.gastos), ganancia: r2(s.ganancia_bruta - f.gastos), tickets: s.tickets,
      ticket_promedio: s.ticket_promedio, margen_bruto_pct: s.margen_bruto_pct };
  });

  const largo = diasEntre(desde, hasta);
  const antDesde = sumarDias(desde, -(largo + 1)), antHasta = sumarDias(desde, -1);
  const anioAnt = f => `${Number(f.slice(0, 4)) - 1}${f.slice(4)}`.replace(/-02-29$/, '-02-28');
  const anterior = (await totales(antDesde, antHasta, cfg)).t;
  const anioPasado = (await totales(anioAnt(desde), anioAnt(hasta), cfg)).t;
  const comparar = x => ({ desde: x.desde, hasta: x.hasta, ventas: x.t.ventas, ganancia_bruta: x.t.ganancia_bruta, ganancia: x.t.ganancia,
    variacion_ventas: variacion(t.ventas, x.t.ventas), variacion_ganancia: variacion(t.ganancia, x.t.ganancia) });

  // Productos vendidos sin costo cargado: la ganancia sale inflada
  const sinCosto = await all(`SELECT pi.nombre_producto AS producto, SUM(pi.cantidad) AS unidades, SUM(pi.subtotal) AS ventas
    FROM pedido_items pi JOIN pedidos p ON p.id = pi.pedido_id LEFT JOIN productos pr ON pr.id = pi.producto_id
    WHERE p.estado = 'pagado' AND ${DIA()} BETWEEN ? AND ? AND COALESCE(pr.costo, 0) <= 0
    GROUP BY pi.nombre_producto ORDER BY ventas DESC LIMIT 15`, [desde, hasta]);

  return { desde, hasta, agrupar, totales: t, periodos,
    comparacion: { anterior: comparar({ desde: antDesde, hasta: antHasta, t: anterior }),
      anio_pasado: comparar({ desde: anioAnt(desde), hasta: anioAnt(hasta), t: anioPasado }) },
    sin_costo: sinCosto.map(x => ({ ...x, ventas: r2(x.ventas) })),
    tasa_iva: cfg.tasa_iva };
}

// ---------- Por plato y categoría (ingeniería de menú) ----------
// Popularidad: se vende más que el 70 % del promedio. Rentabilidad: deja por unidad más que el promedio ponderado.
const CLASES = {
  estrella: { nombre: 'Estrella', consejo: 'Se vende mucho y deja buena ganancia: cuidalo, que esté siempre y bien visible en la carta.' },
  caballo: { nombre: 'Caballo de batalla', consejo: 'Se vende mucho pero deja poco: subí un poco el precio o bajá el costo de la receta.' },
  rompecabezas: { nombre: 'Rompecabezas', consejo: 'Deja buena ganancia pero se vende poco: recomendalo, ponelo más arriba en la carta o con foto.' },
  perro: { nombre: 'Perro', consejo: 'Se vende poco y deja poco: pensá en sacarlo o rehacerlo.' }
};

async function gananciaPorProducto({ desde, hasta } = {}) {
  ({ desde, hasta } = validarPeriodo(desde, hasta));
  const { tasa_iva: tasa } = await configGanancias();
  const filas = await all(`SELECT pi.producto_id, pi.nombre_producto AS producto, COALESCE(c.nombre, 'Sin categoría') AS categoria,
      SUM(pi.cantidad) AS unidades, SUM(pi.subtotal) AS ventas, SUM(pi.cantidad * COALESCE(pr.costo, 0)) AS costo,
      MAX(COALESCE(pr.costo, 0)) <= 0 AS sin_costo
    FROM pedido_items pi JOIN pedidos p ON p.id = pi.pedido_id
    LEFT JOIN productos pr ON pr.id = pi.producto_id LEFT JOIN categorias c ON c.id = pr.categoria_id
    WHERE p.estado = 'pagado' AND ${DIA()} BETWEEN ? AND ?
    GROUP BY pi.producto_id, pi.nombre_producto ORDER BY ventas DESC`, [desde, hasta]);
  const neto = v => tasa > 0 ? v / (1 + tasa / 100) : v;
  const productos = filas.map(f => {
    const ventasNetas = r2(neto(f.ventas)), costo = r2(f.costo), ganancia = r2(ventasNetas - costo);
    return { producto_id: f.producto_id, producto: f.producto, categoria: f.categoria, unidades: f.unidades, ventas: r2(f.ventas),
      ventas_netas: ventasNetas, costo, ganancia, margen_pct: pct(ganancia, ventasNetas),
      ganancia_unidad: f.unidades ? r2(ganancia / f.unidades) : 0, sin_costo: !!f.sin_costo };
  });
  const unidades = productos.reduce((s, p) => s + p.unidades, 0);
  const gananciaTotal = productos.reduce((s, p) => s + p.ganancia, 0);
  const umbralPopularidad = productos.length ? 0.7 * unidades / productos.length : 0;
  const gananciaMedia = unidades ? gananciaTotal / unidades : 0;
  for (const p of productos) {
    const popular = p.unidades >= umbralPopularidad, rentable = p.ganancia_unidad >= gananciaMedia;
    p.clase = popular ? (rentable ? 'estrella' : 'caballo') : (rentable ? 'rompecabezas' : 'perro');
    p.participacion_pct = pct(p.ganancia, gananciaTotal);
  }
  const porCategoria = new Map();
  for (const p of productos) {
    const c = porCategoria.get(p.categoria) || { categoria: p.categoria, unidades: 0, ventas: 0, ventas_netas: 0, costo: 0, ganancia: 0 };
    c.unidades += p.unidades; c.ventas += p.ventas; c.ventas_netas += p.ventas_netas; c.costo += p.costo; c.ganancia += p.ganancia;
    porCategoria.set(p.categoria, c);
  }
  const categorias = [...porCategoria.values()].map(c => ({ ...c, ventas: r2(c.ventas), ventas_netas: r2(c.ventas_netas), costo: r2(c.costo),
    ganancia: r2(c.ganancia), margen_pct: pct(c.ganancia, c.ventas_netas) })).sort((a, b) => b.ganancia - a.ganancia);
  return { desde, hasta, productos, categorias, clases: CLASES,
    referencias: { unidades_minimas_popular: r2(umbralPopularidad), ganancia_media_unidad: r2(gananciaMedia) } };
}

// ---------- Por canal, medio de pago, horario, día de la semana y mozo ----------

function agrupar(pedidos, claveDe, nombreDe = k => k) {
  const m = new Map();
  for (const p of pedidos) { const k = claveDe(p); if (!m.has(k)) m.set(k, []); m.get(k).push(p); }
  return [...m.entries()].map(([k, lista]) => {
    const s = sumar(lista);
    return { clave: k, nombre: nombreDe(k), ventas: s.ventas, tickets: s.tickets, ticket_promedio: s.ticket_promedio,
      comisiones: s.comisiones, ganancia_bruta: s.ganancia_bruta, margen_bruto_pct: s.margen_bruto_pct, propinas: s.propinas };
  }).sort((a, b) => b.ventas - a.ventas);
}

async function gananciaPorCanal({ desde, hasta } = {}) {
  ({ desde, hasta } = validarPeriodo(desde, hasta));
  const cfg = await configGanancias();
  const pedidos = await pedidosDelPeriodo(desde, hasta, cfg);
  const total = sumar(pedidos);
  const canales = agrupar(pedidos, p => p.plataforma || p.tipo, k => CANALES[k] || k);
  for (const c of canales) c.participacion_pct = pct(c.ventas, total.ventas);

  const medios = new Map();
  for (const p of pedidos) for (const x of p.medios) {
    const m = medios.get(x.metodo) || { metodo: x.metodo, nombre: MEDIOS[x.metodo] || x.metodo, cobrado: 0, comision: 0, porcentaje: cfg.comisiones[x.metodo] || 0 };
    m.cobrado += x.monto; m.comision += x.comision;
    medios.set(x.metodo, m);
  }
  const cobrado = [...medios.values()].reduce((s, m) => s + m.cobrado, 0);
  const porMedio = [...medios.values()].map(m => ({ ...m, cobrado: r2(m.cobrado), comision: r2(m.comision), participacion_pct: pct(m.cobrado, cobrado) }))
    .sort((a, b) => b.cobrado - a.cobrado);

  const porHora = agrupar(pedidos, p => p.hora, h => `${String(h).padStart(2, '0')}:00`).sort((a, b) => a.clave - b.clave);
  // Por día de la semana: promedio por día (no total), para comparar un lunes con un sábado
  const cuantos = Array(7).fill(0);
  for (let d = desde, n = 0; d <= hasta && n < 1200; d = sumarDias(d, 1), n++) cuantos[new Date(d + 'T12:00:00Z').getUTCDay()]++;
  const porDiaSemana = agrupar(pedidos, p => p.dow, d => DIAS_SEMANA[d]).map(x => ({ ...x,
    ventas_promedio: cuantos[x.clave] ? r2(x.ventas / cuantos[x.clave]) : 0,
    ganancia_promedio: cuantos[x.clave] ? r2(x.ganancia_bruta / cuantos[x.clave]) : 0 })).sort((a, b) => ((a.clave + 6) % 7) - ((b.clave + 6) % 7));
  const porMozo = agrupar(pedidos, p => p.usuario_id || 0, k => (pedidos.find(p => (p.usuario_id || 0) === k) || {}).mozo || 'Sin asignar (online)');

  return { desde, hasta, total, canales, medios: porMedio, horas: porHora, dias_semana: porDiaSemana, mozos: porMozo };
}

// ---------- Lo que se come la ganancia ----------

async function fugasDeGanancia({ desde, hasta } = {}) {
  ({ desde, hasta } = validarPeriodo(desde, hasta));
  const cfg = await configGanancias();
  const pedidos = await pedidosDelPeriodo(desde, hasta, cfg);
  const t = sumar(pedidos);
  const s = campo => r2(pedidos.reduce((a, p) => a + (Number(p[campo]) || 0), 0));
  // Cancelados: no se sabe si se llegaron a preparar, así que se informan aparte y no se suman a la pérdida
  const cancelados = await get(`SELECT COUNT(*) AS cantidad, COALESCE(SUM(p.subtotal), 0) AS monto
    FROM pedidos p WHERE p.estado = 'cancelado' AND ${DIA()} BETWEEN ? AND ?`, [desde, hasta]);
  // Salidas de stock a mano (mermas, roturas, consumo del personal), valuadas al costo
  const mermas = await all(`SELECT pr.nombre AS producto, SUM(m.cantidad) AS cantidad, SUM(m.cantidad * COALESCE(pr.costo, 0)) AS costo,
      GROUP_CONCAT(DISTINCT NULLIF(m.motivo, '')) AS motivos
    FROM movimientos_stock m JOIN productos pr ON pr.id = m.producto_id
    WHERE m.tipo NOT IN ('entrada', 'venta') AND date(m.fecha, ${LOCAL()}) BETWEEN ? AND ?
    GROUP BY pr.id ORDER BY costo DESC`, [desde, hasta]);
  const totalMermas = r2(mermas.reduce((a, m) => a + (Number(m.costo) || 0), 0));
  const items = [
    { clave: 'comisiones_pago', nombre: 'Comisiones de tarjetas y Mercado Pago', monto: s('comision_pago') },
    { clave: 'comisiones_app', nombre: 'Comisiones de apps de delivery', monto: s('comision_app') },
    { clave: 'descuentos', nombre: 'Descuentos manuales', monto: s('descuento') },
    { clave: 'puntos', nombre: 'Canjes de puntos', monto: s('descuento_puntos') },
    { clave: 'cupones', nombre: 'Cupones', monto: s('descuento_cupon') },
    { clave: 'mermas', nombre: 'Mermas y salidas de stock a mano (al costo)', monto: totalMermas }
  ].map(x => ({ ...x, pct_ventas: pct(x.monto, t.ventas) }));
  const total = r2(items.reduce((a, x) => a + x.monto, 0));
  return { desde, hasta, ventas: t.ventas, total, total_pct_ventas: pct(total, t.ventas), items: items.sort((a, b) => b.monto - a.monto),
    mermas: mermas.slice(0, 15).map(m => ({ ...m, costo: r2(m.costo) })),
    cancelados: { cantidad: cancelados.cantidad, monto: r2(cancelados.monto) },
    medios: Object.entries(cfg.comisiones).filter(([, v]) => v > 0).map(([m, v]) => ({ medio: MEDIOS[m], porcentaje: v })) };
}

// ---------- Punto de equilibrio del mes ----------

async function puntoDeEquilibrio({ mes } = {}) {
  const hoy = fechaLocal();
  mes = mes || hoy.slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(mes)) throw errorHttp(400, 'Mes inválido (AAAA-MM)');
  const cfg = await configGanancias();
  const dias = diasDelMes(mes);
  const desde = `${mes}-01`, fin = `${mes}-${String(dias).padStart(2, '0')}`;
  const futuro = desde > hoy;
  const hasta = fin < hoy ? fin : hoy;
  const transcurridos = futuro ? 0 : diasEntre(desde, hasta) + 1;
  const { t } = futuro ? { t: sumar([]) } : await totales(desde, hasta, cfg);
  // Margen: el del mes; si todavía no hay ventas, el de los últimos 30 días
  let base = t;
  if (!(t.ventas > 0)) base = (await totales(fechaLocal(30), fechaLocal(1), cfg)).t;
  const margen = base.ventas > 0 ? base.ganancia_bruta / base.ventas : 0; // por cada $1 vendido, cuánto queda antes de fijos
  const fijos = cfg.total_gastos_fijos;
  const necesarias = margen > 0 ? r2(fijos / margen) : null;
  const promedio = transcurridos ? r2(t.ventas / transcurridos) : 0;
  const proyeccion = r2(promedio * dias);
  const restantes = dias - transcurridos;
  // Si no hay gastos fijos cargados, se sugieren los gastos cargados el mes anterior
  let sugerencia = null;
  if (!fijos) {
    const ant = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
    const g = await gastosDelPeriodo(`${ant}-01`, `${ant}-${String(diasDelMes(ant)).padStart(2, '0')}`, cfg.tasa_iva);
    sugerencia = { mes: ant, monto: r2(g.reduce((s, x) => s + x.monto, 0)) };
  }
  return {
    mes, dias_del_mes: dias, dias_transcurridos: transcurridos, gastos_fijos: fijos, detalle_fijos: cfg.gastos_fijos,
    margen_contribucion_pct: Math.round(margen * 1000) / 10, ventas_necesarias_mes: necesarias,
    ventas_necesarias_dia: necesarias === null ? null : r2(necesarias / dias),
    vendido: t.ventas, ganancia_bruta: t.ganancia_bruta, promedio_diario: promedio, proyeccion_mes: proyeccion,
    ganancia_proyectada: r2(proyeccion * margen - fijos), avance_pct: necesarias ? pct(t.ventas, necesarias) : null,
    falta_vender: necesarias === null ? null : r2(Math.max(0, necesarias - t.ventas)),
    necesario_por_dia_restante: necesarias === null || !restantes ? null : r2(Math.max(0, necesarias - t.ventas) / restantes),
    alcanzado: necesarias !== null && t.ventas >= necesarias, sugerencia_fijos: sugerencia
  };
}

// ---------- ¿Cuánto gané hoy? ----------
// Comparado con el mismo día de la semana pasada hasta la misma hora
async function gananciaDeHoy() {
  const cfg = await configGanancias();
  const hoy = fechaLocal(), semanaPasada = fechaLocal(7);
  const hora = Number(new Intl.DateTimeFormat('en-GB', { timeZone: ZONA_HORARIA, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  const deHoy = await pedidosDelPeriodo(hoy, hoy, cfg);
  const antes = (await pedidosDelPeriodo(semanaPasada, semanaPasada, cfg)).filter(p => p.hora <= hora);
  const t = sumar(deHoy), a = sumar(antes);
  const fijosDia = r2(cfg.total_gastos_fijos / diasDelMes(hoy.slice(0, 7)));
  return { fecha: hoy, ventas: t.ventas, tickets: t.tickets, ticket_promedio: t.ticket_promedio, costo: t.costo, comisiones: t.comisiones,
    ganancia_bruta: t.ganancia_bruta, margen_bruto_pct: t.margen_bruto_pct, gastos_fijos_dia: fijosDia,
    ganancia_estimada: r2(t.ganancia_bruta - fijosDia), hay_gastos_fijos: cfg.total_gastos_fijos > 0,
    comparacion: { fecha: semanaPasada, hasta_hora: hora, ventas: a.ventas, ganancia_bruta: a.ganancia_bruta,
      variacion_ventas: variacion(t.ventas, a.ventas), variacion_ganancia: variacion(t.ganancia_bruta, a.ganancia_bruta) } };
}

module.exports = {
  configGanancias, guardarConfigGanancias, resumenGanancias, gananciaPorProducto, gananciaPorCanal, fugasDeGanancia,
  puntoDeEquilibrio, gananciaDeHoy, COMISIONES_TIPICAS
};

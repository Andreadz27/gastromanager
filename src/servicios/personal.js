'use strict';
// Personal: fichadas (entrada y salida), turnos planificados y reparto de propinas.
// Las horas se guardan en UTC (como CURRENT_TIMESTAMP) y se muestran y agrupan en la hora del negocio.
// Las propinas son del personal (cuenta "Propinas a pagar al personal"): el reparto las asigna por horas
// trabajadas o en partes iguales y, al pagarse en efectivo, sale de la caja.
const { run, get, all, transaccion } = require('../db');
const { emitEvento } = require('../realtime');
const { errorHttp } = require('../util');
const { LOCAL, offsetZonaMin, fechaLocal } = require('../tiempo');
const { centavos } = require('./pedidos');

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const FECHA_HORA = /^(\d{4}-\d{2}-\d{2})[T ]([01]\d|2[0-3]):([0-5]\d)$/;
const MAX_HORAS_FICHADA = 16; // más que esto es un olvido de fichar la salida: lo revisa el encargado
const auditar = (usuarioId, accion, detalle) => run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, ?, ?)', [usuarioId, accion, detalle]);

function validarPeriodo(desde, hasta) {
  if (!FECHA.test(String(desde || '')) || !FECHA.test(String(hasta || ''))) throw errorHttp(400, 'Fechas inválidas (AAAA-MM-DD)');
  if (desde > hasta) throw errorHttp(400, 'La fecha "desde" es posterior a "hasta"');
  return { desde, hasta };
}

// "AAAA-MM-DDTHH:MM" en hora del negocio → "AAAA-MM-DD HH:MM:SS" UTC (como se guarda)
function localAUtc(texto) {
  const m = FECHA_HORA.exec(String(texto || ''));
  if (!m) throw errorHttp(400, 'Fecha y hora inválidas');
  const comoUtc = new Date(`${m[1]}T${m[2]}:${m[3]}:00Z`);
  const utc = new Date(comoUtc.getTime() - offsetZonaMin(comoUtc) * 60000);
  return utc.toISOString().slice(0, 19).replace('T', ' ');
}

// LOCAL() depende de la fecha (horario de verano): se arma en cada consulta
const selectFichaje = () => `SELECT f.*, u.nombre AS usuario_nombre, c.nombre AS corregido_por_nombre,
    datetime(f.entrada, ${LOCAL()}) AS entrada_local, datetime(f.salida, ${LOCAL()}) AS salida_local,
    ROUND((julianday(COALESCE(f.salida, CURRENT_TIMESTAMP)) - julianday(f.entrada)) * 24, 2) AS horas
  FROM fichajes f JOIN usuarios u ON u.id = f.usuario_id LEFT JOIN usuarios c ON c.id = f.corregido_por`;
const conAlerta = f => ({ ...f, abierta: !f.salida, revisar: f.horas > MAX_HORAS_FICHADA });

// ---- Fichar ----

async function miFichaje(usuarioId) {
  const abierta = await get(`${selectFichaje()} WHERE f.usuario_id = ? AND f.salida IS NULL`, [usuarioId]);
  const hoy = fechaLocal();
  const { horas } = await get(`SELECT ROUND(COALESCE(SUM((julianday(COALESCE(salida, CURRENT_TIMESTAMP)) - julianday(entrada)) * 24), 0), 2) AS horas
    FROM fichajes WHERE usuario_id = ? AND date(entrada, ${LOCAL()}) = ?`, [usuarioId, hoy]);
  return { adentro: !!abierta, fichada: abierta ? conAlerta(abierta) : null, horas_hoy: horas };
}

// Entrada si está afuera, salida si está adentro. El índice único impide dos fichadas abiertas.
// Un segundo toque dentro del mismo minuto no hace nada (si no, el doble toque daba entrada y salida juntas).
async function fichar(usuarioId) {
  const repetido = await transaccion(async () => {
    const reciente = await get(`SELECT id FROM fichajes WHERE usuario_id = ?
      AND (julianday('now') - julianday(COALESCE(salida, entrada))) * 1440 BETWEEN 0 AND 1`, [usuarioId]);
    if (reciente) return true;
    const abierta = await get('SELECT id FROM fichajes WHERE usuario_id = ? AND salida IS NULL', [usuarioId]);
    if (abierta) await run('UPDATE fichajes SET salida = CURRENT_TIMESTAMP WHERE id = ?', [abierta.id]);
    else await run('INSERT INTO fichajes (usuario_id, entrada) VALUES (?, CURRENT_TIMESTAMP)', [usuarioId]);
    return false;
  });
  const estado = await miFichaje(usuarioId);
  if (!repetido) emitEvento('personal:fichaje', { usuario_id: usuarioId, adentro: estado.adentro });
  return { ...estado, repetido };
}

// ---- Fichadas del equipo ----

async function fichajesDelPeriodo(desde, hasta, usuarioId = null) {
  validarPeriodo(desde, hasta);
  const filas = await all(`${selectFichaje()} WHERE date(f.entrada, ${LOCAL()}) BETWEEN ? AND ? ${usuarioId ? 'AND f.usuario_id = ?' : ''}
    ORDER BY f.entrada DESC`, usuarioId ? [desde, hasta, usuarioId] : [desde, hasta]);
  return filas.map(conAlerta);
}

// Horas por persona: solo fichadas cerradas (una abierta todavía no tiene horas para pagar)
async function horasPorPersona(desde, hasta) {
  validarPeriodo(desde, hasta);
  return all(`SELECT u.id AS usuario_id, u.nombre, u.rol,
      ROUND(SUM(CASE WHEN f.salida IS NOT NULL THEN (julianday(f.salida) - julianday(f.entrada)) * 24 ELSE 0 END), 2) AS horas,
      COUNT(f.id) AS fichadas, SUM(f.salida IS NULL) AS abiertas
    FROM fichajes f JOIN usuarios u ON u.id = f.usuario_id
    WHERE date(f.entrada, ${LOCAL()}) BETWEEN ? AND ?
    GROUP BY u.id ORDER BY u.nombre`, [desde, hasta]);
}

function validarFichada(entrada, salida) {
  const e = localAUtc(entrada);
  const s = salida ? localAUtc(salida) : null;
  if (s && s <= e) throw errorHttp(400, 'La salida tiene que ser después de la entrada');
  // Horas que todavía no pasaron: una salida "a futuro" dejaba al empleado sin poder fichar hasta esa hora
  const enCincoMinutos = new Date(Date.now() + 5 * 60000).toISOString().slice(0, 19).replace('T', ' ');
  if (e > enCincoMinutos || (s && s > enCincoMinutos)) throw errorHttp(400, 'No se pueden cargar horarios que todavía no pasaron');
  if (s && (new Date(s.replace(' ', 'T') + 'Z') - new Date(e.replace(' ', 'T') + 'Z')) / 3600000 > 24)
    throw errorHttp(400, 'Una fichada no puede durar más de 24 horas');
  return { e, s };
}

// El encargado corrige una fichada (olvidó fichar la salida, fichó tarde...). Queda quién y por qué.
async function corregirFichaje(id, { entrada, salida, motivo }, porUsuarioId) {
  motivo = String(motivo || '').trim().slice(0, 200);
  if (!motivo) throw errorHttp(400, 'Indicá el motivo de la corrección');
  const actual = await get('SELECT f.*, u.nombre FROM fichajes f JOIN usuarios u ON u.id = f.usuario_id WHERE f.id = ?', [id]);
  if (!actual) throw errorHttp(404, 'Fichada no encontrada');
  const { e, s } = validarFichada(entrada, salida);
  await run('UPDATE fichajes SET entrada = ?, salida = ?, corregido_por = ?, motivo_correccion = ? WHERE id = ?', [e, s, porUsuarioId, motivo, id]);
  await auditar(porUsuarioId, 'fichaje_corregido', `Fichada de ${actual.nombre}: ${actual.entrada}–${actual.salida || 'abierta'} → ${e}–${s || 'abierta'} (UTC). ${motivo}`);
  return conAlerta(await get(`${selectFichaje()} WHERE f.id = ?`, [id]));
}

// Fichada cargada a mano (se olvidó de fichar todo el turno)
async function cargarFichaje({ usuario_id, entrada, salida, motivo }, porUsuarioId) {
  motivo = String(motivo || '').trim().slice(0, 200);
  if (!motivo) throw errorHttp(400, 'Indicá el motivo');
  const u = await get('SELECT id, nombre FROM usuarios WHERE id = ?', [usuario_id]);
  if (!u) throw errorHttp(404, 'Usuario no encontrado');
  if (!salida) throw errorHttp(400, 'Indicá la salida');
  const { e, s } = validarFichada(entrada, salida);
  const { id } = await run('INSERT INTO fichajes (usuario_id, entrada, salida, corregido_por, motivo_correccion) VALUES (?, ?, ?, ?, ?)',
    [u.id, e, s, porUsuarioId, motivo]);
  await auditar(porUsuarioId, 'fichaje_cargado', `Fichada cargada a mano para ${u.nombre}: ${e}–${s} (UTC). ${motivo}`);
  return conAlerta(await get(`${selectFichaje()} WHERE f.id = ?`, [id]));
}

// ---- Turnos ----

const minutos = h => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));

// Turnos con la llegada real: la primera entrada fichada entre 3 h antes y 6 h después del inicio
async function listarTurnos(desde, hasta, usuarioId = null) {
  validarPeriodo(desde, hasta);
  const turnos = await all(`SELECT t.*, u.nombre AS usuario_nombre FROM turnos t JOIN usuarios u ON u.id = t.usuario_id
    WHERE t.fecha BETWEEN ? AND ? ${usuarioId ? 'AND t.usuario_id = ?' : ''} ORDER BY t.fecha, t.inicio, u.nombre`,
    usuarioId ? [desde, hasta, usuarioId] : [desde, hasta]);
  if (!turnos.length) return [];
  const fichadas = await all(`SELECT usuario_id, datetime(entrada, ${LOCAL()}) AS entrada_local FROM fichajes
    WHERE date(entrada, ${LOCAL()}) BETWEEN date(?, '-1 day') AND date(?, '+1 day')`, [desde, hasta]);
  // Todo en "hora del negocio escrita como UTC" para comparar con fecha + inicio del turno
  const ahora = Date.now() + offsetZonaMin() * 60000;
  return turnos.map(t => {
    const inicio = new Date(`${t.fecha}T${t.inicio}:00Z`).getTime();
    const llegada = fichadas.filter(f => f.usuario_id === t.usuario_id)
      .map(f => new Date(f.entrada_local.replace(' ', 'T') + 'Z').getTime())
      .filter(x => x >= inicio - 3 * 3600000 && x <= inicio + 6 * 3600000).sort((a, b) => a - b)[0];
    const duracion = (minutos(t.fin) - minutos(t.inicio) + 1440) % 1440 || 1440;
    return {
      ...t, horas: Math.round(duracion / 60 * 100) / 100,
      llegada: llegada ? new Date(llegada).toISOString().slice(11, 16) : null,
      minutos_tarde: llegada ? Math.max(0, Math.round((llegada - inicio) / 60000)) : null,
      // Ya empezó hace más de 15 min y no fichó
      ausente: !llegada && ahora > inicio + 15 * 60000
    };
  });
}

async function validarTurno(d) {
  if (!FECHA.test(String(d.fecha || ''))) throw errorHttp(400, 'Fecha inválida');
  if (!HORA.test(String(d.inicio || '')) || !HORA.test(String(d.fin || ''))) throw errorHttp(400, 'Horario inválido (HH:MM)');
  if (d.inicio === d.fin) throw errorHttp(400, 'El turno tiene que durar algo');
  const u = await get('SELECT id FROM usuarios WHERE id = ? AND activo = 1', [d.usuario_id]);
  if (!u) throw errorHttp(400, 'Empleado no encontrado');
  return { usuario_id: u.id, fecha: d.fecha, inicio: d.inicio, fin: d.fin,
    puesto: String(d.puesto || '').slice(0, 40), notas: String(d.notas || '').slice(0, 200) };
}

async function guardarTurno(datos, porUsuarioId, id = null) {
  const t = await validarTurno(datos);
  if (id) {
    const r = await run('UPDATE turnos SET usuario_id = ?, fecha = ?, inicio = ?, fin = ?, puesto = ?, notas = ? WHERE id = ?',
      [t.usuario_id, t.fecha, t.inicio, t.fin, t.puesto, t.notas, id]);
    if (!r.changes) throw errorHttp(404, 'Turno no encontrado');
  } else {
    ({ id } = await run('INSERT INTO turnos (usuario_id, fecha, inicio, fin, puesto, notas, creado_por) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [t.usuario_id, t.fecha, t.inicio, t.fin, t.puesto, t.notas, porUsuarioId]));
  }
  emitEvento('personal:turnos', { fecha: t.fecha });
  return { id, ...t };
}

async function borrarTurno(id) {
  const r = await run('DELETE FROM turnos WHERE id = ?', [id]);
  if (!r.changes) throw errorHttp(404, 'Turno no encontrado');
  emitEvento('personal:turnos', {});
}

// Copia los turnos de una semana a la siguiente (la planilla suele repetirse)
async function copiarSemana(desde, porUsuarioId) {
  if (!FECHA.test(String(desde || ''))) throw errorHttp(400, 'Fecha inválida');
  return transaccion(async () => {
    const origen = await all("SELECT * FROM turnos WHERE fecha BETWEEN ? AND date(?, '+6 days')", [desde, desde]);
    const { n } = await get("SELECT COUNT(*) n FROM turnos WHERE fecha BETWEEN date(?, '+7 days') AND date(?, '+13 days')", [desde, desde]);
    if (n) throw errorHttp(409, 'La semana siguiente ya tiene turnos cargados');
    for (const t of origen) {
      await run(`INSERT INTO turnos (usuario_id, fecha, inicio, fin, puesto, notas, creado_por)
        VALUES (?, date(?, '+7 days'), ?, ?, ?, ?, ?)`, [t.usuario_id, t.fecha, t.inicio, t.fin, t.puesto, t.notas, porUsuarioId]);
    }
    emitEvento('personal:turnos', {});
    return { copiados: origen.length };
  });
}

// ---- Reparto de propinas ----

// Propinas cobradas en el período: la parte de cada pago que es propina (mismo cálculo que contabilidad.js)
async function propinasDelPeriodo(desde, hasta) {
  const { total } = await get(`SELECT COALESCE(SUM(CASE WHEN p.total > 0 THEN pg.monto * COALESCE(p.propina, 0) / p.total ELSE 0 END), 0) AS total
    FROM pagos pg JOIN pedidos p ON p.id = pg.pedido_id
    WHERE p.estado = 'pagado' AND date(pg.fecha, ${LOCAL()}) BETWEEN ? AND ?`, [desde, hasta]);
  return centavos(total);
}

// Reparte el total en centavos: cada uno lo suyo redondeado hacia abajo y los centavos que sobran, de a uno,
// a los que más perdieron al redondear. La suma siempre da el total exacto.
function repartirCentavos(total, pesos) {
  const sumaPesos = pesos.reduce((s, p) => s + p, 0);
  const totalCent = Math.round(total * 100);
  if (!(sumaPesos > 0)) return pesos.map(() => 0);
  const exactos = pesos.map(p => totalCent * p / sumaPesos);
  const montos = exactos.map(Math.floor);
  let resto = totalCent - montos.reduce((s, m) => s + m, 0);
  const orden = exactos.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; resto > 0; k = (k + 1) % orden.length, resto--) montos[orden[k][1]]++;
  return montos.map(m => m / 100);
}

// metodo: horas (según fichadas cerradas) o iguales. usuarios: quiénes entran (sin lista: los que ficharon)
async function calcularReparto({ desde, hasta, metodo, usuarios }) {
  validarPeriodo(desde, hasta);
  if (!['horas', 'iguales'].includes(metodo)) throw errorHttp(400, 'Método de reparto inválido');
  const solapado = await get(`SELECT id, desde, hasta FROM repartos_propinas WHERE estado != 'anulado' AND desde <= ? AND hasta >= ? LIMIT 1`, [hasta, desde]);
  if (solapado) throw errorHttp(409, `Ya hay un reparto del ${solapado.desde} al ${solapado.hasta}: elegí otras fechas o anulalo`);
  const total = await propinasDelPeriodo(desde, hasta);
  const horas = await horasPorPersona(desde, hasta);
  let participantes;
  if (Array.isArray(usuarios) && usuarios.length) {
    const ids = usuarios.map(Number);
    const datos = await all(`SELECT id, nombre FROM usuarios WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
    participantes = datos.map(u => ({ usuario_id: u.id, nombre: u.nombre, horas: (horas.find(h => h.usuario_id === u.id) || {}).horas || 0 }));
  } else {
    participantes = horas.filter(h => h.horas > 0).map(h => ({ usuario_id: h.usuario_id, nombre: h.nombre, horas: h.horas }));
  }
  if (metodo === 'horas') participantes = participantes.filter(p => p.horas > 0);
  const montos = repartirCentavos(total, participantes.map(p => metodo === 'horas' ? p.horas : 1));
  return {
    desde, hasta, metodo, total,
    participantes: participantes.map((p, i) => ({ ...p, monto: montos[i] })),
    fichadas_abiertas: horas.reduce((s, h) => s + (Number(h.abiertas) || 0), 0)
  };
}

const repartoPorId = async id => {
  const r = await get('SELECT r.*, u.nombre AS creado_por_nombre FROM repartos_propinas r LEFT JOIN usuarios u ON u.id = r.creado_por WHERE r.id = ?', [id]);
  return r ? { ...r, detalle: JSON.parse(r.detalle || '[]') } : null;
};

// Se guarda lo que calcula el servidor (nunca los montos que manda el navegador)
async function guardarReparto(datos, porUsuarioId) {
  const c = await calcularReparto(datos);
  if (!(c.total > 0)) throw errorHttp(400, 'No hay propinas cobradas en ese período');
  if (!c.participantes.length) throw errorHttp(400, datos.metodo === 'horas' ? 'Nadie tiene horas fichadas en ese período' : 'Elegí quiénes participan');
  const { id } = await run('INSERT INTO repartos_propinas (desde, hasta, total, metodo, detalle, creado_por) VALUES (?, ?, ?, ?, ?, ?)',
    [c.desde, c.hasta, c.total, c.metodo, JSON.stringify(c.participantes), porUsuarioId]);
  await auditar(porUsuarioId, 'reparto_propinas', `Reparto de propinas ${c.desde} a ${c.hasta}: $${c.total} entre ${c.participantes.length} (${c.metodo})`);
  return repartoPorId(id);
}

const listarRepartos = async () => Promise.all(
  (await all('SELECT id FROM repartos_propinas ORDER BY desde DESC LIMIT 50')).map(r => repartoPorId(r.id)));

// Pagado: en efectivo sale de la caja abierta (egreso); por transferencia no toca la caja
async function pagarReparto(id, medio, porUsuarioId) {
  if (!['efectivo', 'transferencia'].includes(medio)) throw errorHttp(400, 'Medio de pago inválido');
  await transaccion(async () => {
    const r = await get('SELECT * FROM repartos_propinas WHERE id = ?', [id]);
    if (!r) throw errorHttp(404, 'Reparto no encontrado');
    if (r.estado !== 'pendiente') throw errorHttp(409, `El reparto ya está ${r.estado}`);
    let movimiento = null;
    if (medio === 'efectivo') {
      const caja = await get("SELECT id FROM caja WHERE estado = 'abierta'");
      if (!caja) throw errorHttp(400, 'Para pagar en efectivo tiene que haber una caja abierta');
      ({ id: movimiento } = await run('INSERT INTO movimientos_caja (caja_id, tipo, concepto, monto, usuario_id) VALUES (?, ?, ?, ?, ?)',
        [caja.id, 'egreso', `Pago de propinas del ${r.desde} al ${r.hasta}`, r.total, porUsuarioId]));
    }
    await run("UPDATE repartos_propinas SET estado = 'pagado', medio_pago = ?, caja_movimiento_id = ?, pagado_en = ? WHERE id = ?",
      [medio, movimiento, fechaLocal(), id]);
    await auditar(porUsuarioId, 'reparto_propinas_pagado', `Reparto ${r.desde} a ${r.hasta} pagado ($${r.total}, ${medio})`);
  });
  return repartoPorId(id);
}

async function anularReparto(id, porUsuarioId) {
  const r = await run("UPDATE repartos_propinas SET estado = 'anulado' WHERE id = ? AND estado = 'pendiente'", [id]);
  if (!r.changes) throw errorHttp(409, 'Solo se anulan repartos sin pagar');
  await auditar(porUsuarioId, 'reparto_propinas_anulado', `Reparto ${id} anulado`);
  return repartoPorId(id);
}

module.exports = {
  miFichaje, fichar, fichajesDelPeriodo, horasPorPersona, corregirFichaje, cargarFichaje,
  listarTurnos, guardarTurno, borrarTurno, copiarSemana,
  propinasDelPeriodo, repartirCentavos, calcularReparto, guardarReparto, listarRepartos, pagarReparto, anularReparto
};

'use strict';
// ============ Zona horaria del negocio ============
// SQLite guarda las fechas en UTC (CURRENT_TIMESTAMP). Los reportes por día se calculan
// en la hora local del negocio: sin esto, lo vendido después de las 21 hs en Argentina
// (UTC-3) se contaba en el día siguiente.
const ZONA_HORARIA = process.env.ZONA_HORARIA || 'America/Argentina/Buenos_Aires';

// Diferencia en minutos entre la hora local del negocio y UTC (ej.: -180)
function offsetZonaMin(fecha = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: ZONA_HORARIA, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(fecha).map(x => [x.type, x.value]));
  const comoUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((comoUTC - Math.floor(fecha.getTime() / 1000) * 1000) / 60000);
}

// Modificador SQLite UTC → hora local: date(p.cerrado_en, ${LOCAL()})
const LOCAL = () => `'${offsetZonaMin()} minutes'`;

// Fecha local del negocio (AAAA-MM-DD), opcionalmente N días atrás
const fechaLocal = (diasAtras = 0) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_HORARIA }).format(new Date(Date.now() - diasAtras * 86400000));

module.exports = { ZONA_HORARIA, offsetZonaMin, LOCAL, fechaLocal };

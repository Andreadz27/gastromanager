'use strict';
// ============ Monitoreo ============
// estadoSalud(): lo que responde GET /api/salud (sin datos del negocio).
// Latido: si MONITOREO_URL está definida (ej. un check de healthchecks.io o Better Stack),
// cada MONITOREO_MINUTOS (5 por defecto) se le avisa que el local está vivo. Si la base no
// responde o la última copia tiene más de 26 horas, se avisa a MONITOREO_URL + "/fail".
// Si el local se apaga o pierde internet, el servicio de monitoreo deja de recibir latidos y te avisa.
const { get } = require('../db');
const { listarBackups } = require('./backups');
const { estadoNube } = require('./copia-nube');
const VERSION = require('../../package.json').version;

const HORAS_MAX_SIN_COPIA = 26;
const inicio = Date.now();

async function estadoSalud() {
  let base = 'ok';
  try { await get('SELECT 1 AS x'); } catch (e) { base = 'error'; }
  const ultima = listarBackups()[0] || null;
  const horas = ultima ? Math.round((Date.now() - new Date(ultima.fecha).getTime()) / 36e5 * 10) / 10 : null;
  const copiaOk = horas !== null && horas <= HORAS_MAX_SIN_COPIA;
  const nubeOk = !estadoNube.activa || (estadoNube.ultima ? estadoNube.ultima.ok : true);
  // En un local (producción), sin copia fuera de la PC un disco roto se lleva todo: es una falla, no una opción.
  // BACKUP_SOLO_LOCAL=1 lo acepta a sabiendas (ej. el local guarda las copias en BACKUP_COPIA_DIR sincronizada).
  const faltaNube = process.env.NODE_ENV === 'production' && process.env.GM_DEMO !== '1' &&
    !estadoNube.activa && process.env.BACKUP_SOLO_LOCAL !== '1';
  const problemas = [
    base !== 'ok' && 'la base de datos no responde',
    !copiaOk && `no hay copia de seguridad de las últimas ${HORAS_MAX_SIN_COPIA} horas`,
    !nubeOk && 'falló la última subida de la copia a la nube',
    faltaNube && 'la copia fuera del local no está configurada (BACKUP_S3_* en el .env)'
  ].filter(Boolean);
  return {
    ok: problemas.length === 0,
    version: VERSION,
    activo_hace_min: Math.round((Date.now() - inicio) / 60000),
    base,
    ultima_copia: ultima ? { fecha: ultima.fecha, horas } : null,
    copia_nube: estadoNube.activa ? (estadoNube.ultima ? { ok: estadoNube.ultima.ok, fecha: estadoNube.ultima.fecha } : { ok: null }) : 'no configurada',
    problemas
  };
}

async function latido(url = process.env.MONITOREO_URL) {
  if (!url) return null;
  const salud = await estadoSalud();
  const destino = salud.ok ? url : url.replace(/\/$/, '') + '/fail';
  try {
    await fetch(destino, {
      method: 'POST', body: JSON.stringify(salud), headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000)
    });
  } catch (e) {
    console.error('[monitoreo] No se pudo enviar el latido:', e.message);
  }
  return salud;
}

function iniciarMonitoreo() {
  if (!process.env.MONITOREO_URL) return;
  // MONITOREO_SEGUNDOS solo para tests; en producción se usa MONITOREO_MINUTOS
  const ms = Number(process.env.MONITOREO_SEGUNDOS) * 1000 || (Number(process.env.MONITOREO_MINUTOS) || 5) * 60000;
  latido();
  setInterval(latido, ms).unref();
  console.log(`[monitoreo] Latido cada ${Math.round(ms / 1000)} s`);
}

module.exports = { estadoSalud, latido, iniciarMonitoreo };

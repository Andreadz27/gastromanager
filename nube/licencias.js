'use strict';
// Morfi Nube: plan de cada local (lo asigna soporte con `node nube/alta.js plan ...`) y su licencia firmada.
// El local la busca cada 2 minutos y con ella habilita sus módulos (src/licencia.js); acá se usa el mismo plan
// para el panel del dueño, la carta online y los precios centrales.
// La clave privada va en NUBE_CLAVE_LICENCIAS (el PEM, o la ruta al archivo): sin ella no se firman licencias
// y los locales siguen con la última que tenían.
const fs = require('fs');
const { get, all } = require('./db');
const { PLANES, EXTRAS, DIAS_GRACIA, DIAS_PRUEBA, modulosDe } = require('../src/planes');
const { firmarLicencia } = require('../src/licencia-firma');

function clavePrivada() {
  const v = process.env.NUBE_CLAVE_LICENCIAS;
  if (!v) return null;
  return v.includes('BEGIN') ? v.replace(/\\n/g, '\n') : fs.readFileSync(v, 'utf8');
}

const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: process.env.ZONA_HORARIA || 'America/Argentina/Buenos_Aires' }).format(new Date());
const sumarDias = (fecha, dias) => new Date(Date.parse(fecha + 'T12:00:00Z') + dias * 86400000).toISOString().slice(0, 10);
const extrasDe = l => { try { return JSON.parse(l.extras || '[]').filter(e => EXTRAS[e]); } catch (e) { return []; } };

// Módulos que tiene hoy el local (vencido y pasada la gracia: los de Esencial)
function modulosLocal(l) {
  if (l.vence && hoy() > sumarDias(l.vence, DIAS_GRACIA)) return modulosDe('esencial');
  return modulosDe(l.plan || 'esencial', extrasDe(l));
}
const tieneModulo = (l, modulo) => modulosLocal(l).includes(modulo);

// Validación de lo que asigna soporte
function validarPlan({ plan, vence, extras }) {
  if (!PLANES[plan]) throw Object.assign(new Error(`Plan inválido: ${plan} (${Object.keys(PLANES).join(', ')})`), { status: 400 });
  if (vence && !/^\d{4}-\d{2}-\d{2}$/.test(vence)) throw Object.assign(new Error('El vencimiento va como AAAA-MM-DD'), { status: 400 });
  const lista = String(extras || '').split(',').map(s => s.trim()).filter(Boolean);
  const malo = lista.find(e => !EXTRAS[e]);
  if (malo) throw Object.assign(new Error(`Extra inválido: ${malo} (${Object.keys(EXTRAS).join(', ')})`), { status: 400 });
  return { plan, vence: vence || null, extras: JSON.stringify(lista) };
}

const venceDePrueba = () => sumarDias(hoy(), DIAS_PRUEBA);

function registrarLicencias(app, { ruta, errorHttp, autenticarLocal }) {
  app.get('/api/sync/licencia', autenticarLocal, ruta(async (req, res) => {
    const clave = clavePrivada();
    if (!clave) throw errorHttp(503, 'Esta nube no tiene configurada la clave de licencias (NUBE_CLAVE_LICENCIAS)');
    const l = await get('SELECT * FROM locales WHERE id = ?', [req.local.id]);
    res.json({ licencia: firmarLicencia({ cliente: l.cliente, plan: l.plan || 'esencial', extras: extrasDe(l),
      vence: l.vence || null, local: l.token_hash.slice(0, 16), emitida: new Date().toISOString() }, clave) });
  }));
}

// Locales de la cuenta que tienen el módulo
const localesConModulo = async (cuentaId, modulo) =>
  (await all('SELECT * FROM locales WHERE cuenta_id = ? ORDER BY nombre', [cuentaId])).filter(l => tieneModulo(l, modulo));

module.exports = { registrarLicencias, modulosLocal, tieneModulo, validarPlan, venceDePrueba, localesConModulo, extrasDe };

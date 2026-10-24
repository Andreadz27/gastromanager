'use strict';
// Plan del local y qué módulos tiene (ver src/planes.js).
// - Con licencia (la manda Morfi Nube firmada, o se pega a mano en Configuración → Tu plan): el plan contratado
//   hasta su vencimiento, DIAS_GRACIA días más con todo, y después quedan solo los módulos de Esencial.
// - Sin licencia: una instalación nueva tiene DIAS_PRUEBA días de prueba con todo y después Esencial.
//   Una instalación que ya vendía antes de que existieran los planes sigue con todo hasta que se le asigne uno.
// - Demo pública: todo.
// Nada de esto apaga lo básico (pedidos, caja, cobros, facturación, cocina): solo los módulos de planes superiores.
const fs = require('fs');
const path = require('path');
const { get, run } = require('./db');
const { fechaLocal } = require('./tiempo');
const { PLANES, EXTRAS, MODULOS, DIAS_PRUEBA, DIAS_GRACIA, DIAS_AVISO, modulosDe, planMinimo } = require('./planes');
const { leerLicencia, huellaToken } = require('./licencia-firma');

// En los tests se firma con otra clave (la privada de verdad no está en el repositorio)
const CLAVE_PUBLICA = process.env.NODE_ENV === 'test' && process.env.MORFI_LICENCIA_PUBLICA
  ? process.env.MORFI_LICENCIA_PUBLICA
  : fs.readFileSync(path.join(__dirname, 'licencia-publica.pem'), 'utf8');

const sumarDias = (fecha, dias) => new Date(Date.parse(fecha + 'T12:00:00Z') + dias * 86400000).toISOString().slice(0, 10);
const diasEntre = (desde, hasta) => Math.round((Date.parse(hasta + 'T12:00:00Z') - Date.parse(desde + 'T12:00:00Z')) / 86400000);
const fechaAR = f => f.split('-').reverse().join('/');
const leerMeta = async clave => { try { const r = await get('SELECT valor FROM meta WHERE clave = ?', [clave]); return r ? r.valor : null; } catch (e) { return null; } };

// Licencia válida para este local (firma correcta y, si el local está conectado a la nube, emitida para su token)
// Se consulta en cada operación de un módulo: la última verificación queda guardada
let verificada = { texto: null, datos: null };
function licenciaValida(texto) {
  if (texto !== verificada.texto) verificada = { texto, datos: leerLicencia(texto, CLAVE_PUBLICA) };
  const d = verificada.datos;
  if (!d) return null;
  if (d.local && process.env.NUBE_TOKEN && d.local !== huellaToken(process.env.NUBE_TOKEN)) return null;
  return d;
}

function resultado(plan, extras, datos) {
  const p = PLANES[plan] || PLANES.esencial;
  return { plan: PLANES[plan] ? plan : 'esencial', plan_nombre: p.nombre, extras, modulos: modulosDe(plan, extras), ...datos };
}

async function estadoLicencia(hoy = fechaLocal()) {
  if (process.env.GM_DEMO === '1') return resultado('prueba', [], { estado: 'activo', origen: 'demo', plan_nombre: 'Demo', aviso: '' });

  const lic = licenciaValida(await leerMeta('licencia'));
  if (lic) {
    const extras = (Array.isArray(lic.extras) ? lic.extras : []).filter(e => EXTRAS[e]);
    const base = { origen: 'licencia', contratado: lic.plan, cliente: lic.cliente || null, vence: lic.vence || null };
    if (!lic.vence) return resultado(lic.plan, extras, { ...base, estado: 'activo', aviso: '' });
    const dias = diasEntre(hoy, lic.vence);
    const gracia = sumarDias(lic.vence, DIAS_GRACIA);
    const nombre = (PLANES[lic.plan] || PLANES.esencial).nombre;
    if (dias >= 0) {
      const pronto = dias <= DIAS_AVISO;
      return resultado(lic.plan, extras, { ...base, estado: pronto ? 'por_vencer' : 'activo', dias,
        aviso: pronto ? `Tu plan ${nombre} vence ${dias === 0 ? 'hoy' : dias === 1 ? 'mañana' : `en ${dias} días`} (${fechaAR(lic.vence)}).` : '' });
    }
    if (hoy <= gracia) {
      return resultado(lic.plan, extras, { ...base, estado: 'gracia', dias: diasEntre(hoy, gracia), gracia_hasta: gracia,
        aviso: `Tu plan ${nombre} venció el ${fechaAR(lic.vence)}. Seguís con todo hasta el ${fechaAR(gracia)}; después quedan solo las funciones de Esencial.` });
    }
    return resultado('esencial', [], { ...base, estado: 'vencido', gracia_hasta: gracia,
      aviso: `Tu plan ${nombre} está pausado desde el ${fechaAR(gracia)}. Ventas, caja, cocina y facturación siguen normales; el resto vuelve apenas se registre el pago.` });
  }

  const inicio = await leerMeta('licencia_inicio');
  if (inicio === 'heredada') return resultado('pro', Object.keys(EXTRAS), { estado: 'activo', origen: 'instalacion_anterior', aviso: '' });
  const desde = /^\d{4}-\d{2}-\d{2}$/.test(inicio || '') ? inicio : hoy;
  const fin = sumarDias(desde, DIAS_PRUEBA);
  if (hoy <= fin) {
    const dias = diasEntre(hoy, fin);
    return resultado('prueba', [], { estado: 'prueba', origen: 'prueba', vence: fin, dias,
      aviso: dias <= DIAS_AVISO ? `Te ${dias === 1 ? 'queda 1 día' : `quedan ${dias} días`} de prueba gratis. Elegí tu plan para no perder las funciones Pro.` : '' });
  }
  return resultado('esencial', [], { estado: 'prueba_terminada', origen: 'prueba', vence: fin,
    aviso: 'Terminó la prueba gratis: estás en el plan Esencial. Elegí Pro para volver a tener todas las funciones.' });
}

const tiene = async modulo => (await estadoLicencia()).modulos.includes(modulo);

// Error para cuando el plan no incluye algo (402: lo que falta es el plan, no el permiso del usuario)
function errorPlan(modulo, estado) {
  const minimo = planMinimo(modulo);
  const que = EXTRAS[minimo] ? `sumar ${EXTRAS[minimo].nombre}` : `el plan ${PLANES[minimo].nombre}`;
  const motivo = estado && estado.estado === 'vencido' ? 'Tu plan está pausado por falta de pago' : `Tu plan ${estado ? estado.plan_nombre : ''} no incluye esto`;
  return Object.assign(new Error(`${motivo}: ${MODULOS[modulo]}. Para usarlo necesitás ${que}.`),
    { status: 402, modulo, plan_requerido: minimo });
}

// Middleware para las rutas de un módulo
function requierePlan(modulo) {
  return async (req, res, next) => {
    let estado;
    try { estado = await estadoLicencia(); } catch (e) { return next(); } // ante un error propio no se corta la operación
    if (estado.modulos.includes(modulo)) return next();
    const e = errorPlan(modulo, estado);
    res.status(402).json({ error: e.message, modulo, plan_requerido: e.plan_requerido, mejorar_plan: true });
  };
}

// Guarda una licencia (de la nube o pegada a mano). Devuelve el estado nuevo; error si no es válida.
async function guardarLicencia(texto) {
  const t = String(texto || '').trim();
  if (!licenciaValida(t)) throw Object.assign(new Error('La licencia no es válida para este local'), { status: 400 });
  if (t !== await leerMeta('licencia')) {
    await run("INSERT INTO meta (clave, valor) VALUES ('licencia', ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor", [t]);
  }
  return estadoLicencia();
}

module.exports = { estadoLicencia, tiene, requierePlan, errorPlan, guardarLicencia, sumarDias };

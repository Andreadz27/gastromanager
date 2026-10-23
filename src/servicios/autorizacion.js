'use strict';
// PIN de autorización y arqueo ciego (Configuración → Control de caja; los dos apagados por defecto).
// Con el PIN activado, las acciones sensibles (descuentos, cancelar pedidos, anular facturas, egresos de caja)
// de quien no es encargado o administrador necesitan el PIN de uno de ellos. Con el PIN, un usuario sin ese
// permiso también puede hacerla (ej. el mozo aplica un descuento que autoriza el encargado). Queda en la auditoría.
const bcrypt = require('bcryptjs');
const { run, get, all } = require('../db');
const { tienePermiso } = require('../auth');

// Supervisor: quien ve el historial de caja (encargado y administrador)
const PERMISO_SUPERVISOR = 'caja.historial';
const esSupervisor = usuario => tienePermiso(usuario, PERMISO_SUPERVISOR);

async function controlCaja() {
  const c = await get('SELECT pin_autorizacion, arqueo_ciego FROM configuracion WHERE id = 1');
  return { pin: !!(c && Number(c.pin_autorizacion)), ciego: !!(c && Number(c.arqueo_ciego)) };
}

// Intentos fallidos por usuario: 5 seguidos bloquean el PIN 5 minutos (un PIN de 4 dígitos se adivina probando)
const fallidos = new Map();
const MAX_FALLIDOS = 5;
const BLOQUEO_MS = 5 * 60 * 1000;

const pinValido = pin => /^\d{4,6}$/.test(String(pin || ''));

// Cuenta el intento ANTES de comparar (bcrypt es lento): así muchos pedidos en paralelo
// no pasan todos antes de que se registre el primer fallo. Devuelve false si el usuario está bloqueado.
function contarIntento(usuarioId) {
  const ahora = Date.now();
  let e = fallidos.get(usuarioId);
  if (e && e.hasta && e.hasta <= ahora) e = null; // ya pasó el bloqueo
  if (e && e.hasta > ahora) return false;
  e = { n: ((e && e.n) || 0) + 1, hasta: 0 };
  if (e.n >= MAX_FALLIDOS) e.hasta = ahora + BLOQUEO_MS;
  fallidos.set(usuarioId, e);
  return true;
}

async function supervisorDelPin(pin) {
  if (!pinValido(pin)) return null;
  const candidatos = await all("SELECT id, nombre, rol, pin_hash FROM usuarios WHERE activo = 1 AND pin_hash IS NOT NULL AND pin_hash != ''");
  const { permisosDeRol } = require('../permisos');
  for (const u of candidatos) {
    if (!permisosDeRol(u.rol).includes(PERMISO_SUPERVISOR)) continue;
    if (await bcrypt.compare(String(pin), u.pin_hash)) return { id: u.id, nombre: u.nombre };
  }
  return null;
}

// Decide si req.usuario puede hacer la acción. Devuelve { ok } o { status, error, requiere_pin }.
async function autorizar(req, permiso, accion) {
  const usuario = req.usuario;
  const { pin: conPin } = await controlCaja();
  const tiene = tienePermiso(usuario, permiso);
  if (tiene && (!conPin || esSupervisor(usuario))) return { ok: true };
  if (!conPin) return { status: 403, error: 'Tu usuario no tiene permiso para esta acción' };

  const pin = req.get('x-autorizacion-pin');
  if (!pin) return { status: 403, error: `${accion}: necesita el PIN de un encargado`, requiere_pin: true };
  if (!contarIntento(usuario.id))
    return { status: 429, error: 'Demasiados PIN incorrectos. Esperá unos minutos.', requiere_pin: true };
  const supervisor = await supervisorDelPin(pin);
  if (!supervisor) return { status: 403, error: 'PIN incorrecto', requiere_pin: true };
  fallidos.delete(usuario.id);
  await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, ?, ?)',
    [usuario.id, 'autorizacion_pin', `${accion}: ${usuario.nombre || 'usuario ' + usuario.id} autorizado por ${supervisor.nombre}`]);
  req.autorizadoPor = supervisor;
  return { ok: true };
}

// Middleware: requiereAutorizacion('pedidos.descuento', 'Descuento')
function requiereAutorizacion(permiso, accion) {
  return (req, res, next) => {
    autorizar(req, permiso, accion).then(r => {
      if (r.ok) return next();
      res.status(r.status).json({ error: r.error, ...(r.requiere_pin ? { requiere_pin: true } : {}) });
    }).catch(next);
  };
}

// El supervisor elige su PIN (con su contraseña). No puede repetir el de otro supervisor.
async function definirPin(usuarioId, pin) {
  if (!pinValido(pin)) throw Object.assign(new Error('El PIN tiene que ser de 4 a 6 números'), { status: 400 });
  // "Ya lo usa otra persona" revela un PIN ajeno: los intentos cuentan igual que un PIN incorrecto
  if (!contarIntento(usuarioId)) throw Object.assign(new Error('Demasiados intentos. Esperá unos minutos.'), { status: 429 });
  const otro = await supervisorDelPin(pin);
  if (otro && otro.id !== usuarioId) throw Object.assign(new Error('Ese PIN ya lo usa otra persona: elegí otro'), { status: 400 });
  fallidos.delete(usuarioId);
  await run('UPDATE usuarios SET pin_hash = ? WHERE id = ?', [await bcrypt.hash(String(pin), 10), usuarioId]);
}

module.exports = { controlCaja, autorizar, requiereAutorizacion, definirPin, esSupervisor };

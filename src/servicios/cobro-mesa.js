'use strict';
// Cobro en la mesa: quién puede cobrar.
// Con "pedidos.cobrar" (cajero, encargado, admin) se cobra cualquier pedido.
// Si en Configuración está activado "Los mozos cobran en la mesa", quien solo toma pedidos
// puede cobrar y facturar los pedidos de mesa (no mostrador ni delivery, ni descuentos).
const { get } = require('../db');
const { tienePermiso } = require('../auth');

async function mozoCobraEnMesa() {
  const cfg = await get('SELECT mozo_cobra_mesa FROM configuracion WHERE id = 1');
  return !!(cfg && Number(cfg.mozo_cobra_mesa) === 1);
}

// Middleware: deja pasar y marca req.puedeCobrarTodo (false = solo pedidos de mesa)
function requiereCobro(req, res, next) {
  if (tienePermiso(req.usuario, 'pedidos.cobrar')) {
    req.puedeCobrarTodo = true;
    return next();
  }
  if (!tienePermiso(req.usuario, 'pedidos.tomar'))
    return res.status(403).json({ error: 'Tu usuario no tiene permiso para esta acción' });
  mozoCobraEnMesa().then(habilitado => {
    if (!habilitado) return res.status(403).json({ error: 'Tu usuario no tiene permiso para esta acción' });
    req.puedeCobrarTodo = false;
    next();
  }).catch(next);
}

async function pedidoDeSalon(pedidoId) {
  const p = await get('SELECT tipo, mesa_id FROM pedidos WHERE id = ?', [pedidoId]);
  return !!(p && p.tipo === 'salon' && p.mesa_id);
}

module.exports = { requiereCobro, pedidoDeSalon, mozoCobraEnMesa };

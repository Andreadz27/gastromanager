'use strict';
// Fidelización: puntos por consumo, cupones de descuento y gift cards.
// - Puntos: se ganan al cerrarse un pedido con cliente (1 cada $puntos_cada de consumo, sin propina) y se canjean
//   como descuento ($puntos_valor cada uno). El saldo es clientes.puntos y cada cambio queda en puntos_movimientos.
// - Cupones: descuento en % o monto fijo, con mínimo, vigencia y límite de usos (total y por cliente).
// - Gift cards: se cobran al venderlas (deuda con el cliente, cuenta 2.1.04) y se usan como medio de pago "giftcard".
// Los descuentos de puntos y cupón van en columnas propias del pedido: recalcularTotales los resta junto al manual.
const crypto = require('crypto');
const { run, get, all, transaccion } = require('../db');
const { emitEvento } = require('../realtime');
const { errorHttp } = require('../util');
const { fechaLocal } = require('../tiempo');
const { recalcularTotales, centavos } = require('./pedidos');

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

async function configPuntos() {
  const c = await get('SELECT puntos_activo, puntos_cada, puntos_valor, puntos_minimo FROM configuracion WHERE id = 1');
  return { activo: Number(c.puntos_activo) === 1, cada: Number(c.puntos_cada) || 1000, valor: Number(c.puntos_valor) || 0,
    minimo: Number(c.puntos_minimo) || 0 };
}

async function moverPuntosTx(clienteId, puntos, tipo, { pedidoId = null, detalle = '', usuarioId = null } = {}) {
  await run('INSERT INTO puntos_movimientos (cliente_id, pedido_id, puntos, tipo, detalle, usuario_id) VALUES (?, ?, ?, ?, ?, ?)',
    [clienteId, pedidoId, puntos, tipo, detalle, usuarioId]);
  await run('UPDATE clientes SET puntos = COALESCE(puntos, 0) + ? WHERE id = ?', [puntos, clienteId]);
}

async function pedidoAbierto(pedidoId) {
  const p = await get('SELECT * FROM pedidos WHERE id = ?', [pedidoId]);
  if (!p) throw errorHttp(404, 'Pedido no encontrado');
  if (p.estado !== 'abierto') throw errorHttp(400, 'El pedido no está abierto');
  return p;
}

// ---- Cliente del pedido ----

async function asignarCliente(pedidoId, clienteId) {
  return transaccion(async () => {
    const p = await pedidoAbierto(pedidoId);
    if (!clienteId) {
      if (p.puntos_canjeados) throw errorHttp(400, 'Primero sacá el canje de puntos');
      await run('UPDATE pedidos SET cliente_id = NULL WHERE id = ?', [p.id]);
      return null;
    }
    const c = await get('SELECT id, nombre, telefono, puntos FROM clientes WHERE id = ?', [clienteId]);
    if (!c) throw errorHttp(404, 'Cliente no encontrado');
    if (p.puntos_canjeados && p.cliente_id !== c.id) throw errorHttp(400, 'El pedido tiene puntos canjeados de otro cliente: sacá el canje primero');
    await run('UPDATE pedidos SET cliente_id = ?, cliente = ? WHERE id = ?', [c.id, c.nombre, p.id]);
    return c;
  });
}

// ---- Puntos ----

// Al cerrarse un pedido (dentro de la misma transacción): suma los puntos del consumo sin propina
async function acreditarPuntosTx(pedidoId) {
  const cfg = await configPuntos();
  if (!cfg.activo) return 0;
  const p = await get('SELECT cliente_id, total, propina, numero_pedido FROM pedidos WHERE id = ?', [pedidoId]);
  if (!p || !p.cliente_id) return 0;
  const puntos = Math.floor(centavos((Number(p.total) || 0) - (Number(p.propina) || 0)) / cfg.cada);
  if (puntos > 0) await moverPuntosTx(p.cliente_id, puntos, 'gana', { pedidoId, detalle: `Pedido ${p.numero_pedido}` });
  return puntos;
}

async function canjearPuntos(pedidoId, puntos, usuarioId) {
  const cfg = await configPuntos();
  if (!cfg.activo) throw errorHttp(400, 'El programa de puntos no está activo');
  puntos = parseInt(puntos, 10);
  if (!(puntos > 0)) throw errorHttp(400, 'Cantidad de puntos inválida');
  const r = await transaccion(async () => {
    const p = await pedidoAbierto(pedidoId);
    if (!p.cliente_id) throw errorHttp(400, 'Elegí el cliente del pedido');
    if (p.puntos_canjeados) throw errorHttp(409, 'Este pedido ya tiene puntos canjeados');
    const c = await get('SELECT id, puntos FROM clientes WHERE id = ?', [p.cliente_id]);
    if (puntos > (c.puntos || 0)) throw errorHttp(400, `El cliente tiene ${c.puntos || 0} puntos`);
    if (puntos < cfg.minimo) throw errorHttp(400, `Se canjean desde ${cfg.minimo} puntos`);
    // No más de lo que queda por pagar del consumo (los puntos no pagan la propina ni dejan saldo a favor)
    const disponible = centavos(p.subtotal - p.descuento - (p.descuento_cupon || 0));
    const descuento = centavos(puntos * cfg.valor);
    if (descuento > disponible + 0.009)
      throw errorHttp(400, `Con ${puntos} puntos el descuento ($${descuento}) supera lo consumido ($${disponible})`);
    await run('UPDATE pedidos SET puntos_canjeados = ?, descuento_puntos = ? WHERE id = ?', [puntos, descuento, p.id]);
    await moverPuntosTx(c.id, -puntos, 'canje', { pedidoId: p.id, detalle: `Descuento de $${descuento} en ${p.numero_pedido}`, usuarioId });
    await recalcularTotales(p.id);
    return { puntos, descuento };
  });
  emitEvento('pedido:actualizado', { id: Number(pedidoId) });
  return r;
}

// Saca el canje (devuelve los puntos). También al cancelar el pedido.
async function quitarCanjeTx(p, usuarioId, motivo) {
  if (!p.puntos_canjeados || !p.cliente_id) return;
  await moverPuntosTx(p.cliente_id, p.puntos_canjeados, 'devolucion', { pedidoId: p.id, detalle: motivo, usuarioId });
  await run('UPDATE pedidos SET puntos_canjeados = 0, descuento_puntos = 0 WHERE id = ?', [p.id]);
}

async function quitarCanje(pedidoId, usuarioId) {
  await transaccion(async () => {
    const p = await pedidoAbierto(pedidoId);
    if (!p.puntos_canjeados) throw errorHttp(400, 'El pedido no tiene puntos canjeados');
    await quitarCanjeTx(p, usuarioId, `Canje sacado de ${p.numero_pedido}`);
    await recalcularTotales(p.id);
  });
}

async function ajustarPuntos(clienteId, puntos, motivo, usuarioId) {
  puntos = parseInt(puntos, 10);
  motivo = String(motivo || '').trim().slice(0, 200);
  if (!puntos) throw errorHttp(400, 'Indicá los puntos a sumar o restar');
  if (!motivo) throw errorHttp(400, 'Indicá el motivo del ajuste');
  return transaccion(async () => {
    const c = await get('SELECT id, nombre, puntos FROM clientes WHERE id = ?', [clienteId]);
    if (!c) throw errorHttp(404, 'Cliente no encontrado');
    if ((c.puntos || 0) + puntos < 0) throw errorHttp(400, `El cliente tiene ${c.puntos || 0} puntos`);
    await moverPuntosTx(c.id, puntos, 'ajuste', { detalle: motivo, usuarioId });
    await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, ?, ?)',
      [usuarioId, 'puntos_ajuste', `${c.nombre}: ${puntos > 0 ? '+' : ''}${puntos} puntos (${motivo})`]);
    return { puntos: (c.puntos || 0) + puntos };
  });
}

const movimientosPuntos = clienteId => all(`SELECT m.*, p.numero_pedido, u.nombre AS usuario_nombre FROM puntos_movimientos m
  LEFT JOIN pedidos p ON p.id = m.pedido_id LEFT JOIN usuarios u ON u.id = m.usuario_id
  WHERE m.cliente_id = ? ORDER BY m.id DESC LIMIT 100`, [clienteId]);

// ---- Cupones ----

function validarDatosCupon(d) {
  const codigo = String(d.codigo || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,30}$/.test(codigo)) throw errorHttp(400, 'Código inválido (3 a 30 letras, números, - o _)');
  const tipo = d.tipo === 'monto' ? 'monto' : 'porcentaje';
  const valor = Number(d.valor);
  if (!(valor > 0) || (tipo === 'porcentaje' && valor > 100)) throw errorHttp(400, 'Valor del descuento inválido');
  for (const f of ['desde', 'hasta']) if (d[f] && !FECHA.test(d[f])) throw errorHttp(400, 'Fecha inválida');
  if (d.desde && d.hasta && d.desde > d.hasta) throw errorHttp(400, '"Desde" es posterior a "hasta"');
  const entero = v => v === undefined || v === null || v === '' ? null : Math.max(1, parseInt(v, 10) || 1);
  return { codigo, tipo, valor, descripcion: String(d.descripcion || '').slice(0, 120), minimo: Math.max(0, Number(d.minimo) || 0),
    desde: d.desde || null, hasta: d.hasta || null, usos_max: entero(d.usos_max), usos_por_cliente: entero(d.usos_por_cliente) };
}

async function guardarCupon(datos, id = null) {
  const c = validarDatosCupon(datos);
  const valores = [c.codigo, c.descripcion, c.tipo, c.valor, c.minimo, c.desde, c.hasta, c.usos_max, c.usos_por_cliente];
  try {
    if (id) {
      const r = await run(`UPDATE cupones SET codigo = ?, descripcion = ?, tipo = ?, valor = ?, minimo = ?, desde = ?, hasta = ?,
        usos_max = ?, usos_por_cliente = ?, activo = ? WHERE id = ?`, [...valores, datos.activo === false || datos.activo === 0 ? 0 : 1, id]);
      if (!r.changes) throw errorHttp(404, 'Cupón no encontrado');
    } else {
      ({ id } = await run(`INSERT INTO cupones (codigo, descripcion, tipo, valor, minimo, desde, hasta, usos_max, usos_por_cliente)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, valores));
    }
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT') throw errorHttp(409, `Ya existe un cupón con el código ${c.codigo}`);
    throw e;
  }
  return get('SELECT * FROM cupones WHERE id = ?', [id]);
}

const listarCupones = () => all(`SELECT c.*, (SELECT COUNT(*) FROM cupon_usos u WHERE u.cupon_id = c.id) AS usos,
  (SELECT COALESCE(SUM(descuento), 0) FROM cupon_usos u WHERE u.cupon_id = c.id) AS descontado FROM cupones c ORDER BY c.activo DESC, c.id DESC`);

async function aplicarCupon(pedidoId, codigo) {
  codigo = String(codigo || '').trim().toUpperCase();
  const r = await transaccion(async () => {
    const p = await pedidoAbierto(pedidoId);
    if (p.cupon_id) throw errorHttp(409, 'El pedido ya tiene un cupón');
    const c = await get('SELECT * FROM cupones WHERE codigo = ? AND activo = 1', [codigo]);
    if (!c) throw errorHttp(404, 'Cupón inexistente o desactivado');
    const hoy = fechaLocal();
    if ((c.desde && hoy < c.desde) || (c.hasta && hoy > c.hasta)) throw errorHttp(400, 'El cupón no está vigente');
    const base = centavos(p.subtotal - p.descuento);
    if (c.minimo && base < c.minimo) throw errorHttp(400, `El cupón es para consumos desde $${c.minimo}`);
    if (c.usos_max && (await get('SELECT COUNT(*) n FROM cupon_usos WHERE cupon_id = ?', [c.id])).n >= c.usos_max)
      throw errorHttp(400, 'El cupón ya se usó todas las veces permitidas');
    if (c.usos_por_cliente) {
      if (!p.cliente_id) throw errorHttp(400, 'Este cupón es por cliente: elegí el cliente del pedido');
      if ((await get('SELECT COUNT(*) n FROM cupon_usos WHERE cupon_id = ? AND cliente_id = ?', [c.id, p.cliente_id])).n >= c.usos_por_cliente)
        throw errorHttp(400, 'El cliente ya usó este cupón');
    }
    // El descuento de puntos ya aplicado se respeta: el cupón no deja el consumo por debajo de cero
    const tope = centavos(base - (p.descuento_puntos || 0));
    const descuento = Math.min(tope, c.tipo === 'monto' ? c.valor : centavos(base * c.valor / 100));
    if (!(descuento > 0)) throw errorHttp(400, 'No queda consumo para descontar');
    await run('INSERT INTO cupon_usos (cupon_id, pedido_id, cliente_id, descuento) VALUES (?, ?, ?, ?)', [c.id, p.id, p.cliente_id, descuento]);
    await run('UPDATE pedidos SET cupon_id = ?, descuento_cupon = ? WHERE id = ?', [c.id, descuento, p.id]);
    await recalcularTotales(p.id);
    return { codigo: c.codigo, descuento };
  });
  emitEvento('pedido:actualizado', { id: Number(pedidoId) });
  return r;
}

async function quitarCuponTx(p) {
  if (!p.cupon_id) return;
  await run('DELETE FROM cupon_usos WHERE pedido_id = ?', [p.id]);
  await run('UPDATE pedidos SET cupon_id = NULL, descuento_cupon = 0 WHERE id = ?', [p.id]);
}

async function quitarCupon(pedidoId) {
  await transaccion(async () => {
    const p = await pedidoAbierto(pedidoId);
    if (!p.cupon_id) throw errorHttp(400, 'El pedido no tiene cupón');
    await quitarCuponTx(p);
    await recalcularTotales(p.id);
  });
}

// Pedido cancelado: vuelven los puntos canjeados y el uso del cupón
async function revertirFidelizacionTx(pedidoId, usuarioId) {
  const p = await get('SELECT * FROM pedidos WHERE id = ?', [pedidoId]);
  if (!p) return;
  await quitarCanjeTx(p, usuarioId, `Pedido ${p.numero_pedido} cancelado`);
  await quitarCuponTx(p);
}

// ---- Gift cards ----

// GM-XXXX-XXXX sin letras que se confundan (0/O, 1/I)
function nuevoCodigoGiftCard() {
  const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const parte = () => Array.from(crypto.randomBytes(4), b => letras[b % letras.length]).join('');
  return `GM-${parte()}-${parte()}`;
}
const normalizarCodigo = c => String(c || '').trim().toUpperCase();

async function venderGiftCard({ monto, medio, comprador, destinatario, vence }, usuarioId) {
  monto = centavos(monto);
  if (!(monto > 0) || monto > 1000000) throw errorHttp(400, 'Monto inválido');
  if (!['efectivo', 'tarjeta', 'transferencia', 'mercadopago'].includes(medio)) throw errorHttp(400, 'Medio de cobro inválido');
  if (vence && (!FECHA.test(vence) || vence < fechaLocal())) throw errorHttp(400, 'Fecha de vencimiento inválida');
  return transaccion(async () => {
    let movimiento = null;
    const codigo = nuevoCodigoGiftCard();
    if (medio === 'efectivo') {
      const caja = await get("SELECT id FROM caja WHERE estado = 'abierta'");
      if (!caja) throw errorHttp(400, 'Para cobrar en efectivo tiene que haber una caja abierta');
      ({ id: movimiento } = await run('INSERT INTO movimientos_caja (caja_id, tipo, concepto, monto, usuario_id) VALUES (?, ?, ?, ?, ?)',
        [caja.id, 'ingreso', `Venta de gift card ${codigo}`, monto, usuarioId]));
    }
    const { id } = await run(`INSERT INTO gift_cards (codigo, monto, saldo, vence, comprador, destinatario, medio_cobro, caja_movimiento_id, usuario_id, fecha)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [codigo, monto, monto, vence || null, String(comprador || '').slice(0, 80),
      String(destinatario || '').slice(0, 80), medio, movimiento, usuarioId, fechaLocal()]);
    await run('INSERT INTO gift_card_movimientos (gift_card_id, monto, tipo, usuario_id) VALUES (?, ?, ?, ?)', [id, monto, 'emision', usuarioId]);
    await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, ?, ?)', [usuarioId, 'gift_card_venta', `Gift card ${codigo} por $${monto} (${medio})`]);
    return get('SELECT * FROM gift_cards WHERE id = ?', [id]);
  });
}

async function consultarGiftCard(codigo) {
  const g = await get('SELECT id, codigo, monto, saldo, vence, destinatario, estado FROM gift_cards WHERE codigo = ?', [normalizarCodigo(codigo)]);
  if (!g) throw errorHttp(404, 'Gift card inexistente');
  return { ...g, vencida: !!(g.vence && g.vence < fechaLocal()) };
}

const listarGiftCards = () => all('SELECT g.*, u.nombre AS vendida_por FROM gift_cards g LEFT JOIN usuarios u ON u.id = g.usuario_id ORDER BY g.id DESC LIMIT 200');

// Pago con gift card (dentro de la transacción del cobro): descuenta el saldo o falla sin cobrar nada
async function usarGiftCardTx(pedidoId, codigo, monto, usuarioId) {
  const g = await get('SELECT * FROM gift_cards WHERE codigo = ?', [normalizarCodigo(codigo)]);
  if (!g) throw errorHttp(400, 'Gift card inexistente: revisá el código');
  if (g.estado !== 'activa') throw errorHttp(400, 'La gift card está anulada');
  if (g.vence && g.vence < fechaLocal()) throw errorHttp(400, `La gift card venció el ${g.vence}`);
  const r = await run('UPDATE gift_cards SET saldo = ROUND(saldo - ?, 2) WHERE id = ? AND saldo >= ? - 0.009', [monto, g.id, monto]);
  if (!r.changes) throw errorHttp(400, `La gift card tiene $${g.saldo} de saldo`);
  await run('INSERT INTO gift_card_movimientos (gift_card_id, pedido_id, monto, tipo, usuario_id) VALUES (?, ?, ?, ?, ?)', [g.id, pedidoId, -monto, 'uso', usuarioId]);
  return g.codigo;
}

module.exports = {
  configPuntos, asignarCliente, acreditarPuntosTx, canjearPuntos, quitarCanje, ajustarPuntos, movimientosPuntos,
  guardarCupon, listarCupones, aplicarCupon, quitarCupon, revertirFidelizacionTx,
  venderGiftCard, consultarGiftCard, listarGiftCards, usarGiftCardTx
};

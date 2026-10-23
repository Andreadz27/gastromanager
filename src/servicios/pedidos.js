'use strict';
// Numeración, validación de ítems, totales y cobro de pedidos
const { run, get, all, transaccion } = require('../db');
const { emitEvento } = require('../realtime');
const { fechaLocal } = require('../tiempo');
const { descontarStockItemTx } = require('./recetas');

// Generar número de pedido: secuencial y atómico (P-AAAAMMDD-00001).
// La fecha es la del negocio (ZONA_HORARIA), no la del servidor: en un servidor en UTC
// los pedidos de después de las 21 h de Argentina salían con la fecha del día siguiente.
async function generarNumeroPedido() {
  const row = await get("UPDATE secuencias SET valor = valor + 1 WHERE nombre = 'pedido' RETURNING valor");
  return `P-${fechaLocal().replace(/-/g, '')}-${String(row.valor).padStart(5, '0')}`;
}

// Valida los ítems recibidos y toma nombre y precio de la tabla productos:
// nunca se confía en el precio que manda el navegador.
async function resolverItems(items) {
  if (!Array.isArray(items) || !items.length) throw Object.assign(new Error('El pedido no tiene ítems'), { status: 400 });
  const resueltos = [];
  for (const item of items) {
    const cantidad = Number(item && item.cantidad);
    if (!Number.isFinite(cantidad) || cantidad <= 0 || cantidad > 1000)
      throw Object.assign(new Error('Cantidad inválida'), { status: 400 });
    const prod = await get('SELECT id, nombre, precio_venta FROM productos WHERE id = ? AND activo = 1', [item.producto_id]);
    if (!prod) throw Object.assign(new Error('Producto no disponible'), { status: 400 });
    const precio = Number(prod.precio_venta) || 0;
    resueltos.push({ producto_id: prod.id, nombre: prod.nombre, cantidad, precio, subtotal: centavos(cantidad * precio), notas: String(item.notas || '') });
  }
  return resueltos;
}

// Importe no negativo (descuento, propina, envío), en centavos
const importe = v => centavos(Math.max(0, Number(v) || 0));

// Redondeo a centavos: ARCA rechaza importes como 3.4499999999999997 (1,15 × 3)
const centavos = n => Math.round((Number(n) || 0) * 100) / 100;

// Recalcula subtotal y total de un pedido a partir de sus ítems.
// Descuentos: el manual y los de fidelización (puntos canjeados y cupón); nunca dejan el consumo por debajo de cero.
async function recalcularTotales(pedidoId) {
  const pedido = await get('SELECT descuento, propina, descuento_puntos, descuento_cupon FROM pedidos WHERE id = ?', [pedidoId]);
  const { s } = await get('SELECT COALESCE(SUM(subtotal), 0) AS s FROM pedido_items WHERE pedido_id = ?', [pedidoId]);
  const subtotal = centavos(s);
  const descuento = Math.min(importe(pedido.descuento), subtotal);
  const fidelizacion = Math.min(importe(pedido.descuento_puntos) + importe(pedido.descuento_cupon), subtotal - descuento);
  const total = centavos(Math.max(0, subtotal - descuento - fidelizacion + importe(pedido.propina)));
  await run('UPDATE pedidos SET subtotal = ?, descuento = ?, total = ? WHERE id = ?', [subtotal, descuento, total, pedidoId]);
  return { subtotal, total };
}

// Pago con gift card: descuenta el saldo dentro de la misma transacción (fidelizacion.js se carga acá:
// fidelizacion.js usa este archivo y requerirlo arriba armaría un ciclo)
async function pagoConGiftCardTx(pedidoId, p, usuarioId) {
  if (p.metodo !== 'giftcard') return p.referencia || '';
  const codigo = await require('./fidelizacion').usarGiftCardTx(pedidoId, p.referencia, p.monto, usuarioId);
  return `GC-${codigo}`;
}

// Registra el pago, cierra el pedido, libera la mesa y descuenta stock.
// Usado por el cobro manual y por el webhook de Mercado Pago.
// Devuelve false si el pedido ya no estaba abierto (evita cobrarlo dos veces).
function registrarPago(pedido, datosPago) {
  // Todo el cobro (pago, cierre, mesa, stock) es una sola operación atómica
  return transaccion(() => registrarPagoTx(pedido, datosPago));
}

async function registrarPagoTx(pedido, { metodo, monto, referencia, usuarioId }) {
  // Se marca como pagado solo si sigue abierto: si dos cobros llegan a la vez, gana uno
  if (!(await cerrarPedidoTx(pedido, metodo, usuarioId))) return false;
  const ref = await pagoConGiftCardTx(pedido.id, { metodo, monto, referencia }, usuarioId);
  await run('INSERT INTO pagos (pedido_id, metodo, monto, referencia) VALUES (?, ?, ?, ?)',
    [pedido.id, metodo, monto, ref]);
  return true;
}

// Cierra un pedido abierto: estado pagado, mesa libre y descuento de stock.
// Devuelve false si ya no estaba abierto.
async function cerrarPedidoTx(pedido, metodo, usuarioId) {
  const pedidoId = pedido.id;
  const { changes } = await run(
    `UPDATE pedidos SET estado = 'pagado', cerrado_en = CURRENT_TIMESTAMP, metodo_pago = ? WHERE id = ? AND estado = 'abierto'`,
    [metodo || '', pedidoId]);
  if (!changes) return false;

  if (pedido.mesa_id) {
    await run('UPDATE mesas SET estado = ? WHERE id = ?', ['libre', pedido.mesa_id]);
  }

  // Stock: los ingredientes de la receta o, sin receta, el producto (ver servicios/recetas.js)
  const items = await all('SELECT * FROM pedido_items WHERE pedido_id = ?', [pedidoId]);
  for (const item of items) {
    if (item.producto_id) await descontarStockItemTx(item, pedido, usuarioId);
  }

  // Puntos del cliente por el consumo (si el programa está activo y el pedido tiene cliente)
  await require('./fidelizacion').acreditarPuntosTx(pedidoId);

  emitEvento('pedido:pagado', { id: Number(pedidoId), numero_pedido: pedido.numero_pedido });
  emitEvento('cocina:actualizar', { pedido_id: Number(pedidoId), accion: 'pagado' });
  emitEvento('delivery:actualizar', { pedido_id: Number(pedidoId), accion: 'pagado' });
  emitEvento('dashboard:actualizar', { motivo: 'pedido_pagado' });
  emitEvento('stock:actualizar', { pedido_id: Number(pedidoId), accion: 'venta' });
  return true;
}

// giftcard: la referencia es el código de la tarjeta (se descuenta su saldo al cobrar)
const METODOS_PAGO = ['efectivo', 'tarjeta', 'mercadopago', 'transferencia', 'giftcard', 'otro'];

// Total, lo ya cobrado (pagos parciales al dividir la cuenta) y lo que falta
async function saldoPedido(pedidoId) {
  const pedido = await get('SELECT total FROM pedidos WHERE id = ?', [pedidoId]);
  const { pagado } = await get('SELECT COALESCE(SUM(monto), 0) AS pagado FROM pagos WHERE pedido_id = ?', [pedidoId]);
  const total = centavos(pedido && pedido.total);
  return { total, pagado: centavos(pagado), saldo: centavos(Math.max(0, total - pagado)) };
}

// Cobro en la mesa: uno o varios pagos (dividir la cuenta o pagar con varios medios).
// Va dentro de transaccion(): el pedido se relee acá, así dos cobros a la vez no pagan de más.
// Si los pagos cubren el saldo, el pedido se cierra (mesa libre y stock), igual que un cobro único.
async function registrarCobroTx(pedidoId, { pagos, propina, usuarioId }) {
  const pedido = await get('SELECT * FROM pedidos WHERE id = ?', [pedidoId]);
  if (!pedido) throw Object.assign(new Error('Pedido no encontrado'), { status: 404 });
  if (pedido.estado !== 'abierto') throw Object.assign(new Error('El pedido ya fue cobrado o cancelado'), { status: 409 });

  if (propina !== undefined && propina !== null) {
    await run('UPDATE pedidos SET propina = ? WHERE id = ?', [importe(propina), pedido.id]);
    await recalcularTotales(pedido.id);
  }
  const { total, pagado, saldo } = await saldoPedido(pedido.id);
  if (total < pagado - 0.009)
    throw Object.assign(new Error('El nuevo total queda por debajo de lo ya cobrado'), { status: 400 });

  const aCobrar = centavos(pagos.reduce((s, p) => s + p.monto, 0));
  if (aCobrar > saldo + 0.009)
    throw Object.assign(new Error(`Se quiere cobrar ${aCobrar} y el saldo es ${saldo}`), { status: 400 });

  for (const p of pagos) {
    const ref = await pagoConGiftCardTx(pedido.id, p, usuarioId);
    await run('INSERT INTO pagos (pedido_id, metodo, monto, referencia) VALUES (?, ?, ?, ?)',
      [pedido.id, p.metodo, p.monto, ref]);
  }

  const restante = centavos(saldo - aCobrar);
  let cerrado = false;
  if (restante <= 0.009) {
    const metodos = await all('SELECT DISTINCT metodo FROM pagos WHERE pedido_id = ?', [pedido.id]);
    cerrado = await cerrarPedidoTx(pedido, metodos.length === 1 ? metodos[0].metodo : 'mixto', usuarioId);
  } else {
    emitEvento('pedido:pago_parcial', { id: pedido.id, numero_pedido: pedido.numero_pedido, saldo: restante });
    emitEvento('dashboard:actualizar', { motivo: 'pago_parcial' });
  }
  return { pedido, total, cobrado: aCobrar, saldo: cerrado ? 0 : restante, cerrado };
}

module.exports = {
  generarNumeroPedido, resolverItems, importe, centavos, recalcularTotales, registrarPago, registrarPagoTx,
  registrarCobroTx, saldoPedido, METODOS_PAGO
};

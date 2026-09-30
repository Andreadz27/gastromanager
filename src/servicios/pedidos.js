'use strict';
// Numeración, validación de ítems, totales y cobro de pedidos
const { run, get, all, transaccion } = require('../db');
const { emitEvento } = require('../realtime');

// Generar número de pedido: secuencial y atómico (P-AAAAMMDD-00001)
async function generarNumeroPedido() {
  const row = await get("UPDATE secuencias SET valor = valor + 1 WHERE nombre = 'pedido' RETURNING valor");
  const fecha = new Date();
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, '0');
  const d = String(fecha.getDate()).padStart(2, '0');
  return `P-${y}${m}${d}-${String(row.valor).padStart(5, '0')}`;
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
    resueltos.push({ producto_id: prod.id, nombre: prod.nombre, cantidad, precio, notas: String(item.notas || '') });
  }
  return resueltos;
}

// Importe no negativo (descuento, propina, envío)
const importe = v => Math.max(0, Number(v) || 0);

// Recalcula subtotal y total de un pedido a partir de sus ítems
async function recalcularTotales(pedidoId) {
  const pedido = await get('SELECT descuento, propina FROM pedidos WHERE id = ?', [pedidoId]);
  const { s } = await get('SELECT COALESCE(SUM(subtotal), 0) AS s FROM pedido_items WHERE pedido_id = ?', [pedidoId]);
  const descuento = Math.min(importe(pedido.descuento), s);
  const total = Math.max(0, s - descuento + importe(pedido.propina));
  await run('UPDATE pedidos SET subtotal = ?, descuento = ?, total = ? WHERE id = ?', [s, descuento, total, pedidoId]);
  return { subtotal: s, total };
}

// Registra el pago, cierra el pedido, libera la mesa y descuenta stock.
// Usado por el cobro manual y por el webhook de Mercado Pago.
// Devuelve false si el pedido ya no estaba abierto (evita cobrarlo dos veces).
function registrarPago(pedido, datosPago) {
  // Todo el cobro (pago, cierre, mesa, stock) es una sola operación atómica
  return transaccion(() => registrarPagoTx(pedido, datosPago));
}

async function registrarPagoTx(pedido, { metodo, monto, referencia, usuarioId }) {
  const pedidoId = pedido.id;
  // Se marca como pagado solo si sigue abierto: si dos cobros llegan a la vez, gana uno
  const { changes } = await run(
    `UPDATE pedidos SET estado = 'pagado', cerrado_en = CURRENT_TIMESTAMP, metodo_pago = ? WHERE id = ? AND estado = 'abierto'`,
    [metodo || '', pedidoId]);
  if (!changes) return false;

  await run('INSERT INTO pagos (pedido_id, metodo, monto, referencia) VALUES (?, ?, ?, ?)',
    [pedidoId, metodo, monto, referencia || '']);

  if (pedido.mesa_id) {
    await run('UPDATE mesas SET estado = ? WHERE id = ?', ['libre', pedido.mesa_id]);
  }

  const items = await all('SELECT * FROM pedido_items WHERE pedido_id = ?', [pedidoId]);
  for (const item of items) {
    if (item.producto_id) {
      const producto = await get('SELECT * FROM productos WHERE id = ?', [item.producto_id]);
      if (producto && producto.tracking_stock) {
        await run('UPDATE productos SET stock_actual = stock_actual - ? WHERE id = ?', [item.cantidad, item.producto_id]);
        await run(`INSERT INTO movimientos_stock (producto_id, tipo, cantidad, motivo, usuario_id)
                   VALUES (?, 'venta', ?, ?, ?)`, [item.producto_id, -item.cantidad, `Venta ${pedido.numero_pedido}`, usuarioId || null]);
      }
    }
  }

  emitEvento('pedido:pagado', { id: Number(pedidoId), numero_pedido: pedido.numero_pedido });
  emitEvento('cocina:actualizar', { pedido_id: Number(pedidoId), accion: 'pagado' });
  emitEvento('delivery:actualizar', { pedido_id: Number(pedidoId), accion: 'pagado' });
  emitEvento('dashboard:actualizar', { motivo: 'pedido_pagado' });
  emitEvento('stock:actualizar', { pedido_id: Number(pedidoId), accion: 'venta' });
  return true;
}

const METODOS_PAGO = ['efectivo', 'tarjeta', 'mercadopago', 'transferencia', 'otro'];

module.exports = { generarNumeroPedido, resolverItems, importe, recalcularTotales, registrarPago, registrarPagoTx, METODOS_PAGO };

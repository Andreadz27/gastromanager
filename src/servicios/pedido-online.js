'use strict';
// Pedido online (carta web, links de WhatsApp e Instagram), sin login. Entra directo al local
// (POST /api/publico/pedido) o por Morfi Nube (el local lo trae con sync-nube.js): los dos usan esto.
const { run, get, transaccion } = require('../db');
const { errorHttp } = require('../util');
const { emitEvento } = require('../realtime');
const { generarNumeroPedido, resolverItems, recalcularTotales } = require('./pedidos');
const { comandaAutomatica } = require('./impresion');
const { validarPedidoOnline } = require('../validar-pedido-online');

// nubeId: id del pedido en Morfi Nube. Si ya se trajo (se cortó antes de avisarle a la nube), no se duplica.
async function crearPedidoOnline(datos, { nubeId = null } = {}) {
  const d = validarPedidoOnline(datos);
  if (nubeId) {
    const ya = await get('SELECT id, numero_pedido, total FROM pedidos WHERE nube_pedido_id = ?', [nubeId]);
    if (ya) return { pid: ya.id, numero: ya.numero_pedido, total: ya.total, repetido: true };
  }
  const r = await transaccion(async () => {
    // Precio y nombre salen de la base (nunca del navegador ni de la nube); por la web no se venden insumos sin precio
    const resueltos = await resolverItems(d.items);
    if (resueltos.some(i => !(i.precio > 0))) throw errorHttp(400, 'Producto no disponible');
    const numero = await generarNumeroPedido();
    const { id: pid } = await run(
      `INSERT INTO pedidos (numero_pedido, tipo, cliente, usuario_id, notas, descuento, propina, origen, nube_pedido_id)
       VALUES (?, ?, ?, NULL, ?, 0, 0, ?, ?)`,
      [numero, d.tipo, `${d.cliente} (${d.telefono})`, d.notas, d.origen, nubeId]);
    for (const item of resueltos) {
      await run(`INSERT INTO pedido_items (pedido_id, producto_id, nombre_producto, cantidad, precio_unitario, subtotal, notas)
        VALUES (?, ?, ?, ?, ?, ?, ?)`, [pid, item.producto_id, item.nombre, item.cantidad, item.precio, item.subtotal, item.notas]);
    }
    const { total } = await recalcularTotales(pid);
    // La entrega guarda el teléfono: con eso sale el aviso de WhatsApp "listo" o "en camino"
    if (d.tipo === 'takeaway' || d.direccion) {
      await run(`INSERT INTO entregas (pedido_id, tipo, direccion, telefono, costo_envio, estado, plataforma, codigo_externo)
        VALUES (?, ?, ?, ?, 0, 'pendiente', ?, '')`, [pid, d.tipo, d.direccion, d.telefono, d.origen]);
    }
    emitEvento('pedido:nuevo', { id: pid, numero_pedido: numero, tipo: d.tipo, origen: d.origen, cliente: d.cliente });
    emitEvento('cocina:actualizar', { pedido_id: pid, accion: 'creado' });
    emitEvento('dashboard:actualizar', { motivo: 'pedido_creado' });
    emitEvento('delivery:actualizar', { pedido_id: pid, accion: 'creado' });
    return { pid, numero, total, origen: d.origen };
  });
  await comandaAutomatica(r.pid).catch(() => false);
  return r;
}

module.exports = { crearPedidoOnline };

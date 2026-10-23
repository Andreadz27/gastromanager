'use strict';
// Pedido desde el QR de la mesa: el cliente pide, llama al mozo o pide la cuenta desde su celular.
// Lo que pide queda como "solicitud" hasta que un mozo la confirma (va a cocina) o la rechaza.
// Con qr_mesa_modo = 'directo' el pedido va a cocina sin esperar al mozo.
const crypto = require('crypto');
const { run, get, all, transaccion } = require('../db');
const { emitEvento } = require('../realtime');
const { errorHttp } = require('../util');
const { generarNumeroPedido, resolverItems, recalcularTotales } = require('./pedidos');
const { comandaAutomatica } = require('./impresion');

const MODOS_QR_MESA = ['confirmar', 'directo', 'solo_carta'];
const TIPOS_SOLICITUD = ['pedido', 'mozo', 'cuenta'];
// Topes: sin login cualquiera con el QR puede pedir; un mismo QR no acumula pedidos sin confirmar
const MAX_ITEMS_MESA = 30;
const MAX_CANTIDAD_MESA = 20;
const MAX_PENDIENTES_MESA = 3;

const nuevoTokenMesa = () => crypto.randomBytes(12).toString('hex');

async function modoQrMesa() {
  const cfg = await get('SELECT qr_mesa_modo FROM configuracion WHERE id = 1');
  return MODOS_QR_MESA.includes(cfg && cfg.qr_mesa_modo) ? cfg.qr_mesa_modo : 'confirmar';
}

async function mesaPorToken(token) {
  if (!/^[a-f0-9]{24}$/.test(String(token || ''))) return null;
  return get('SELECT id, nombre, estado FROM mesas WHERE qr_token = ?', [token]);
}

// Ítems tal como los manda el celular: se validan acá y el precio sale siempre de la base
function itemsDelCliente(items) {
  if (!Array.isArray(items) || !items.length) throw errorHttp(400, 'El pedido no tiene ítems');
  if (items.length > MAX_ITEMS_MESA || items.some(i => !i || !(Number(i.cantidad) >= 1) || Number(i.cantidad) > MAX_CANTIDAD_MESA))
    throw errorHttp(400, `Para pedidos grandes llamá al mozo (máximo ${MAX_CANTIDAD_MESA} unidades por producto)`);
  return items.map(i => ({ producto_id: Number(i.producto_id), cantidad: parseInt(i.cantidad, 10), notas: String(i.notas || '').slice(0, 200) }));
}

const resumenSolicitud = s => ({
  id: s.id, tipo: s.tipo, estado: s.estado, motivo: s.motivo || '', creado_en: s.creado_en,
  items: JSON.parse(s.items || '[]'), notas: s.notas || '', cliente: s.cliente || ''
});

// El cliente envía su pedido. Devuelve la solicitud (o, en modo directo, ya confirmada)
async function solicitarPedidoMesa(mesa, { items, notas, cliente }) {
  const modo = await modoQrMesa();
  if (modo === 'solo_carta') throw errorHttp(403, 'En este local los pedidos se hacen con el mozo');
  const pedidos = itemsDelCliente(items);
  const id = await transaccion(async () => {
    const { n } = await get("SELECT COUNT(*) n FROM solicitudes_mesa WHERE mesa_id = ? AND tipo = 'pedido' AND estado = 'pendiente'", [mesa.id]);
    if (n >= MAX_PENDIENTES_MESA) throw errorHttp(429, 'Ya hay pedidos esperando al mozo: en un momento los confirma');
    const resueltos = await resolverItems(pedidos);
    if (resueltos.some(i => !(i.precio > 0))) throw errorHttp(400, 'Producto no disponible');
    const r = await run('INSERT INTO solicitudes_mesa (mesa_id, tipo, items, notas, cliente) VALUES (?, ?, ?, ?, ?)',
      [mesa.id, 'pedido', JSON.stringify(resueltos.map(i => ({ producto_id: i.producto_id, nombre: i.nombre, cantidad: i.cantidad, precio: i.precio, notas: i.notas }))),
       String(notas || '').slice(0, 300), String(cliente || '').trim().slice(0, 60)]);
    return r.id;
  });
  if (modo === 'directo') return confirmarSolicitud(id, null);
  emitEvento('mesa:solicitud', { id, tipo: 'pedido', mesa_id: mesa.id, mesa_nombre: mesa.nombre });
  return resumenSolicitud(await get('SELECT * FROM solicitudes_mesa WHERE id = ?', [id]));
}

// Llamar al mozo o pedir la cuenta. Si ya hay uno igual esperando, no se duplica.
async function llamarMozo(mesa, tipo) {
  if (!['mozo', 'cuenta'].includes(tipo)) throw errorHttp(400, 'Tipo de llamado inválido');
  const id = await transaccion(async () => {
    const ya = await get("SELECT id FROM solicitudes_mesa WHERE mesa_id = ? AND tipo = ? AND estado = 'pendiente'", [mesa.id, tipo]);
    if (ya) return ya.id;
    const r = await run('INSERT INTO solicitudes_mesa (mesa_id, tipo) VALUES (?, ?)', [mesa.id, tipo]);
    emitEvento('mesa:solicitud', { id: r.id, tipo, mesa_id: mesa.id, mesa_nombre: mesa.nombre });
    return r.id;
  });
  return resumenSolicitud(await get('SELECT * FROM solicitudes_mesa WHERE id = ?', [id]));
}

// Lo que ve el cliente en su celular: sus solicitudes de las últimas horas y la cuenta de la mesa
async function estadoMesa(mesa) {
  const solicitudes = await all(`SELECT * FROM solicitudes_mesa WHERE mesa_id = ? AND creado_en >= datetime('now', '-4 hours')
    ORDER BY id DESC LIMIT 20`, [mesa.id]);
  const pedido = await get("SELECT id, subtotal, descuento, total FROM pedidos WHERE mesa_id = ? AND estado = 'abierto' LIMIT 1", [mesa.id]);
  const cuenta = pedido ? {
    items: await all('SELECT nombre_producto, cantidad, subtotal FROM pedido_items WHERE pedido_id = ? ORDER BY id', [pedido.id]),
    subtotal: pedido.subtotal, descuento: pedido.descuento, total: pedido.total
  } : null;
  return { mesa: { nombre: mesa.nombre }, modo: await modoQrMesa(), solicitudes: solicitudes.map(resumenSolicitud), cuenta };
}

// Pendientes para los mozos (de todas las mesas)
async function solicitudesPendientes() {
  const filas = await all(`SELECT s.*, m.nombre AS mesa_nombre FROM solicitudes_mesa s JOIN mesas m ON m.id = s.mesa_id
    WHERE s.estado = 'pendiente' ORDER BY s.id`);
  return filas.map(s => ({ ...resumenSolicitud(s), mesa_id: s.mesa_id, mesa_nombre: s.mesa_nombre }));
}

// Toma la solicitud pendiente y la marca resuelta en el mismo paso: dos mozos tocando
// "Confirmar" a la vez no mandan el pedido dos veces a cocina
async function tomarPendiente(id, tipos, estado, usuarioId, motivo = '') {
  const s = await get(`UPDATE solicitudes_mesa SET estado = ?, usuario_id = ?, motivo = ?, resuelto_en = CURRENT_TIMESTAMP
    WHERE id = ? AND estado = 'pendiente' AND tipo IN (${tipos.map(() => '?').join(',')}) RETURNING *`,
    [estado, usuarioId, motivo, id, ...tipos]);
  if (s) return s;
  const existe = await get('SELECT tipo, estado FROM solicitudes_mesa WHERE id = ?', [id]);
  if (!existe) throw errorHttp(404, 'Solicitud no encontrada');
  if (!tipos.includes(existe.tipo)) throw errorHttp(400, 'Esa acción no corresponde a esta solicitud');
  throw errorHttp(409, 'Otro mozo ya la resolvió');
}

// El mozo confirma: los ítems van al pedido abierto de la mesa (o se abre uno) y salen a cocina.
// itemsCorregidos: el mozo puede quitar o cambiar cantidades antes de confirmar.
async function confirmarSolicitud(id, usuarioId, itemsCorregidos = null) {
  const r = await transaccion(async () => {
    const s = await tomarPendiente(id, ['pedido'], 'confirmada', usuarioId);
    const pedidos = itemsCorregidos ? itemsDelCliente(itemsCorregidos) : JSON.parse(s.items || '[]');
    const items = await resolverItems(pedidos);
    const mesa = await get('SELECT id, nombre FROM mesas WHERE id = ?', [s.mesa_id]);
    if (!mesa) throw errorHttp(404, 'La mesa ya no existe');
    let pedido = await get("SELECT id, numero_pedido FROM pedidos WHERE mesa_id = ? AND estado = 'abierto' LIMIT 1", [mesa.id]);
    const nuevo = !pedido;
    if (nuevo) {
      const numero = await generarNumeroPedido();
      const ins = await run(`INSERT INTO pedidos (numero_pedido, tipo, mesa_id, cliente, usuario_id, notas, descuento, propina, origen)
        VALUES (?, 'salon', ?, ?, ?, ?, 0, 0, 'qr_mesa')`, [numero, mesa.id, s.cliente || '', usuarioId, s.notas || '']);
      pedido = { id: ins.id, numero_pedido: numero };
      await run("UPDATE mesas SET estado = 'ocupada' WHERE id = ?", [mesa.id]);
    } else if (s.notas) {
      await run("UPDATE pedidos SET notas = TRIM(COALESCE(notas, '') || ' ' || ?) WHERE id = ?", [s.notas, pedido.id]);
    }
    const itemIds = [];
    for (const item of items) {
      const ins = await run(`INSERT INTO pedido_items (pedido_id, producto_id, nombre_producto, cantidad, precio_unitario, subtotal, notas)
        VALUES (?, ?, ?, ?, ?, ?, ?)`, [pedido.id, item.producto_id, item.nombre, item.cantidad, item.precio, item.subtotal, item.notas]);
      itemIds.push(ins.id);
    }
    await recalcularTotales(pedido.id);
    await run('UPDATE pedidos SET listo_en = NULL WHERE id = ?', [pedido.id]);
    await run('UPDATE solicitudes_mesa SET pedido_id = ? WHERE id = ?', [pedido.id, s.id]);
    emitEvento(nuevo ? 'pedido:creado' : 'cocina:actualizar', nuevo
      ? { id: pedido.id, numero_pedido: pedido.numero_pedido, tipo: 'salon' }
      : { pedido_id: pedido.id, accion: 'item_agregado' });
    if (nuevo) emitEvento('cocina:actualizar', { pedido_id: pedido.id, accion: 'creado' });
    emitEvento('mesas:actualizar', { mesa_id: mesa.id, estado: 'ocupada' });
    emitEvento('dashboard:actualizar', { motivo: 'pedido_actualizado' });
    emitEvento('mesa:solicitud_resuelta', { id: s.id, mesa_id: mesa.id, estado: 'confirmada' });
    return { solicitud: { ...s, pedido_id: pedido.id }, pedido_id: pedido.id, numero_pedido: pedido.numero_pedido, nuevo, itemIds };
  });
  await (r.nuevo ? comandaAutomatica(r.pedido_id) : comandaAutomatica(r.pedido_id, { itemIds: r.itemIds, titulo: 'AGREGADO' })).catch(() => false);
  return { ...resumenSolicitud(r.solicitud), pedido_id: r.pedido_id, numero_pedido: r.numero_pedido };
}

async function rechazarSolicitud(id, usuarioId, motivo) {
  const s = await tomarPendiente(id, ['pedido'], 'rechazada', usuarioId, String(motivo || '').trim().slice(0, 200));
  emitEvento('mesa:solicitud_resuelta', { id: s.id, mesa_id: s.mesa_id, estado: 'rechazada' });
  return resumenSolicitud(s);
}

// El mozo fue a la mesa (llamado o cuenta)
async function atenderSolicitud(id, usuarioId) {
  const s = await tomarPendiente(id, ['mozo', 'cuenta'], 'atendida', usuarioId);
  emitEvento('mesa:solicitud_resuelta', { id: s.id, mesa_id: s.mesa_id, estado: 'atendida' });
  return resumenSolicitud(s);
}

module.exports = {
  MODOS_QR_MESA, TIPOS_SOLICITUD, nuevoTokenMesa, modoQrMesa, mesaPorToken, solicitarPedidoMesa, llamarMozo, estadoMesa,
  solicitudesPendientes, confirmarSolicitud, rechazarSolicitud, atenderSolicitud
};

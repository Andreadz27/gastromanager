'use strict';
// Validación del pedido online (sin base de datos): la usan el local y Morfi Nube, así los dos aceptan lo mismo.
// Topes: nadie pide 30 platos distintos ni 50 de uno por la web.
const MAX_ITEMS_ONLINE = 30;
const MAX_CANTIDAD_ONLINE = 50;
const error400 = mensaje => Object.assign(new Error(mensaje), { status: 400 });

function validarPedidoOnline(datos) {
  const { tipo, direccion, notas, origen, items } = datos || {};
  const cliente = String((datos && datos.cliente) || '').trim().slice(0, 80);
  const telefono = String((datos && datos.telefono) || '').trim().slice(0, 30);
  if (!cliente || !telefono) throw error400('Nombre y teléfono son obligatorios');
  if (!Array.isArray(items) || !items.length) throw error400('El pedido no tiene ítems');
  if (items.length > MAX_ITEMS_ONLINE || items.some(i => !i || !(Number(i.cantidad) >= 1) || Number(i.cantidad) > MAX_CANTIDAD_ONLINE))
    throw error400(`Para pedidos grandes llamá al local (máximo ${MAX_CANTIDAD_ONLINE} unidades por producto)`);
  const tipoFin = tipo === 'delivery' ? 'delivery' : 'takeaway';
  if (tipoFin === 'delivery' && !String(direccion || '').trim()) throw error400('Falta la dirección de entrega');
  return {
    cliente, telefono, tipo: tipoFin,
    origen: ['whatsapp', 'instagram', 'web'].includes(origen) ? origen : 'web',
    direccion: String(direccion || '').trim().slice(0, 200),
    notas: String(notas || '').slice(0, 500),
    items: items.map(i => ({ producto_id: Number(i.producto_id), cantidad: parseInt(i.cantidad, 10), notas: String(i.notas || '').slice(0, 200) }))
  };
}

module.exports = { validarPedidoOnline, MAX_ITEMS_ONLINE, MAX_CANTIDAD_ONLINE };

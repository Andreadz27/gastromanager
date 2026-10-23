'use strict';
// Pagos de Mercado Pago: el que llega por la notificación (webhook) y el del cliente que paga desde su mesa.
// Desde la mesa el cliente paga toda la cuenta o su parte (partes iguales) con propina; al volver de Mercado Pago
// la página pide verificar el pago, así se acredita aunque la notificación tarde. Siempre se consulta el pago
// a la API de Mercado Pago con nuestro token: nunca se cree lo que dice el celular.
const { run, get, all, transaccion } = require('../db');
const { emitEvento } = require('../realtime');
const { errorHttp } = require('../util');
const { getIntCfg, urlPublica, mpRequest } = require('./integraciones');
const { saldoPedido, registrarCobroTx, recalcularTotales, importe, centavos } = require('./pedidos');
const { normalizarTelefono, configWhatsApp, enviarComprobante, whatsappListo } = require('./whatsapp');

const MAX_PARTES = 20;
const PROPINA_MAXIMA = 0.5; // de lo que paga cada uno: más que eso es un error de tipeo

// Sin dirección pública HTTPS Mercado Pago no avisa ni vuelve a la página: no se ofrece el pago desde la mesa
async function pagoMesaDisponible() {
  const cfg = await getIntCfg('mercadopago');
  return !!(cfg.activa && cfg.access_token && urlPublica().startsWith('https://'));
}

const pedidoAbiertoDeMesa = mesaId => get("SELECT * FROM pedidos WHERE mesa_id = ? AND estado = 'abierto' LIMIT 1", [mesaId]);

// El cliente elige pagar todo (partes = 1) o su parte, con propina. Devuelve el link de Mercado Pago.
async function iniciarPagoMesa(mesa, token, { partes, propina }) {
  if (!(await pagoMesaDisponible())) throw errorHttp(400, 'El pago desde la mesa no está habilitado: pedile la cuenta al mozo');
  const pedido = await pedidoAbiertoDeMesa(mesa.id);
  if (!pedido) throw errorHttp(400, 'La mesa no tiene una cuenta abierta');
  const { saldo } = await saldoPedido(pedido.id);
  if (!(saldo > 0)) throw errorHttp(400, 'La cuenta ya está paga');
  const n = partes === undefined || partes === null ? 1 : Number(partes);
  if (!Number.isInteger(n) || n < 1 || n > MAX_PARTES) throw errorHttp(400, `Se puede dividir entre 1 y ${MAX_PARTES} personas`);
  // Partes iguales redondeadas hacia arriba al centavo; la última nunca paga más que lo que falta
  const monto = Math.min(saldo, Math.ceil(saldo / n * 100) / 100);
  const prop = importe(propina);
  if (prop > centavos(monto * PROPINA_MAXIMA)) throw errorHttp(400, 'La propina no puede superar la mitad de lo que pagás');

  const { id } = await run('INSERT INTO pagos_mesa (pedido_id, mesa_id, monto, propina, partes) VALUES (?, ?, ?, ?, ?)',
    [pedido.id, mesa.id, monto, prop, n]);
  const cfg = await getIntCfg('mercadopago');
  const base = urlPublica();
  const vuelta = `${base}/pedido.html?mesa=${token}&pago=${id}`;
  const preferencia = await mpRequest(cfg, 'POST', '/checkout/preferences', {
    items: [{ title: `${mesa.nombre} - ${n > 1 ? `una parte de ${n}` : 'cuenta'}${prop ? ' + propina' : ''}`, quantity: 1,
      unit_price: centavos(monto + prop), currency_id: 'ARS' }],
    external_reference: `${pedido.id}-T${id}`,
    notification_url: `${base}/api/mp/notificacion`,
    back_urls: { success: vuelta, failure: vuelta, pending: vuelta },
    auto_return: 'approved'
  });
  await run('UPDATE pagos_mesa SET preferencia_id = ? WHERE id = ?', [String(preferencia.id || ''), id]);
  return {
    id, monto, propina: prop, total: centavos(monto + prop),
    link: cfg.modo === 'produccion' ? preferencia.init_point : (preferencia.sandbox_init_point || preferencia.init_point)
  };
}

// Aplica un pago ya consultado a la API de Mercado Pago. Idempotente: MP reenvía notificaciones y el cliente
// puede volver a la página varias veces; cada pago se registra una sola vez.
// external_reference: "<pedido>" (link del cajero) o "<pedido>-T<pago de mesa>" (pago desde la mesa).
async function aplicarPagoMercadoPago(pago) {
  const ref = /^(\d+)(?:-T(\d+))?$/.exec(String(pago.external_reference || ''));
  if (!ref) return null;
  const pedido = await get('SELECT * FROM pedidos WHERE id = ?', [ref[1]]);
  if (!pedido) return null;
  const intento = ref[2] ? await get('SELECT * FROM pagos_mesa WHERE id = ? AND pedido_id = ?', [ref[2], pedido.id]) : null;

  const resultado = await transaccion(async () => {
    await run('UPDATE pedidos SET mp_payment_id = ? WHERE id = ?', [String(pago.id), pedido.id]);
    const referencia = `MP-${pago.id}`;
    const yaRegistrado = await get('SELECT 1 AS x FROM pagos WHERE referencia = ? LIMIT 1', [referencia]);
    let cerrado = false;
    if (intento && pago.status !== 'approved' && intento.estado === 'pendiente' && ['rejected', 'cancelled'].includes(pago.status))
      await run("UPDATE pagos_mesa SET estado = 'rechazado', payment_id = ? WHERE id = ?", [String(pago.id), intento.id]);
    if (pago.status === 'approved' && !yaRegistrado) {
      const monto = centavos(pago.transaction_amount);
      const actual = await get('SELECT estado, numero_pedido, propina FROM pedidos WHERE id = ?', [pedido.id]);
      const alerta = detalle => run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (NULL, ?, ?)', ['alerta_mercadopago', detalle]);
      if (actual.estado !== 'abierto') {
        // El pedido ya se cobró (o canceló) por otro medio: el cliente pagó dos veces
        await alerta(`Pedido ${actual.numero_pedido}: entró un pago de Mercado Pago por $${monto} (pago ${pago.id}) ` +
          `pero el pedido ya estaba ${actual.estado}. Revisar y devolver al cliente desde Mercado Pago.`);
      } else if (monto > 0) {
        // La propina del pago desde la mesa se suma a la del pedido (no se factura) solo si se pagó completo
        const propina = intento && monto >= centavos(intento.monto + intento.propina) - 0.009 ? intento.propina : 0;
        if (propina > 0) {
          await run('UPDATE pedidos SET propina = ? WHERE id = ?', [centavos(Number(actual.propina || 0) + propina), pedido.id]);
          await recalcularTotales(pedido.id);
        }
        // Se cobra lo que pagó, nunca más que el saldo: si el link era viejo y la mesa pidió algo más, queda saldo pendiente
        const { saldo } = await saldoPedido(pedido.id);
        const r = await registrarCobroTx(pedido.id, { pagos: [{ metodo: 'mercadopago', monto: Math.min(monto, saldo), referencia }], usuarioId: null });
        cerrado = r.cerrado;
        await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (NULL, ?, ?)',
          ['pago_mercadopago', `Pedido ${actual.numero_pedido}: ${r.cerrado ? 'cobrado' : `cobro parcial de $${r.cobrado}, falta $${r.saldo}`} por Mercado Pago (pago ${pago.id})${intento ? ' desde la mesa' : ''}`]);
        if (monto > saldo + 0.009)
          await alerta(`Pedido ${actual.numero_pedido}: Mercado Pago cobró $${monto} y el saldo era $${saldo}. Devolver $${centavos(monto - saldo)} al cliente.`);
        if (intento) {
          await run("UPDATE pagos_mesa SET estado = 'aprobado', payment_id = ? WHERE id = ?", [String(pago.id), intento.id]);
          // El mozo ve que la mesa pagó (y la propina) para despedir a los clientes
          const mesa = await get('SELECT id, nombre FROM mesas WHERE id = ?', [intento.mesa_id]);
          const notas = `Pagó $${monto} con Mercado Pago${propina ? ` (propina $${propina})` : ''}${r.cerrado ? ' - cuenta cerrada' : ` - falta $${r.saldo}`}`;
          const s = await run("INSERT INTO solicitudes_mesa (mesa_id, tipo, notas, pedido_id) VALUES (?, 'pago', ?, ?)", [intento.mesa_id, notas, pedido.id]);
          emitEvento('mesa:solicitud', { id: s.id, tipo: 'pago', mesa_id: intento.mesa_id, mesa_nombre: mesa ? mesa.nombre : '', detalle: notas });
        }
      }
    }
    emitEvento('pago:recibido', { payment_id: pago.id, pedido_id: pedido.id, estado: pago.status });
    return { pedido_id: pedido.id, cerrado };
  });
  // Con la cuenta cerrada salen los comprobantes que pidieron por WhatsApp (fuera de la transacción: es HTTP)
  if (resultado.cerrado) await enviarComprobantesPendientes(pedido.id);
  return resultado;
}

// Al volver de Mercado Pago: se consulta el pago y se aplica (si la notificación ya llegó, no hace nada)
async function verificarPagoMesa(mesa, intentoId, paymentId) {
  const intento = await get('SELECT * FROM pagos_mesa WHERE id = ? AND mesa_id = ?', [intentoId, mesa.id]);
  if (!intento) throw errorHttp(404, 'Pago no encontrado');
  if (paymentId && intento.estado === 'pendiente') {
    if (!/^\d{1,20}$/.test(String(paymentId))) throw errorHttp(400, 'Pago inválido');
    const pago = await mpRequest(await getIntCfg('mercadopago'), 'GET', `/v1/payments/${encodeURIComponent(paymentId)}`);
    if (String(pago.external_reference) !== `${intento.pedido_id}-T${intento.id}`) throw errorHttp(400, 'Ese pago no corresponde a esta mesa');
    await aplicarPagoMercadoPago(pago);
  }
  return estadoPagoMesa(intento.id);
}

async function estadoPagoMesa(id) {
  const p = await get('SELECT p.id, p.monto, p.propina, p.estado, p.telefono, p.comprobante_enviado, d.estado AS estado_pedido FROM pagos_mesa p JOIN pedidos d ON d.id = p.pedido_id WHERE p.id = ?', [id]);
  return { id: p.id, monto: p.monto, propina: p.propina, estado: p.estado, cuenta_cerrada: p.estado_pedido === 'pagado',
    comprobante: p.comprobante_enviado ? 'enviado' : p.telefono ? 'al cerrar la cuenta' : '' };
}

// El cliente que pagó pide el comprobante por WhatsApp: sale ya si la cuenta está cerrada, si no al cerrarse
async function pedirComprobanteMesa(mesa, intentoId, telefono) {
  if (!whatsappListo(await configWhatsApp())) throw errorHttp(400, 'El local no tiene WhatsApp configurado: pedile el ticket al mozo');
  const intento = await get(`SELECT * FROM pagos_mesa WHERE id = ? AND mesa_id = ? AND estado = 'aprobado'
    AND creado_en >= datetime('now', '-6 hours')`, [intentoId, mesa.id]);
  if (!intento) throw errorHttp(404, 'Pago no encontrado');
  if (intento.comprobante_enviado) throw errorHttp(409, 'El comprobante ya se envió');
  if (!normalizarTelefono(telefono)) throw errorHttp(400, 'Revisá el número de WhatsApp (con característica, ej. 11 1234-5678)');
  await run('UPDATE pagos_mesa SET telefono = ? WHERE id = ?', [String(telefono).slice(0, 30), intento.id]);
  await enviarComprobantesPendientes(intento.pedido_id);
  return estadoPagoMesa(intento.id);
}

async function enviarComprobantesPendientes(pedidoId) {
  const pedido = await get('SELECT estado FROM pedidos WHERE id = ?', [pedidoId]);
  if (!pedido || pedido.estado !== 'pagado') return;
  for (const p of await all("SELECT id, telefono FROM pagos_mesa WHERE pedido_id = ? AND estado = 'aprobado' AND telefono != '' AND comprobante_enviado = 0", [pedidoId])) {
    // Se marca antes de enviar: dos llamadas a la vez no mandan dos mensajes
    const tomado = await run('UPDATE pagos_mesa SET comprobante_enviado = 1 WHERE id = ? AND comprobante_enviado = 0', [p.id]);
    if (!tomado.changes) continue;
    try { await enviarComprobante(pedidoId, p.telefono); } catch (e) {
      await run('UPDATE pagos_mesa SET comprobante_enviado = 0 WHERE id = ?', [p.id]);
      console.error('[WhatsApp comprobante de la mesa]', e.message);
    }
  }
}

module.exports = {
  pagoMesaDisponible, iniciarPagoMesa, aplicarPagoMercadoPago, verificarPagoMesa, estadoPagoMesa, pedirComprobanteMesa
};

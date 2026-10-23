'use strict';
// Modo sin conexión. El sistema corre en la PC del local: sin internet los mozos, la cocina y la caja siguen
// trabajando por el WiFi. Lo que necesita internet (ARCA, Mercado Pago, WhatsApp, copias en la nube) espera:
// - las facturas que no se pudieron pedir a ARCA quedan "en espera" y se emiten solas cuando vuelve la conexión;
// - se revisa si hay internet y se avisa en las pantallas cuando se corta y cuando vuelve.
const net = require('net');
const { run, get, all } = require('../db');
const { emitEvento } = require('../realtime');
const { errorHttp } = require('../util');
const { emitirFactura } = require('./facturacion');

// ¿El error es por falta de conexión (se puede reintentar) o ARCA contestó que no (lo tiene que ver una persona)?
function esFaltaDeConexion(e) {
  if (!e || e.noReintentar) return false;
  const status = Number(e.status || (e.response && e.response.status)) || 0;
  if (status >= 500 || status === 429) return true;
  if (status) return false; // validaciones (400, 409...)
  return /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|socket hang up|timeout|network/i
    .test(`${e.code || ''} ${e.message || ''}`);
}

const facturaEnEspera = pedidoId => get("SELECT * FROM facturas_pendientes WHERE pedido_id = ? AND estado = 'pendiente' LIMIT 1", [pedidoId]);

// Factura del pedido o, si no hay conexión con ARCA, en espera. { pendiente: true, mensaje } si quedó esperando.
async function facturarOEncolar(pedidoId, { tipo, cuit, condicion, razonSocial }) {
  if (await facturaEnEspera(pedidoId)) throw errorHttp(409, 'La factura de este pedido ya está en espera: se emite sola cuando vuelva la conexión.');
  try {
    return await emitirFactura(pedidoId, tipo, cuit, { condicionIva: condicion, razonSocial });
  } catch (e) {
    if (!esFaltaDeConexion(e)) throw e;
    const { id } = await run(`INSERT INTO facturas_pendientes
      (pedido_id, tipo_comprobante, cuit_receptor, condicion_iva_receptor, razon_social_receptor, intentos, numero_intentado, ultimo_error)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      [pedidoId, tipo, cuit || '', condicion || null, String(razonSocial || '').slice(0, 200), e.numeroIntentado || null, String(e.message).slice(0, 300)]);
    emitEvento('afip:pendientes', { cantidad: (await contarPendientes()).pendientes });
    return { ok: false, pendiente: true, id,
      mensaje: 'Sin conexión con ARCA: la factura quedó en espera y se emite sola cuando vuelva internet.' };
  }
}

async function contarPendientes() {
  const r = await get(`SELECT SUM(estado = 'pendiente') AS pendientes, SUM(estado = 'error') AS con_error FROM facturas_pendientes`);
  return { pendientes: Number(r.pendientes) || 0, con_error: Number(r.con_error) || 0 };
}

const listarFacturasPendientes = () => all(`SELECT f.*, p.numero_pedido, p.total FROM facturas_pendientes f
  JOIN pedidos p ON p.id = f.pedido_id WHERE f.estado IN ('pendiente', 'error') ORDER BY f.id`);

// Reintenta las facturas en espera, en orden. Si sigue sin conexión, corta (las demás también fallarían).
let procesando = null;
function procesarFacturasPendientes() {
  if (!procesando) procesando = procesar().finally(() => { procesando = null; });
  return procesando;
}
async function procesar() {
  const resultado = { emitidas: 0, con_error: 0, siguen: 0 };
  for (const f of await all("SELECT * FROM facturas_pendientes WHERE estado = 'pendiente' ORDER BY id")) {
    try {
      const r = await emitirFactura(f.pedido_id, f.tipo_comprobante, f.cuit_receptor,
        { condicionIva: f.condicion_iva_receptor, razonSocial: f.razon_social_receptor, numeroIntentado: f.numero_intentado });
      await run("UPDATE facturas_pendientes SET estado = 'emitida', comprobante_id = ?, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?", [r.id, f.id]);
      const p = await get('SELECT numero_pedido FROM pedidos WHERE id = ?', [f.pedido_id]);
      emitEvento('afip:pendiente_emitida', { pedido_id: f.pedido_id, numero_pedido: p && p.numero_pedido, tipo_nombre: r.tipo_nombre, cae: r.cae });
      resultado.emitidas++;
    } catch (e) {
      if (esFaltaDeConexion(e)) {
        await run(`UPDATE facturas_pendientes SET intentos = intentos + 1, ultimo_error = ?, numero_intentado = COALESCE(?, numero_intentado),
          actualizado_en = CURRENT_TIMESTAMP WHERE id = ?`, [String(e.message).slice(0, 300), e.numeroIntentado || null, f.id]);
        resultado.siguen = (await contarPendientes()).pendientes;
        break;
      }
      // ARCA la rechazó (o ya estaba facturado): queda para que la revise una persona
      await run("UPDATE facturas_pendientes SET estado = 'error', ultimo_error = ?, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?",
        [String(e.message).slice(0, 300), f.id]);
      const p = await get('SELECT numero_pedido FROM pedidos WHERE id = ?', [f.pedido_id]);
      await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (NULL, ?, ?)',
        ['alerta_afip', `La factura en espera del pedido ${p && p.numero_pedido} no se pudo emitir: ${e.message}`]);
      emitEvento('afip:pendiente_error', { pedido_id: f.pedido_id, numero_pedido: p && p.numero_pedido, error: e.message });
      resultado.con_error++;
    }
  }
  emitEvento('afip:pendientes', { cantidad: (await contarPendientes()).pendientes });
  return resultado;
}

// La deja de lado (ya se facturó a mano, o no corresponde): no se reintenta más
async function descartarFacturaPendiente(id, usuarioId) {
  const r = await run("UPDATE facturas_pendientes SET estado = 'descartada', actualizado_en = CURRENT_TIMESTAMP WHERE id = ? AND estado IN ('pendiente', 'error')", [id]);
  if (!r.changes) throw errorHttp(404, 'No está en espera');
  await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, ?, ?)', [usuarioId, 'factura_pendiente_descartada', `Factura en espera ${id} descartada`]);
  emitEvento('afip:pendientes', { cantidad: (await contarPendientes()).pendientes });
}

// ---- ¿Hay internet? ----
// Se prueba abrir una conexión a ARCA (no alcanza con el DNS: Windows guarda las direcciones y "resuelve" sin internet).
// GM_CONEXION_HOST (host:puerto) cambia el destino; en los tests, si no se define, no se revisa.
const conexion = { internet: true, desde: null };
function cambiarConexion(internet) {
  if (conexion.internet === internet) return;
  conexion.internet = internet;
  conexion.desde = new Date().toISOString();
  emitEvento('conexion:internet', { ...conexion });
  // Volvió: salen las facturas que esperaban
  if (internet) procesarFacturasPendientes().catch(e => console.error('[facturas en espera]', e.message));
}

function probarConexion(destino, ms = 5000) {
  const [host, puerto] = destino.split(':');
  return new Promise(ok => {
    const s = net.connect({ host, port: Number(puerto) || 443 });
    const fin = r => { s.destroy(); ok(r); };
    s.setTimeout(ms, () => fin(false));
    s.once('connect', () => fin(true));
    s.once('error', () => fin(false));
  });
}

async function revisarConexion() {
  const destino = process.env.GM_CONEXION_HOST || 'servicios1.afip.gov.ar:443';
  cambiarConexion(await probarConexion(destino));
  return { ...conexion };
}

function iniciarModoSinConexion() {
  const revisar = process.env.NODE_ENV !== 'test' || process.env.GM_CONEXION_HOST;
  const cada = Number(process.env.GM_CONEXION_INTERVALO_MS) || 30000;
  if (revisar) {
    revisarConexion().catch(() => {});
    setInterval(() => revisarConexion().catch(() => {}), cada).unref();
  }
  // Por si la conexión volvió entre revisiones: cada 2 minutos se reintenta lo que espera
  setInterval(() => procesarFacturasPendientes().catch(e => console.error('[facturas en espera]', e.message)),
    Number(process.env.GM_FACTURAS_REINTENTO_MS) || 120000).unref();
}

async function estadoConexion() {
  return { ...conexion, facturas: await contarPendientes() };
}

module.exports = {
  esFaltaDeConexion, facturarOEncolar, facturaEnEspera, procesarFacturasPendientes, listarFacturasPendientes,
  descartarFacturaPendiente, iniciarModoSinConexion, estadoConexion, revisarConexion
};

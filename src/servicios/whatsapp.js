'use strict';
// WhatsApp Business (API oficial de Meta, "Cloud API"): avisos al cliente con plantillas aprobadas.
// - Comprobante después de cobrar (lo manda el mozo o la caja)
// - Pedido listo para retirar (al marcarlo en cocina) y pedido en camino (delivery)
// - Recordatorio de reservas unas horas antes
// Meta solo deja iniciar conversaciones con plantillas aprobadas en WhatsApp Manager: los nombres se configuran
// en Integraciones → WhatsApp. Cada envío queda en whatsapp_mensajes con su estado (enviado, entregado, leído).
const crypto = require('crypto');
const { run, get, all } = require('../db');
const { emitEvento } = require('../realtime');
const { offsetZonaMin } = require('../tiempo');
const { getIntCfg } = require('./integraciones');

// GM_WA_API_URL: API de Meta alternativa (los tests usan una simulada)
const API_WA = (process.env.GM_WA_API_URL || 'https://graph.facebook.com').replace(/\/$/, '');
const VERSION_API = 'v21.0';

const PLANTILLAS_POR_DEFECTO = {
  comprobante: 'comprobante_compra',
  pedido_estado: 'estado_pedido',
  recordatorio_reserva: 'recordatorio_reserva'
};

async function configWhatsApp() {
  const cfg = await getIntCfg('whatsapp');
  return { ...cfg, plantillas: { ...PLANTILLAS_POR_DEFECTO, ...(cfg.plantillas || {}) }, idioma: cfg.idioma || 'es_AR' };
}
const listo = cfg => !!(cfg.activa && cfg.phone_number_id && cfg.access_token);

// Teléfono argentino → formato internacional de WhatsApp (549 + característica + número, sin 0 ni 15).
// Acepta "011 15-1234-5678", "+54 9 11 1234-5678", "1112345678"... Devuelve null si no se puede interpretar.
function normalizarTelefono(tel) {
  let d = String(tel || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('54')) {
    d = d.slice(2);
    if (d.startsWith('9')) d = d.slice(1);
  }
  if (d.startsWith('0')) d = d.slice(1);
  // Con el 15 de celular: característica de 2 a 4 dígitos + 15 + número (quedan 12 dígitos)
  if (d.length === 12) {
    for (const largo of [2, 3, 4]) {
      if (d.slice(largo, largo + 2) === '15') { d = d.slice(0, largo) + d.slice(largo + 2); break; }
    }
  }
  return d.length === 10 ? '549' + d : null;
}

async function waRequest(cfg, body) {
  const r = await fetch(`${API_WA}/${VERSION_API}/${encodeURIComponent(cfg.phone_number_id)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = data.error || {};
    throw new Error(`WhatsApp ${r.status}: ${e.error_user_msg || e.message || 'error'}${e.code ? ` (código ${e.code})` : ''}`);
  }
  return data;
}

// Envía una plantilla y deja registro. motivo + referencia identifican el aviso (ej. pedido_listo, 15):
// con unico = true no se manda dos veces el mismo aviso automático.
const enCurso = new Set();
async function enviarPlantilla({ telefono, plantilla, parametros = [], motivo, referencia = null, unico = false, cfg }) {
  cfg = cfg || await configWhatsApp();
  if (!listo(cfg)) throw Object.assign(new Error('WhatsApp no está configurado o activo (Integraciones → WhatsApp).'), { status: 400 });
  const destino = normalizarTelefono(telefono);
  if (!destino) throw Object.assign(new Error('El teléfono no es válido (ej: 11 1234-5678 con característica).'), { status: 400 });

  const clave = `${motivo}:${referencia}`;
  if (unico) {
    if (enCurso.has(clave)) return null;
    const ya = await get("SELECT id FROM whatsapp_mensajes WHERE motivo = ? AND referencia = ? AND estado != 'error'", [motivo, referencia]);
    if (ya) return null;
  }
  enCurso.add(clave);
  const { id } = await run(
    `INSERT INTO whatsapp_mensajes (telefono, plantilla, motivo, referencia, parametros, estado)
     VALUES (?, ?, ?, ?, ?, 'enviando')`, [destino, plantilla, motivo, referencia, JSON.stringify(parametros)]);
  try {
    const r = await waRequest(cfg, {
      messaging_product: 'whatsapp',
      to: destino,
      type: 'template',
      template: {
        name: plantilla,
        language: { code: cfg.idioma },
        ...(parametros.length ? { components: [{ type: 'body', parameters: parametros.map(t => ({ type: 'text', text: String(t) })) }] } : {})
      }
    });
    const waId = (r.messages && r.messages[0] && r.messages[0].id) || '';
    await run("UPDATE whatsapp_mensajes SET estado = 'enviado', wa_message_id = ? WHERE id = ?", [waId, id]);
    emitEvento('whatsapp:mensaje', { id, motivo, estado: 'enviado' });
    return { id, telefono: destino, wa_message_id: waId };
  } catch (e) {
    await run("UPDATE whatsapp_mensajes SET estado = 'error', error = ? WHERE id = ?", [String(e.message).slice(0, 500), id]);
    throw e;
  } finally {
    enCurso.delete(clave);
  }
}

const moneda = n => '$ ' + new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(Number(n) || 0);
const nombreNegocio = async () => ((await get('SELECT nombre_negocio FROM configuracion WHERE id = 1')) || {}).nombre_negocio || 'el local';

// Comprobante de un pedido cobrado: {{1}} cliente, {{2}} negocio, {{3}} total, {{4}} comprobante
async function enviarComprobante(pedidoId, telefono) {
  const pedido = await get('SELECT * FROM pedidos WHERE id = ?', [pedidoId]);
  if (!pedido) throw Object.assign(new Error('Pedido no encontrado'), { status: 404 });
  if (pedido.estado !== 'pagado') throw Object.assign(new Error('El pedido todavía no está cobrado'), { status: 400 });
  const factura = await get(`SELECT * FROM comprobantes_afip f WHERE f.pedido_id = ? AND f.tipo_comprobante IN (1, 6, 11)
    AND NOT EXISTS (SELECT 1 FROM comprobantes_afip nc WHERE nc.comprobante_asociado_id = f.id) ORDER BY f.id DESC LIMIT 1`, [pedidoId]);
  const comprobante = factura
    ? `${factura.tipo_comprobante_nombre} ${String(factura.punto_venta).padStart(4, '0')}-${String(factura.numero_comprobante).padStart(8, '0')} (CAE ${factura.cae})`
    : `Pedido ${pedido.numero_pedido}`;
  const cfg = await configWhatsApp();
  return enviarPlantilla({
    cfg, telefono, plantilla: cfg.plantillas.comprobante, motivo: 'comprobante', referencia: pedidoId,
    parametros: [pedido.cliente || 'cliente', await nombreNegocio(), moneda(pedido.total), comprobante]
  });
}

// Aviso de estado de pedido: {{1}} cliente, {{2}} número, {{3}} negocio, {{4}} "listo para retirar" / "en camino".
// Automático y sin repetir; si falla solo queda en el registro (no corta la operación de cocina o delivery).
async function avisarEstadoPedido(pedidoId, estado) {
  const cfg = await configWhatsApp();
  if (!listo(cfg) || !cfg.avisar_pedidos) return null;
  const pedido = await get(`SELECT p.*, e.telefono AS telefono_entrega FROM pedidos p
    LEFT JOIN entregas e ON e.pedido_id = p.id WHERE p.id = ?`, [pedidoId]);
  if (!pedido || !pedido.telefono_entrega || !normalizarTelefono(pedido.telefono_entrega)) return null;
  const texto = { listo: 'listo para retirar', en_camino: 'en camino' }[estado];
  if (!texto) return null;
  return enviarPlantilla({
    cfg, telefono: pedido.telefono_entrega, plantilla: cfg.plantillas.pedido_estado, unico: true,
    motivo: `pedido_${estado}`, referencia: pedidoId,
    parametros: [pedido.cliente || 'cliente', pedido.numero_pedido, await nombreNegocio(), texto]
  }).catch(e => { console.error('[WhatsApp aviso de pedido]', e.message); return null; });
}

// Recordatorio de las reservas confirmadas que empiezan dentro de las próximas N horas (hora del negocio):
// {{1}} cliente, {{2}} negocio, {{3}} fecha, {{4}} hora, {{5}} personas
async function enviarRecordatoriosReservas() {
  const cfg = await configWhatsApp();
  const horas = Number(cfg.recordatorio_horas) || 0;
  if (!listo(cfg) || horas <= 0) return 0;
  const local = ms => new Date(ms + offsetZonaMin() * 60000).toISOString().slice(0, 16).replace('T', ' ');
  const ahora = local(Date.now());
  const hasta = local(Date.now() + horas * 3600e3);
  const reservas = await all(`
    SELECT r.* FROM reservas r
    WHERE r.estado = 'confirmada' AND r.telefono != '' AND (r.fecha || ' ' || r.hora) > ? AND (r.fecha || ' ' || r.hora) <= ?
      AND NOT EXISTS (SELECT 1 FROM whatsapp_mensajes w WHERE w.motivo = 'recordatorio_reserva' AND w.referencia = r.id AND w.estado != 'error')`,
    [ahora, hasta]);
  const negocio = await nombreNegocio();
  let enviados = 0;
  for (const r of reservas) {
    if (!normalizarTelefono(r.telefono)) continue;
    const [a, m, d] = r.fecha.split('-');
    const ok = await enviarPlantilla({
      cfg, telefono: r.telefono, plantilla: cfg.plantillas.recordatorio_reserva, unico: true,
      motivo: 'recordatorio_reserva', referencia: r.id,
      parametros: [r.cliente, negocio, `${d}/${m}/${a}`, r.hora, String(r.personas || 2)]
    }).catch(e => { console.error('[WhatsApp recordatorio]', e.message); return null; });
    if (ok) enviados++;
  }
  return enviados;
}

// Revisa las reservas cada 5 minutos (GM_WA_INTERVALO_MS en los tests)
function iniciarRecordatoriosWhatsApp() {
  const ms = Number(process.env.GM_WA_INTERVALO_MS) || 5 * 60 * 1000;
  const revisar = () => enviarRecordatoriosReservas().catch(e => console.error('[WhatsApp recordatorios]', e.message));
  setInterval(revisar, ms).unref();
}

// ---------- Webhook de Meta ----------
// Firma: X-Hub-Signature-256 = sha256 HMAC del cuerpo crudo con el "secreto de la app". Sin secreto no se acepta nada.
function firmaValida(cfg, cuerpoCrudo, firma) {
  if (!cfg.app_secret || !cuerpoCrudo || !firma) return false;
  const esperada = 'sha256=' + crypto.createHmac('sha256', cfg.app_secret).update(cuerpoCrudo).digest('hex');
  const a = Buffer.from(esperada), b = Buffer.from(String(firma));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const ESTADOS_META = { sent: 'enviado', delivered: 'entregado', read: 'leido', failed: 'error' };
const ORDEN_ESTADO = { enviando: 0, enviado: 1, entregado: 2, leido: 3 };

// Estados de los mensajes enviados y mensajes que escriben los clientes (quedan para responder y para un futuro asistente)
async function procesarWebhook(body) {
  for (const entrada of [].concat((body && body.entry) || [])) {
    for (const cambio of [].concat(entrada.changes || [])) {
      const v = cambio.value || {};
      for (const st of [].concat(v.statuses || [])) {
        const estado = ESTADOS_META[st.status];
        if (!estado || !st.id) continue;
        const msg = await get('SELECT id, estado FROM whatsapp_mensajes WHERE wa_message_id = ?', [String(st.id)]);
        // Meta puede mandar los estados desordenados: "entregado" no pisa a "leído"
        if (!msg || (estado !== 'error' && (ORDEN_ESTADO[estado] || 0) <= (ORDEN_ESTADO[msg.estado] || 0))) continue;
        const error = estado === 'error' ? [].concat(st.errors || []).map(e => e.title || e.message).join('; ') : null;
        await run('UPDATE whatsapp_mensajes SET estado = ?, error = COALESCE(?, error) WHERE id = ?', [estado, error, msg.id]);
      }
      const contactos = Object.fromEntries([].concat(v.contacts || []).map(c => [c.wa_id, (c.profile && c.profile.name) || '']));
      for (const m of [].concat(v.messages || [])) {
        if (!m.id || await get('SELECT 1 AS x FROM whatsapp_entrantes WHERE wa_message_id = ?', [String(m.id)])) continue;
        const texto = (m.text && m.text.body) || (m.button && m.button.text) || `[${m.type || 'mensaje'}]`;
        await run('INSERT INTO whatsapp_entrantes (wa_message_id, telefono, nombre, texto) VALUES (?, ?, ?, ?)',
          [String(m.id), String(m.from || ''), contactos[m.from] || '', String(texto).slice(0, 2000)]);
        emitEvento('whatsapp:entrante', { telefono: m.from, nombre: contactos[m.from] || '', texto: String(texto).slice(0, 200) });
      }
    }
  }
}

module.exports = {
  normalizarTelefono, configWhatsApp, enviarPlantilla, enviarComprobante, avisarEstadoPedido,
  enviarRecordatoriosReservas, iniciarRecordatoriosWhatsApp, firmaValida, procesarWebhook, PLANTILLAS_POR_DEFECTO
};

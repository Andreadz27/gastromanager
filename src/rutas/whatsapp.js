'use strict';
const {
  all, errorInterno, autenticar, esAdmin, requiereCobro, pedidoDeSalon,
  configWhatsApp, enviarPlantilla, enviarComprobante, firmaValida, procesarWebhook,
  run, configAsistente, responderAsistente, usoAsistente, reactivarConversacion
} = require('../contexto');
const Anthropic = require('@anthropic-ai/sdk');

module.exports = function registrarRutas(app) {

// ============ WHATSAPP BUSINESS ============
// La configuración se guarda con las demás integraciones (PUT /api/integraciones/config/whatsapp)

// Comprobante del pedido cobrado al teléfono del cliente (caja, o el mozo en sus mesas con cobro en la mesa)
app.post('/api/whatsapp/comprobante/:pedidoId', autenticar, requiereCobro, async (req, res) => {
  try {
    if (!req.puedeCobrarTodo && !(await pedidoDeSalon(req.params.pedidoId)))
      return res.status(403).json({ error: 'Tu usuario solo puede enviar comprobantes de pedidos de mesa' });
    res.json(await enviarComprobante(Number(req.params.pedidoId), (req.body || {}).telefono));
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error('[WhatsApp comprobante]', e.message);
    res.status(502).json({ error: e.message });
  }
});

// Mensaje de prueba con la plantilla "hello_world" (viene aprobada en toda cuenta de WhatsApp Business)
app.post('/api/whatsapp/prueba', autenticar, esAdmin, async (req, res) => {
  try {
    const r = await enviarPlantilla({ telefono: (req.body || {}).telefono, plantilla: 'hello_world', motivo: 'prueba' });
    res.json({ ok: true, message: `Mensaje de prueba enviado a +${r.telefono}.` });
  } catch (e) {
    res.status(e.status || 502).json({ ok: false, error: e.message });
  }
});

// Últimos mensajes enviados y recibidos
app.get('/api/whatsapp/mensajes', autenticar, esAdmin, async (req, res) => {
  try {
    const limite = Math.min(parseInt(req.query.limit, 10) || 30, 200);
    const [enviados, recibidos] = await Promise.all([
      all('SELECT * FROM whatsapp_mensajes ORDER BY id DESC LIMIT ?', [limite]),
      all('SELECT * FROM whatsapp_entrantes ORDER BY id DESC LIMIT ?', [limite])
    ]);
    res.json({ enviados, recibidos });
  } catch (e) { errorInterno(res, e); }
});

// Webhook de Meta. GET: verificación al suscribirlo (hub.verify_token). POST: estados y mensajes, con firma.
app.get('/api/whatsapp/webhook', async (req, res) => {
  try {
    const cfg = await configWhatsApp();
    if (req.query['hub.mode'] === 'subscribe' && cfg.verify_token && req.query['hub.verify_token'] === cfg.verify_token)
      return res.status(200).type('text/plain').send(String(req.query['hub.challenge'] || ''));
    res.sendStatus(403);
  } catch (e) { res.sendStatus(500); }
});

app.post('/api/whatsapp/webhook', async (req, res) => {
  try {
    const cfg = await configWhatsApp();
    if (!firmaValida(cfg, req.rawBody, req.get('x-hub-signature-256'))) return res.sendStatus(401);
    await procesarWebhook(req.body);
    res.sendStatus(200);
  } catch (e) {
    console.error('[WhatsApp webhook]', e.message);
    res.sendStatus(500); // Meta reintenta
  }
});

// ============ ASISTENTE IA ============

// Uso de los últimos 30 días y conversaciones que el asistente pasó a una persona
app.get('/api/asistente/estado', autenticar, esAdmin, async (req, res) => {
  try {
    const [uso, derivadas] = await Promise.all([usoAsistente(), all(`SELECT telefono, nombre, pausado_hasta, actualizado_en
      FROM asistente_conversaciones WHERE pausado_hasta > ? ORDER BY actualizado_en DESC`, [new Date().toISOString()])]);
    res.json({ uso, derivadas });
  } catch (e) { errorInterno(res, e); }
});

// Probar el asistente desde Integraciones: misma IA y carta, pero no crea pedidos ni reservas ni avisa a nadie
const TEL_PRUEBA = 'prueba-panel';
app.post('/api/asistente/probar', autenticar, esAdmin, async (req, res) => {
  try {
    const texto = String((req.body && req.body.texto) || '').trim().slice(0, 1000);
    if (!texto) return res.status(400).json({ error: 'Escribí un mensaje' });
    const cfg = await configAsistente();
    if (!cfg.api_key) return res.status(400).json({ error: 'Falta la clave de la API de Claude' });
    if (req.body.reiniciar) await run('DELETE FROM asistente_conversaciones WHERE telefono = ?', [TEL_PRUEBA]);
    const respuesta = await responderAsistente({ telefono: TEL_PRUEBA, nombre: req.usuario.nombre, texto },
      { cfg: { ...cfg, activa: true, simulacro: true } });
    res.json({ respuesta: respuesta || '(sin respuesta)' });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return res.status(400).json({ error: 'La clave de la API de Claude no es válida' });
    if (e instanceof Anthropic.APIError) return res.status(502).json({ error: `Claude respondió ${e.status || 'sin conexión'}: revisá el saldo de la cuenta o probá en un rato` });
    errorInterno(res, e);
  }
});

// Volver a activar el asistente en una conversación que se pasó a una persona
app.post('/api/asistente/reactivar', autenticar, esAdmin, async (req, res) => {
  try {
    await reactivarConversacion(String((req.body && req.body.telefono) || ''));
    res.json({ ok: true });
  } catch (e) { errorInterno(res, e); }
});

};

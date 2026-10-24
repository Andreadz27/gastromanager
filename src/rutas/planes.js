'use strict';
const { autenticar, esAdmin, errorInterno, requierePlan, tiene, estadoLicencia, guardarLicencia } = require('../contexto');
const { PLANES, EXTRAS, MODULOS, DESCUENTOS, DIAS_PRUEBA, DIAS_GRACIA, VENTAS, planMinimo } = require('../planes');

module.exports = function registrarRutas(app) {

// ============ PLANES ============
// Qué rutas son de cada módulo (ver src/planes.js). Se registra antes que las rutas de los módulos.
// Lo que no está acá es de todos los planes. Se deja usar lo necesario para cerrar lo que ya estaba en marcha:
// sacar un canje o un cupón, resolver los pedidos de mesa pendientes, acreditar un pago de Mercado Pago iniciado,
// cobrar con una gift card ya vendida.
const RUTAS = [
  [/^\/api\/personal\//, 'personal'],
  [/^\/api\/contabilidad\//, 'contabilidad'],
  [/^\/api\/fidelizacion\/(cupones|gift-cards$)/, 'fidelizacion'],
  [/^\/api\/pedidos\/\d+\/(puntos|cupon)$/, 'fidelizacion', ['POST']],
  [/^\/api\/clientes\/\d+\/puntos$/, 'fidelizacion', ['POST']],
  [/^\/api\/reportes\/rentabilidad$/, 'costos'],
  [/^\/api\/productos\/\d+\/receta$/, 'costos'],
  [/^\/api\/whatsapp\/(comprobante|prueba)/, 'whatsapp'],
  [/^\/api\/asistente\//, 'asistente'],
  // Llamar al mozo desde el QR está en todos los planes (el QR queda en "solo ver la carta": ver estadoMesa)
  [/^\/api\/publico\/mesa\/[^/]+\/(pedido|pagar)$/, 'mesa_qr'],
  [/^\/api\/publico\/pedido$/, 'online'],
  [/^\/api\/(integraciones\/tiendanube\/|tiendanube\/webhook$)/, 'online'],
  [/^\/api\/delivery\/plataformas\/[^/]+\/integracion/, 'apps_delivery'],
  [/^\/api\/webhooks\//, 'apps_delivery']
];
// Lo que lee el cliente del local (no le corresponde saber del plan)
const MENSAJE_PUBLICO = {
  mesa_qr: 'En este local los pedidos se hacen con el mozo.',
  online: 'Este local no está tomando pedidos online. Llamalo por teléfono.'
};
const porModulo = Object.fromEntries([...new Set(RUTAS.map(r => r[1]))].map(m => [m, requierePlan(m)]));
app.use(async (req, res, next) => {
  const r = RUTAS.find(([patron, , metodos]) => patron.test(req.path) && (!metodos || metodos.includes(req.method)));
  if (!r) return next();
  if (MENSAJE_PUBLICO[r[1]] && req.path.startsWith('/api/publico/')) {
    return (await tiene(r[1]).catch(() => true)) ? next() : res.status(403).json({ error: MENSAJE_PUBLICO[r[1]] });
  }
  return porModulo[r[1]](req, res, next);
});

// Plan del local y lo que incluye cada uno (para la pantalla "Tu plan" y los candados del menú)
app.get('/api/licencia', autenticar, async (req, res) => {
  try {
    const estado = await estadoLicencia();
    res.json({ ...estado, planes: Object.fromEntries(Object.entries(PLANES).filter(([, p]) => !p.interno)),
      extras_disponibles: EXTRAS, modulos_disponibles: MODULOS, plan_minimo: Object.fromEntries(Object.keys(MODULOS).map(m => [m, planMinimo(m)])),
      descuentos: DESCUENTOS, dias_prueba: DIAS_PRUEBA, dias_gracia: DIAS_GRACIA, ventas: VENTAS });
  } catch (err) { errorInterno(res, err); }
});

// Licencia pegada a mano (local sin conexión a Morfi Nube): la da soporte
app.put('/api/licencia', autenticar, esAdmin, async (req, res) => {
  try { res.json(await guardarLicencia(req.body && req.body.licencia)); } catch (err) { errorInterno(res, err); }
});

};

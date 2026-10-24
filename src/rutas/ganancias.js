'use strict';
const {
  autenticar, requiere, esAdmin, errorInterno, configGanancias, guardarConfigGanancias, resumenGanancias, gananciaPorProducto,
  gananciaPorCanal, fugasDeGanancia, puntoDeEquilibrio, gananciaDeHoy
} = require('../contexto');

module.exports = function registrarRutas(app) {

// ============ GANANCIAS ============
// Cálculos y definiciones en src/servicios/ganancias.js. "Cuánto gané hoy" está en todos los planes (permiso
// reportes); el detalle es del plan Pro (módulo costos, ver src/rutas/planes.js) y necesita ver costos.
const ruta = fn => async (req, res) => { try { res.json(await fn(req)); } catch (err) { errorInterno(res, err); } };

app.get('/api/ganancias/hoy', autenticar, requiere('reportes'), ruta(() => gananciaDeHoy()));
app.get('/api/ganancias/resumen', autenticar, requiere('reportes.costos'), ruta(req => resumenGanancias(req.query)));
app.get('/api/ganancias/productos', autenticar, requiere('reportes.costos'), ruta(req => gananciaPorProducto(req.query)));
app.get('/api/ganancias/canales', autenticar, requiere('reportes.costos'), ruta(req => gananciaPorCanal(req.query)));
app.get('/api/ganancias/fugas', autenticar, requiere('reportes.costos'), ruta(req => fugasDeGanancia(req.query)));
app.get('/api/ganancias/equilibrio', autenticar, requiere('reportes.costos'), ruta(req => puntoDeEquilibrio(req.query)));
app.get('/api/ganancias/config', autenticar, requiere('reportes.costos'), ruta(() => configGanancias()));
// Comisiones por medio de pago y gastos fijos del mes
app.put('/api/ganancias/config', autenticar, esAdmin, ruta(req => guardarConfigGanancias(req.body || {})));

};

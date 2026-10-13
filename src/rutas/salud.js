'use strict';
const { errorInterno } = require('../contexto');
const { estadoSalud } = require('../servicios/monitoreo');

module.exports = function registrarRutas(app) {

// Estado del sistema para el monitoreo (sin sesión y sin datos del negocio).
// 200 si todo está bien; 503 si la base no responde o no hay copia reciente.
app.get('/api/salud', async (req, res) => {
  try {
    const salud = await estadoSalud();
    res.status(salud.ok ? 200 : 503).json(salud);
  } catch (err) {
    errorInterno(res, err);
  }
});

};

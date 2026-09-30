'use strict';
const {
  run, all, actualizarParcial, errorInterno, autenticar, esAdmin
} = require('../contexto');

module.exports = function registrarRutas(app) {

// ============ PROMOCIONES ============

app.get('/api/promociones', autenticar, async (req, res) => {
  try {
    const promos = await all('SELECT * FROM promociones WHERE activo = 1 ORDER BY nombre');
    res.json(promos);
  } catch (err) {
    errorInterno(res, err);
  }
});

app.post('/api/promociones', autenticar, esAdmin, async (req, res) => {
  try {
    const { nombre, tipo, valor, descripcion } = req.body;
    const result = await run(
      'INSERT INTO promociones (nombre, tipo, valor, descripcion) VALUES (?, ?, ?, ?)',
      [nombre, tipo || 'porcentaje', valor || 0, descripcion || '']
    );
    res.status(201).json({ id: result.id, message: 'Promoción creada' });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.put('/api/promociones/:id', autenticar, esAdmin, async (req, res) => {
  try {
    await actualizarParcial('promociones', req.params.id, req.body || {}, ['nombre', 'tipo', 'valor', 'descripcion', 'activo']);
    res.json({ message: 'Promoción actualizada' });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.delete('/api/promociones/:id', autenticar, esAdmin, async (req, res) => {
  try {
    await run('UPDATE promociones SET activo = 0 WHERE id = ?', [req.params.id]);
    res.json({ message: 'Promoción desactivada' });
  } catch (err) {
    errorInterno(res, err);
  }
});

};

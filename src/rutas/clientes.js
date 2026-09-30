'use strict';
const {
  run, all, actualizarParcial, errorInterno, autenticar
} = require('../contexto');

module.exports = function registrarRutas(app) {

// ============ CLIENTES ============

app.get('/api/clientes', autenticar, async (req, res) => {
  try {
    const clientes = await all('SELECT * FROM clientes ORDER BY nombre');
    res.json(clientes);
  } catch (err) {
    errorInterno(res, err);
  }
});

app.post('/api/clientes', autenticar, async (req, res) => {
  try {
    const { nombre, telefono, email, direccion, notas } = req.body;
    const result = await run(
      'INSERT INTO clientes (nombre, telefono, email, direccion, notas) VALUES (?, ?, ?, ?, ?)',
      [nombre, telefono || '', email || '', direccion || '', notas || '']
    );
    res.status(201).json({ id: result.id, message: 'Cliente creado' });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.put('/api/clientes/:id', autenticar, async (req, res) => {
  try {
    await actualizarParcial('clientes', req.params.id, req.body || {}, ['nombre', 'telefono', 'email', 'direccion', 'puntos', 'notas']);
    res.json({ message: 'Cliente actualizado' });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.delete('/api/clientes/:id', autenticar, async (req, res) => {
  try {
    await run('DELETE FROM clientes WHERE id = ?', [req.params.id]);
    res.json({ message: 'Cliente eliminado' });
  } catch (err) {
    errorInterno(res, err);
  }
});

};

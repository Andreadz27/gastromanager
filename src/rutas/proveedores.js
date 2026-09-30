'use strict';
const {
  run, all, actualizarParcial, errorInterno, autenticar, requiere
} = require('../contexto');

module.exports = function registrarRutas(app) {

// ============ PROVEEDORES ============

app.get('/api/proveedores', autenticar, requiere('stock.ver'), async (req, res) => {
  try {
    const proveedores = await all('SELECT * FROM proveedores WHERE activo = 1 ORDER BY nombre');
    res.json(proveedores);
  } catch (err) {
    errorInterno(res, err);
  }
});

app.post('/api/proveedores', autenticar, requiere('catalogo'), async (req, res) => {
  try {
    const { nombre, cuit, telefono, email, direccion, notas } = req.body;
    const result = await run(
      'INSERT INTO proveedores (nombre, cuit, telefono, email, direccion, notas) VALUES (?, ?, ?, ?, ?, ?)',
      [nombre, cuit || '', telefono || '', email || '', direccion || '', notas || '']
    );
    res.status(201).json({ id: result.id, message: 'Proveedor creado' });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.put('/api/proveedores/:id', autenticar, requiere('catalogo'), async (req, res) => {
  try {
    await actualizarParcial('proveedores', req.params.id, req.body || {}, ['nombre', 'cuit', 'telefono', 'email', 'direccion', 'notas', 'activo']);
    res.json({ message: 'Proveedor actualizado' });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.delete('/api/proveedores/:id', autenticar, requiere('catalogo'), async (req, res) => {
  try {
    await run('UPDATE proveedores SET activo = 0 WHERE id = ?', [req.params.id]);
    res.json({ message: 'Proveedor desactivado' });
  } catch (err) {
    errorInterno(res, err);
  }
});

};

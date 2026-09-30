'use strict';
const {
  bcrypt, run, all, errorInterno, autenticar, esAdmin
} = require('../contexto');

module.exports = function registrarRutas(app) {

// ============ USUARIOS ============

app.get('/api/usuarios', autenticar, esAdmin, async (req, res) => {
  try {
    const usuarios = await all('SELECT id, nombre, email, rol, activo FROM usuarios ORDER BY id');
    res.json(usuarios);
  } catch (err) {
    errorInterno(res, err);
  }
});

app.post('/api/usuarios', autenticar, esAdmin, async (req, res) => {
  try {
    const { nombre, email, password, rol } = req.body;
    if (!nombre || !email || !password) {
      return res.status(400).json({ error: 'Nombre, email y contraseña son obligatorios' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    }
    // La contraseña la define el admin: el usuario la cambia en su primer ingreso
    const hash = await bcrypt.hash(String(password), 10);
    const result = await run('INSERT INTO usuarios (nombre, email, password, rol, debe_cambiar_password) VALUES (?, ?, ?, ?, 1)',
      [nombre, email, hash, rol === 'admin' ? 'admin' : 'vendedor']);
    await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, ?, ?)',
      [req.usuario.id, 'crear_usuario', `Usuario creado: ${nombre}`]);
    res.status(201).json({ id: result.id, message: 'Usuario creado' });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.put('/api/usuarios/:id', autenticar, esAdmin, async (req, res) => {
  try {
    const { nombre, email, rol, activo, password } = req.body;
    if (password) {
      if (String(password).length < 8) {
        return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
      }
      const hash = await bcrypt.hash(String(password), 10);
      // Contraseña reseteada por el admin: el usuario la cambia al ingresar
      await run('UPDATE usuarios SET nombre = ?, email = ?, rol = ?, activo = ?, password = ?, debe_cambiar_password = 1 WHERE id = ?',
        [nombre, email, rol, activo, hash, req.params.id]);
    } else {
      await run('UPDATE usuarios SET nombre = ?, email = ?, rol = ?, activo = ? WHERE id = ?',
        [nombre, email, rol, activo, req.params.id]);
    }
    await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, ?, ?)',
      [req.usuario.id, 'editar_usuario', `Usuario #${req.params.id} actualizado`]);
    res.json({ message: 'Usuario actualizado' });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.delete('/api/usuarios/:id', autenticar, esAdmin, async (req, res) => {
  try {
    await run('UPDATE usuarios SET activo = 0 WHERE id = ?', [req.params.id]);
    res.json({ message: 'Usuario desactivado' });
  } catch (err) {
    errorInterno(res, err);
  }
});

};

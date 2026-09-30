'use strict';
const {
  bcrypt, run, get, all, transaccion, errorHttp, errorInterno, autenticar, esAdmin, ROLES, normalizarRol, esRolValido
} = require('../contexto');

// Impide quedarse sin administradores activos (nadie podría volver a configurar el sistema)
async function verificarQuedaAdmin(idUsuario, rolNuevo, activoNuevo) {
  const actual = await get('SELECT rol, activo FROM usuarios WHERE id = ?', [idUsuario]);
  if (!actual || actual.rol !== 'admin' || !actual.activo) return;
  if (rolNuevo === 'admin' && activoNuevo) return;
  const { n } = await get("SELECT COUNT(*) AS n FROM usuarios WHERE rol = 'admin' AND activo = 1 AND id != ?", [idUsuario]);
  if (!n) throw errorHttp(400, 'Tiene que quedar al menos un administrador activo');
}

module.exports = function registrarRutas(app) {

// ============ USUARIOS ============

app.get('/api/usuarios', autenticar, esAdmin, async (req, res) => {
  try {
    const usuarios = await all('SELECT id, nombre, email, rol, activo FROM usuarios ORDER BY id');
    res.json(usuarios.map(u => ({ ...u, rol: normalizarRol(u.rol), rol_nombre: (ROLES[normalizarRol(u.rol)] || {}).nombre || u.rol })));
  } catch (err) {
    errorInterno(res, err);
  }
});

app.post('/api/usuarios', autenticar, esAdmin, async (req, res) => {
  try {
    const { nombre, email, password } = req.body;
    const rol = normalizarRol(req.body.rol || 'cajero');
    if (!nombre || !email || !password) {
      return res.status(400).json({ error: 'Nombre, email y contraseña son obligatorios' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    }
    if (!esRolValido(rol)) return res.status(400).json({ error: 'Rol inválido' });
    // La contraseña la define el admin: el usuario la cambia en su primer ingreso
    const hash = await bcrypt.hash(String(password), 10);
    const result = await run('INSERT INTO usuarios (nombre, email, password, rol, debe_cambiar_password) VALUES (?, ?, ?, ?, 1)',
      [nombre, email, hash, rol]);
    await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, ?, ?)',
      [req.usuario.id, 'crear_usuario', `Usuario creado: ${nombre} (${ROLES[rol].nombre})`]);
    res.status(201).json({ id: result.id, message: 'Usuario creado' });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.put('/api/usuarios/:id', autenticar, esAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    await transaccion(async () => {
      const actual = await get('SELECT * FROM usuarios WHERE id = ?', [req.params.id]);
      if (!actual) throw errorHttp(404, 'Usuario no encontrado');
      // Los campos que no vienen conservan su valor
      const nombre = b.nombre !== undefined ? String(b.nombre).trim() : actual.nombre;
      const email = b.email !== undefined ? String(b.email).trim() : actual.email;
      const rol = b.rol !== undefined ? normalizarRol(b.rol) : normalizarRol(actual.rol);
      const activo = b.activo !== undefined ? (Number(b.activo) ? 1 : 0) : actual.activo;
      if (!nombre || !email) throw errorHttp(400, 'Nombre y email son obligatorios');
      if (!esRolValido(rol)) throw errorHttp(400, 'Rol inválido');
      await verificarQuedaAdmin(actual.id, rol, activo);

      if (b.password) {
        if (String(b.password).length < 8) throw errorHttp(400, 'La contraseña debe tener al menos 8 caracteres');
        const hash = await bcrypt.hash(String(b.password), 10);
        // Contraseña reseteada por el admin: el usuario la cambia al ingresar
        await run('UPDATE usuarios SET nombre = ?, email = ?, rol = ?, activo = ?, password = ?, debe_cambiar_password = 1 WHERE id = ?',
          [nombre, email, rol, activo, hash, actual.id]);
      } else {
        await run('UPDATE usuarios SET nombre = ?, email = ?, rol = ?, activo = ? WHERE id = ?',
          [nombre, email, rol, activo, actual.id]);
      }
      const cambioRol = normalizarRol(actual.rol) !== rol ? ` (rol: ${ROLES[rol].nombre})` : '';
      await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, ?, ?)',
        [req.usuario.id, 'editar_usuario', `Usuario #${actual.id} ${nombre} actualizado${cambioRol}`]);
    });
    res.json({ message: 'Usuario actualizado' });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.delete('/api/usuarios/:id', autenticar, esAdmin, async (req, res) => {
  try {
    await transaccion(async () => {
      const actual = await get('SELECT id, rol FROM usuarios WHERE id = ?', [req.params.id]);
      if (!actual) throw errorHttp(404, 'Usuario no encontrado');
      await verificarQuedaAdmin(actual.id, actual.rol, 0);
      await run('UPDATE usuarios SET activo = 0 WHERE id = ?', [actual.id]);
      await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, ?, ?)',
        [req.usuario.id, 'desactivar_usuario', `Usuario #${actual.id} desactivado`]);
    });
    res.json({ message: 'Usuario desactivado' });
  } catch (err) {
    errorInterno(res, err);
  }
});

};

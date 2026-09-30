'use strict';
const {
  bcrypt, run, get, errorInterno, autenticar, firmarToken, loginLimiter
} = require('../contexto');

module.exports = function registrarRutas(app) {

// ============ AUTENTICACION - RUTAS ============

app.post('/api/auth/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    const usuario = await get('SELECT * FROM usuarios WHERE email = ? AND activo = 1', [email]);
    if (!usuario) {
      return res.status(400).json({ error: 'Credenciales incorrectas' });
    }

    // Comparación segura de contraseñas (soporta hash bcrypt y legacy plain text)
    let passwordValido = false;
    if (usuario.password && usuario.password.startsWith('$2')) {
      // Hash bcrypt
      passwordValido = await bcrypt.compare(String(password || ''), usuario.password);
    } else {
      // Legacy: texto plano (migración temporal)
      passwordValido = (String(password || '') === String(usuario.password || ''));
      if (passwordValido) {
        // Auto-migrar a hash bcrypt
        const hash = await bcrypt.hash(String(password), 10);
        await run('UPDATE usuarios SET password = ? WHERE id = ?', [hash, usuario.id]);
      }
    }

    if (!passwordValido) {
      return res.status(400).json({ error: 'Credenciales incorrectas' });
    }

    const token = firmarToken(usuario);
    await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, ?, ?)',
      [usuario.id, 'login', 'Inicio de sesión']);
    res.json({ token, usuario: {
      id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol,
      debe_cambiar_password: usuario.debe_cambiar_password ? 1 : 0
    } });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.get('/api/auth/me', autenticar, async (req, res) => {
  try {
    const usuario = await get('SELECT id, nombre, email, rol, activo, debe_cambiar_password FROM usuarios WHERE id = ? AND activo = 1', [req.usuario.id]);
    if (!usuario) return res.status(401).json({ error: 'Usuario inactivo' });
    res.json(usuario);
  } catch (err) {
    errorInterno(res, err);
  }
});

// Cambio de contraseña del propio usuario (obligatorio en el primer ingreso)
app.put('/api/auth/password', autenticar, async (req, res) => {
  try {
    const { actual, nueva } = req.body || {};
    const usuario = await get('SELECT * FROM usuarios WHERE id = ? AND activo = 1', [req.usuario.id]);
    if (!usuario) return res.status(401).json({ error: 'Usuario inactivo' });
    if (!(await bcrypt.compare(String(actual || ''), usuario.password || '')))
      return res.status(400).json({ error: 'La contraseña actual no es correcta' });
    const nuevaStr = String(nueva || '');
    if (nuevaStr.length < 8) return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres' });
    if (nuevaStr === String(actual)) return res.status(400).json({ error: 'La nueva contraseña debe ser distinta de la actual' });

    const hash = await bcrypt.hash(nuevaStr, 10);
    await run('UPDATE usuarios SET password = ?, debe_cambiar_password = 0 WHERE id = ?', [hash, usuario.id]);
    await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, ?, ?)',
      [usuario.id, 'cambiar_password', 'Contraseña cambiada']);
    const token = firmarToken({ ...usuario, debe_cambiar_password: 0 });
    res.json({ token, message: 'Contraseña actualizada' });
  } catch (err) {
    errorInterno(res, err);
  }
});

};

'use strict';
const jwt = require('jsonwebtoken');
const { SECRET_KEY } = require('./config');
const { get } = require('./db');

// ============ AUTENTICACION ============
// Verifica el token y que el usuario siga activo. El rol se toma de la base,
// así desactivar a un usuario o cambiarle el rol tiene efecto inmediato.
async function usuarioDesdeToken(token) {
  const decoded = jwt.verify(String(token || ''), SECRET_KEY);
  const u = await get('SELECT id, nombre, email, rol, debe_cambiar_password FROM usuarios WHERE id = ? AND activo = 1', [decoded.id]);
  if (!u) throw new Error('Usuario inactivo');
  return { id: u.id, nombre: u.nombre, email: u.email, rol: u.rol, ...(u.debe_cambiar_password ? { cp: 1 } : {}) };
}

async function autenticar(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  try {
    req.usuario = await usuarioDesdeToken(token);
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
  // Con contraseña pendiente de cambio solo se puede consultar la sesión y cambiarla
  if (req.usuario.cp && !['/api/auth/me', '/api/auth/password'].includes(req.path)) {
    return res.status(403).json({ error: 'Tenés que cambiar la contraseña para continuar', cambiar_password: true });
  }
  next();
}

const firmarToken = usuario => jwt.sign(
  { id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol,
    ...(usuario.debe_cambiar_password ? { cp: 1 } : {}) },
  SECRET_KEY,
  { expiresIn: '12h' }
);

function esAdmin(req, res, next) {
  if (req.usuario?.rol !== 'admin') {
    return res.status(403).json({ error: 'Acceso restringido a administradores' });
  }
  next();
}

module.exports = { usuarioDesdeToken, autenticar, firmarToken, esAdmin };

'use strict';
const jwt = require('jsonwebtoken');
const { SECRET_KEY } = require('./config');
const { get } = require('./db');
const { ROLES, normalizarRol, permisosDeRol } = require('./permisos');

// ============ AUTENTICACION ============
// Verifica el token y que el usuario siga activo. El rol se toma de la base,
// así desactivar a un usuario o cambiarle el rol tiene efecto inmediato.
async function usuarioDesdeToken(token) {
  const decoded = jwt.verify(String(token || ''), SECRET_KEY);
  const u = await get('SELECT id, nombre, email, rol, debe_cambiar_password FROM usuarios WHERE id = ? AND activo = 1', [decoded.id]);
  if (!u) throw new Error('Usuario inactivo');
  return { ...datosSesion(u), ...(u.debe_cambiar_password ? { cp: 1 } : {}) };
}

// Datos del usuario que se envían al frontend (con rol normalizado y sus permisos)
function datosSesion(u) {
  const rol = normalizarRol(u.rol);
  return {
    id: u.id, nombre: u.nombre, email: u.email, rol,
    rol_nombre: (ROLES[rol] || { nombre: rol }).nombre,
    permisos: permisosDeRol(rol)
  };
}

const tienePermiso = (usuario, permiso) => !!(usuario && usuario.permisos && usuario.permisos.includes(permiso));

// Middleware: exige al menos uno de los permisos indicados
function requiere(...permisos) {
  return (req, res, next) => {
    if (permisos.some(p => tienePermiso(req.usuario, p))) return next();
    res.status(403).json({ error: 'Tu usuario no tiene permiso para esta acción' });
  };
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

// Solo administradores (usuarios, configuración, integraciones, impresoras, backups)
function esAdmin(req, res, next) {
  if (!tienePermiso(req.usuario, 'admin')) {
    return res.status(403).json({ error: 'Acceso restringido a administradores' });
  }
  next();
}

module.exports = { usuarioDesdeToken, autenticar, firmarToken, esAdmin, requiere, tienePermiso, datosSesion };

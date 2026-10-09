// Crea (o deja listo) un usuario para probar el sistema, sin cambio de contraseña pendiente.
// Se puede correr con el servidor andando. Si el usuario ya existe, lo reactiva y le vuelve a poner la clave.
//
// Uso:  npm run usuario:prueba
//       npm run usuario:prueba -- --email qa@miresto.com --clave OtraClave123 --rol cajero --nombre "QA Caja"
// Roles: admin, encargado, cajero, mozo, cocina. Usa la base de GM_DATA_DIR (por defecto data/).
'use strict';
const bcrypt = require('bcryptjs');

const arg = (nombre, defecto) => {
  const i = process.argv.indexOf(`--${nombre}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : defecto;
};
const datos = {
  nombre: arg('nombre', 'Usuario de Prueba'),
  email: arg('email', 'prueba@gastromanager.com').trim().toLowerCase(),
  clave: arg('clave', 'Prueba2026!'),
  rol: arg('rol', 'admin')
};

async function main() {
  // Se cargan los módulos del sistema: misma base, mismas migraciones y mismos roles que el servidor
  const { run, get } = require('../src/db');
  const { migrarConRespaldo } = require('../src/migraciones');
  const { crearBackup } = require('../src/servicios/backups');
  const { ROLES, normalizarRol, esRolValido } = require('../src/permisos');
  const { DATA_DIR } = require('../src/config');

  const rol = normalizarRol(datos.rol);
  if (!esRolValido(rol)) throw new Error(`Rol inválido: ${datos.rol}. Opciones: ${Object.keys(ROLES).join(', ')}`);
  if (String(datos.clave).length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.email)) throw new Error(`Email inválido: ${datos.email}`);
  if (!(await get("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'usuarios'"))) {
    throw new Error(`No hay base en ${DATA_DIR}. Ejecuta primero: npm run init-db`);
  }
  await migrarConRespaldo({ respaldar: crearBackup });

  const hash = await bcrypt.hash(datos.clave, 10);
  const existente = await get('SELECT id FROM usuarios WHERE lower(email) = ?', [datos.email]);
  let id;
  if (existente) {
    id = existente.id;
    await run('UPDATE usuarios SET nombre = ?, password = ?, rol = ?, activo = 1, debe_cambiar_password = 0 WHERE id = ?',
      [datos.nombre, hash, rol, id]);
  } else {
    id = (await run('INSERT INTO usuarios (nombre, email, password, rol, activo, debe_cambiar_password) VALUES (?, ?, ?, ?, 1, 0)',
      [datos.nombre, datos.email, hash, rol])).id;
  }
  await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, ?, ?)',
    [id, existente ? 'editar_usuario' : 'crear_usuario', `Usuario de prueba ${existente ? 'actualizado' : 'creado'} por script: ${datos.nombre} (${ROLES[rol].nombre})`]);

  console.log(`\n  Usuario de prueba ${existente ? 'actualizado' : 'creado'} en ${DATA_DIR}`);
  console.log(`    Email:       ${datos.email}`);
  console.log(`    Contraseña:  ${datos.clave}`);
  console.log(`    Rol:         ${ROLES[rol].nombre}\n`);
}

main().then(() => process.exit(0), err => {
  console.error('No se pudo crear el usuario de prueba:', err.message);
  process.exit(1);
});

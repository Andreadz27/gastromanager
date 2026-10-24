// Datos de prueba compartidos por Playwright, Postman y Maestro (una sola fuente).
// Son de una base nueva creada para la prueba: nunca de un local real.
'use strict';

const USUARIOS = {
  admin: { nombre: 'Administrador', email: 'admin@morfi.local', password: 'admin123', rol: 'admin' },
  cajero: { nombre: 'Vendedor Test', email: 'vendedor@test.com', password: 'vendedor123', rol: 'cajero' },
  mozo: { nombre: 'Mozo QA', email: 'mozo@qa.test', password: 'mozo1234', rol: 'mozo' },
  cocina: { nombre: 'Cocina QA', email: 'cocina@qa.test', password: 'cocina1234', rol: 'cocina' }
};

// Productos de la carta de ejemplo de init-db.js
const PRODUCTOS = {
  ensalada: { id: 1, nombre: 'Ensalada César', precio: 4500 }
};

module.exports = { USUARIOS, PRODUCTOS };

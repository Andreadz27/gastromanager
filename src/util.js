'use strict';
// Errores HTTP, actualización parcial y helpers varios
const { run } = require('./db');

// Error de validación con código HTTP (se responde tal cual y revierte la transacción)
const errorHttp = (status, mensaje) => Object.assign(new Error(mensaje), { status });

// UPDATE parcial: solo modifica los campos que vienen en el body (lista blanca "campos").
// Antes los PUT asignaban NULL a lo que el formulario no enviaba; por ejemplo, editar un
// proveedor lo dejaba con activo = NULL y desaparecía de la lista.
async function actualizarParcial(tabla, id, body, campos) {
  const sets = [], params = [];
  for (const campo of campos) {
    if (body[campo] === undefined) continue;
    sets.push(`${campo} = ?`);
    params.push(campo === 'activo' ? (body[campo] ? 1 : 0) : body[campo]);
  }
  if (!sets.length) throw errorHttp(400, 'No hay datos para actualizar');
  const { changes } = await run(`UPDATE ${tabla} SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
  if (!changes) throw errorHttp(404, 'Registro no encontrado');
}

// Slug seguro para nombres de plataforma (usado en URLs de webhook)
function slugificar(nombre) {
  return String(nombre || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

// Parsear la columna config de una plataforma (JSON libre)
function parseCfgPlataforma(p) {
  let cfg = {};
  try { cfg = JSON.parse(p.config || '{}'); } catch (e) { cfg = {}; }
  return cfg;
}

// Error inesperado: se registra en el log y al cliente no se le muestran detalles internos
function errorInterno(res, err) {
  // Errores de validación creados con errorHttp(): se muestran al usuario
  if (err && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ error: err.message });
  }
  if (err && err.code === 'SQLITE_CONSTRAINT') {
    return res.status(409).json({ error: 'Ya existe un registro con esos datos o faltan datos obligatorios' });
  }
  console.error(`[${new Date().toISOString()}] ${res.req.method} ${res.req.originalUrl}:`, err);
  res.status(500).json({ error: 'Error interno del servidor' });
}

module.exports = { errorHttp, actualizarParcial, slugificar, parseCfgPlataforma, errorInterno };

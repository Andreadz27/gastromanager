'use strict';
// Archivo de la base de datos. Hasta que el sistema se llamó Morfi (antes GastroManager) era gastromanager.db:
// al arrancar se renombra solo, antes de abrirlo. Van juntos los archivos -wal y -shm (con WAL, si el servidor
// se cortó, ahí están las últimas operaciones). El principal se mueve último: si algo se interrumpe a mitad
// de camino, el próximo arranque termina el cambio.
// Sin dependencias del resto del sistema: lo usan también init-db.js y los scripts.
const fs = require('fs');
const path = require('path');

const ARCHIVO_BASE = 'morfi.db';
const ARCHIVO_BASE_ANTERIOR = 'gastromanager.db';

function rutaBase(dir) {
  const nueva = path.join(dir, ARCHIVO_BASE);
  const vieja = path.join(dir, ARCHIVO_BASE_ANTERIOR);
  if (!fs.existsSync(nueva) && fs.existsSync(vieja)) {
    for (const sufijo of ['-wal', '-shm', '']) {
      if (fs.existsSync(vieja + sufijo)) fs.renameSync(vieja + sufijo, nueva + sufijo);
    }
  }
  return nueva;
}

module.exports = { ARCHIVO_BASE, ARCHIVO_BASE_ANTERIOR, rutaBase };

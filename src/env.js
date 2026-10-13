'use strict';
// Carga la configuración de la instalación desde el archivo .env de la raíz (si existe).
// Formato: una variable por línea, CLAVE=valor; las líneas con # son comentarios.
// Las variables que ya vienen del entorno (pm2, Render, tests) tienen prioridad.
const fs = require('fs');
const path = require('path');

function cargarEnv(archivo = process.env.GM_ENV_FILE || path.join(__dirname, '..', '.env')) {
  let texto;
  try { texto = fs.readFileSync(archivo, 'utf8'); } catch (e) { return 0; }
  let n = 0;
  for (const linea of texto.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    n++;
  }
  return n;
}

cargarEnv();
module.exports = { cargarEnv };

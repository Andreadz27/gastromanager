'use strict';
// Configuración general (variables de entorno)
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const PORT = process.env.PORT || 3000;
// Carpeta de datos (base, clave de sesión, copias). GM_DATA_DIR permite usar otra (tests).
const DATA_DIR = process.env.GM_DATA_DIR || path.join(__dirname, '..', 'data');

// Clave para firmar sesiones: SECRET_KEY del entorno o, si no está, una clave
// aleatoria propia de esta instalación guardada en data/.secret_key.
function cargarSecretKey() {
  if (process.env.SECRET_KEY) return process.env.SECRET_KEY;
  const archivo = path.join(DATA_DIR, '.secret_key');
  try {
    const guardada = fs.readFileSync(archivo, 'utf8').trim();
    if (guardada.length >= 32) return guardada;
  } catch (e) { /* no existe todavía */ }
  const nueva = crypto.randomBytes(48).toString('hex');
  fs.mkdirSync(path.dirname(archivo), { recursive: true });
  fs.writeFileSync(archivo, nueva, { mode: 0o600 });
  return nueva;
}
const SECRET_KEY = cargarSecretKey();

// Orígenes permitidos (CORS HTTP y Socket.IO). Por defecto, cualquiera.
const allowedOrigins = (process.env.CORS_ORIGINS || '*').split(',').map(s => s.trim());
const origenPermitido = origin => !origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin);

module.exports = { PORT, DATA_DIR, SECRET_KEY, origenPermitido };

'use strict';
// Formato de la licencia: <datos en base64url>.<firma Ed25519 en base64url>. La firma Morfi Nube con la clave
// privada (NUBE_CLAVE_LICENCIAS, nunca en el repositorio) y cada local la verifica con la pública
// (src/licencia-publica.pem). Así el plan no se puede cambiar editando la base del local.
// Sin dependencias de la base: lo usan el local y la nube.
const crypto = require('crypto');

const b64 = buf => Buffer.from(buf).toString('base64url');

function firmarLicencia(datos, clavePrivada) {
  const cuerpo = b64(JSON.stringify({ v: 1, ...datos }));
  return cuerpo + '.' + b64(crypto.sign(null, Buffer.from(cuerpo), clavePrivada));
}

// Datos de la licencia si la firma es válida; si no, null
function leerLicencia(licencia, clavePublica) {
  const [cuerpo, firma, ...resto] = String(licencia || '').split('.');
  if (!cuerpo || !firma || resto.length) return null;
  try {
    if (!crypto.verify(null, Buffer.from(cuerpo), clavePublica, Buffer.from(firma, 'base64url'))) return null;
    const datos = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'));
    return datos && datos.v === 1 && typeof datos.plan === 'string' ? datos : null;
  } catch (e) { return null; }
}

// Huella del token del local en la nube: ata la licencia a ese local
const huellaToken = token => crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 16);

module.exports = { firmarLicencia, leerLicencia, huellaToken };

'use strict';
// ============ Copia de seguridad fuera del local (nube compatible con S3) ============
// Después de cada copia local se sube el archivo a un bucket S3-compatible
// (Cloudflare R2, Backblaze B2, AWS S3, Wasabi...). Sin dependencias: firma AWS SigV4 propia.
//
// Variables de entorno (si falta alguna, la copia en la nube queda desactivada):
//   BACKUP_S3_ENDPOINT   https://<account-id>.r2.cloudflarestorage.com (R2) o https://s3.us-west-004.backblazeb2.com (B2)
//   BACKUP_S3_BUCKET     gastromanager-copias
//   BACKUP_S3_KEY_ID     keyID de la Application Key (B2) o Access Key ID
//   BACKUP_S3_SECRET     applicationKey (B2) o Secret Access Key
//   BACKUP_S3_REGION     opcional; si no está se toma del endpoint (us-west-004) o 'auto'
//   BACKUP_S3_PREFIJO    opcional; carpeta del cliente dentro del bucket (ej. la-buena-mesa)
// Cuánto tiempo se guardan las copias lo decide la regla de ciclo de vida del bucket.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const sha256 = d => crypto.createHash('sha256').update(d).digest('hex');
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
// Codificación de rutas que pide S3 (RFC 3986, la barra se conserva)
const codificar = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase()).replace(/%2F/g, '/');

// Firma AWS Signature Version 4. Devuelve el valor del header Authorization.
function firmarS3({ metodo, host, ruta, query = '', headers, region, keyId, secret, fecha }) {
  const amzDate = fecha.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dia = amzDate.slice(0, 8);
  const todos = { host, ...headers, 'x-amz-date': amzDate };
  const nombres = Object.keys(todos).map(h => h.toLowerCase()).sort();
  const valor = h => String(Object.entries(todos).find(([k]) => k.toLowerCase() === h)[1]).trim();
  const canonicos = nombres.map(h => `${h}:${valor(h)}\n`).join('');
  const firmados = nombres.join(';');
  const hashCuerpo = valor('x-amz-content-sha256');
  const pedido = [metodo, codificar(ruta), query, canonicos, firmados, hashCuerpo].join('\n');
  const alcance = `${dia}/${region}/s3/aws4_request`;
  const aFirmar = ['AWS4-HMAC-SHA256', amzDate, alcance, sha256(pedido)].join('\n');
  const clave = hmac(hmac(hmac(hmac('AWS4' + secret, dia), region), 's3'), 'aws4_request');
  const firma = crypto.createHmac('sha256', clave).update(aFirmar).digest('hex');
  return { amzDate, authorization: `AWS4-HMAC-SHA256 Credential=${keyId}/${alcance}, SignedHeaders=${firmados}, Signature=${firma}` };
}

function configNube(env = process.env) {
  const { BACKUP_S3_ENDPOINT: endpoint, BACKUP_S3_BUCKET: bucket, BACKUP_S3_KEY_ID: keyId, BACKUP_S3_SECRET: secret } = env;
  if (!endpoint || !bucket || !keyId || !secret) return null;
  const url = new URL(endpoint);
  const region = env.BACKUP_S3_REGION || (url.hostname.match(/^s3\.([a-z0-9-]+)\./) || [])[1] || 'auto';
  const prefijo = String(env.BACKUP_S3_PREFIJO || '').replace(/^\/+|\/+$/g, '');
  return { url, bucket, keyId, secret, region, prefijo };
}

// Estado de la última subida (lo muestra /api/salud y lo usa el monitoreo)
const estado = { activa: false, ultima: null };

async function subirCopia(archivo, cfg = configNube()) {
  estado.activa = !!cfg;
  if (!cfg) return null;
  const nombre = path.basename(archivo);
  const clave = (cfg.prefijo ? cfg.prefijo + '/' : '') + nombre;
  const cuerpo = fs.readFileSync(archivo);
  const ruta = `${cfg.url.pathname.replace(/\/$/, '')}/${cfg.bucket}/${clave}`;
  const headers = { 'x-amz-content-sha256': sha256(cuerpo), 'content-type': 'application/octet-stream' };
  const { amzDate, authorization } = firmarS3({
    metodo: 'PUT', host: cfg.url.host, ruta, headers, region: cfg.region, keyId: cfg.keyId, secret: cfg.secret, fecha: new Date()
  });
  try {
    const r = await fetch(`${cfg.url.origin}${codificar(ruta)}`, {
      method: 'PUT', body: cuerpo, signal: AbortSignal.timeout(120000),
      headers: { ...headers, 'x-amz-date': amzDate, authorization }
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    estado.ultima = { ok: true, fecha: new Date().toISOString(), archivo: clave };
    console.log(`[backup] Copia subida a la nube: ${clave}`);
  } catch (e) {
    estado.ultima = { ok: false, fecha: new Date().toISOString(), archivo: clave, error: e.message };
    console.error('[backup] No se pudo subir la copia a la nube:', e.message);
  }
  return estado.ultima;
}

estado.activa = !!configNube();

module.exports = { firmarS3, configNube, subirCopia, estadoNube: estado };

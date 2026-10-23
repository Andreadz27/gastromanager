'use strict';
// ============ Copia de seguridad fuera del local (nube compatible con S3) ============
// Después de cada copia local se sube el archivo a un bucket S3-compatible
// (Cloudflare R2, Backblaze B2, AWS S3, Wasabi...). Sin dependencias: firma AWS SigV4 propia.
//
// Variables de entorno (si falta alguna, la copia en la nube queda desactivada):
//   BACKUP_S3_ENDPOINT   https://<account-id>.r2.cloudflarestorage.com (R2) o https://s3.us-west-004.backblazeb2.com (B2)
//   BACKUP_S3_BUCKET     morfi-copias
//   BACKUP_S3_KEY_ID     keyID de la Application Key (B2) o Access Key ID
//   BACKUP_S3_SECRET     applicationKey (B2) o Secret Access Key
//   BACKUP_S3_REGION     opcional; si no está se toma del endpoint (us-west-004) o 'auto'
//   BACKUP_S3_PREFIJO    opcional; carpeta del cliente dentro del bucket (ej. la-buena-mesa)
//   BACKUP_CLAVE         opcional (la genera el instalador): 64 caracteres hex. Con ella la copia se sube cifrada
//                        (AES-256-GCM, archivo .db.cifrado). La base tiene datos de clientes, el certificado de ARCA
//                        y los tokens de las integraciones: quien acceda al bucket no puede leerla sin la clave.
//                        SIN LA CLAVE NO SE PUEDE RESTAURAR: guardarla fuera del local (gestor de contraseñas).
// Cuánto tiempo se guardan las copias lo decide la regla de ciclo de vida del bucket.
// Restaurar (local o desde la nube): npm run restaurar (scripts/restaurar.js).
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

// ---- Cifrado: "GMC1" + iv (12 bytes) + tag (16) + datos cifrados con AES-256-GCM ----
const MAGIA = Buffer.from('GMC1');
function claveCopias(env = process.env) {
  const k = String(env.BACKUP_CLAVE || '').trim();
  if (!k) return null;
  if (!/^[0-9a-f]{64}$/i.test(k)) throw new Error('BACKUP_CLAVE tiene que tener 64 caracteres hexadecimales');
  return Buffer.from(k, 'hex');
}
function cifrarCopia(datos, clave) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', clave, iv);
  const cuerpo = Buffer.concat([c.update(datos), c.final()]);
  return Buffer.concat([MAGIA, iv, c.getAuthTag(), cuerpo]);
}
// Una copia sin cifrar se devuelve tal cual
function descifrarCopia(datos, clave) {
  if (!datos.subarray(0, 4).equals(MAGIA)) return datos;
  if (!clave) throw new Error('La copia está cifrada: falta BACKUP_CLAVE en el .env');
  const d = crypto.createDecipheriv('aes-256-gcm', clave, datos.subarray(4, 16));
  d.setAuthTag(datos.subarray(16, 32));
  try {
    return Buffer.concat([d.update(datos.subarray(32)), d.final()]);
  } catch (e) {
    throw new Error('BACKUP_CLAVE no corresponde a esta copia');
  }
}

// Pedido firmado al bucket. clave = ruta del objeto dentro del bucket ('' para listar)
async function pedirS3(cfg, metodo, clave, { cuerpo = Buffer.alloc(0), query = {}, timeout = 120000 } = {}) {
  const ruta = `${cfg.url.pathname.replace(/\/$/, '')}/${cfg.bucket}${clave ? '/' + clave : ''}`;
  const qs = Object.keys(query).sort().map(k => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`).join('&');
  const headers = { 'x-amz-content-sha256': sha256(cuerpo), ...(metodo === 'PUT' ? { 'content-type': 'application/octet-stream' } : {}) };
  const { amzDate, authorization } = firmarS3({
    metodo, host: cfg.url.host, ruta, query: qs, headers, region: cfg.region, keyId: cfg.keyId, secret: cfg.secret, fecha: new Date()
  });
  const r = await fetch(`${cfg.url.origin}${codificar(ruta)}${qs ? '?' + qs : ''}`, {
    method: metodo, body: metodo === 'PUT' ? cuerpo : undefined, signal: AbortSignal.timeout(timeout),
    headers: { ...headers, 'x-amz-date': amzDate, authorization }
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r;
}

const conPrefijo = (cfg, nombre) => (cfg.prefijo ? cfg.prefijo + '/' : '') + nombre;

// Copias del cliente en el bucket (las más nuevas primero)
async function listarCopiasNube(cfg = configNube()) {
  const xml = await (await pedirS3(cfg, 'GET', '', { query: { 'list-type': '2', prefix: cfg.prefijo ? cfg.prefijo + '/' : '' } })).text();
  const copias = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map(([, c]) => ({
    nombre: path.basename((c.match(/<Key>([^<]*)<\/Key>/) || [])[1] || ''),
    tamano: Number((c.match(/<Size>(\d+)<\/Size>/) || [])[1]) || 0,
    fecha: (c.match(/<LastModified>([^<]*)<\/LastModified>/) || [])[1] || ''
  })).filter(c => /^(morfi|gastromanager)_.*\.db(\.cifrado)?$/.test(c.nombre));
  // Mismo orden que las copias locales: sin la extensión (si no, la _2 del mismo segundo queda mal ubicada)
  const base = n => n.split('.')[0];
  return copias.sort((a, b) => base(b.nombre).localeCompare(base(a.nombre)));
}

async function bajarCopiaNube(cfg, nombre) {
  if (!/^[\w.-]+$/.test(nombre)) throw new Error('Nombre de copia inválido');
  return Buffer.from(await (await pedirS3(cfg, 'GET', conPrefijo(cfg, nombre), { timeout: 600000 })).arrayBuffer());
}

async function subirCopia(archivo, cfg = configNube()) {
  estado.activa = !!cfg;
  if (!cfg) return null;
  let clave = conPrefijo(cfg, path.basename(archivo));
  try {
    const claveCifrado = claveCopias();
    let cuerpo = fs.readFileSync(archivo);
    if (claveCifrado) { cuerpo = cifrarCopia(cuerpo, claveCifrado); clave += '.cifrado'; }
    await pedirS3(cfg, 'PUT', clave, { cuerpo });
    estado.ultima = { ok: true, fecha: new Date().toISOString(), archivo: clave };
    console.log(`[backup] Copia subida a la nube: ${clave}`);
  } catch (e) {
    estado.ultima = { ok: false, fecha: new Date().toISOString(), archivo: clave, error: e.message };
    console.error('[backup] No se pudo subir la copia a la nube:', e.message);
  }
  return estado.ultima;
}

estado.activa = !!configNube();

module.exports = {
  firmarS3, configNube, subirCopia, estadoNube: estado,
  claveCopias, cifrarCopia, descifrarCopia, listarCopiasNube, bajarCopiaNube
};

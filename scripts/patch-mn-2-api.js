'use strict';
// Patch 2: api.js — agrega getPerfilesNegocio
const fs = require('fs');
const file = require('path').join(__dirname, '..', 'public', 'js', 'api.js');
let src = fs.readFileSync(file, 'utf8');
const E = src.includes('\r\n') ? '\r\n' : '\n';
if (src.includes('getPerfilesNegocio')) { console.log('api.js ya aplicado'); process.exit(0); }

const VIEJO = `  // ===== Configuraci\\u00f3n =====
  getConfig() { return this.request('GET', '/config'); },
  updateConfig(data) { return this.request('PUT', '/config', data); },`;

const NUEVO = `  // ===== Configuración =====
  getConfig() { return this.request('GET', '/config'); },
  updateConfig(data) { return this.request('PUT', '/config', data); },
  getPerfilesNegocio() { return this.request('GET', '/config/perfiles'); },`;

const srcNorm = src.replace(/\r\n/g, '\n');
const viejoNorm = VIEJO.replace(/\r\n/g, '\n');
if (!srcNorm.includes(viejoNorm)) {
  // Try alternate (already decoded)
  const ALT = `  // ===== Configuración =====\n  getConfig() { return this.request('GET', '/config'); },\n  updateConfig(data) { return this.request('PUT', '/config', data); },`;
  if (!srcNorm.includes(ALT)) { console.error('Patron no encontrado en api.js'); process.exit(1); }
  const result = srcNorm.replace(ALT, NUEVO.replace(/\r\n/g, '\n')).replace(/\n/g, E);
  fs.writeFileSync(file, result, 'utf8');
} else {
  const result = srcNorm.replace(viejoNorm, NUEVO.replace(/\r\n/g, '\n')).replace(/\n/g, E);
  fs.writeFileSync(file, result, 'utf8');
}
console.log('OK api.js');

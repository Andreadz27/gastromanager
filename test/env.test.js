const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { cargarEnv } = require('../src/env');

test('.env: carga CLAVE=valor, ignora comentarios y no pisa el entorno', () => {
  const archivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gm-env-')), '.env');
  fs.writeFileSync(archivo, '\uFEFF# comentario\r\nGM_TEST_A=uno\r\nGM_TEST_B = "dos con espacios"\r\nGM_TEST_C=no-pisa\r\nlinea invalida\r\n');
  process.env.GM_TEST_C = 'del-entorno';
  assert.equal(cargarEnv(archivo), 2);
  assert.equal(process.env.GM_TEST_A, 'uno');
  assert.equal(process.env.GM_TEST_B, 'dos con espacios');
  assert.equal(process.env.GM_TEST_C, 'del-entorno');
  assert.equal(cargarEnv(path.join(path.dirname(archivo), 'no-existe')), 0);
});

// Morfi Nube detrás de un proxy (Render): TRUST_PROXY=1 toma la IP que agrega el proxy, no la que inventa el cliente.
// Con "true" cualquiera podía poner otra IP en X-Forwarded-For y saltear el límite de intentos de login.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { esperar } = require('./helpers');

const RAIZ = path.join(__dirname, '..');
const puertoLibre = () => new Promise(ok => { const x = net.createServer(); x.listen(0, () => { const { port } = x.address(); x.close(() => ok(port)); }); });

async function conNube(env, fn) {
  const datos = fs.mkdtempSync(path.join(os.tmpdir(), 'morfi-nube-proxy-'));
  const port = await puertoLibre();
  const base = `http://127.0.0.1:${port}`;
  const nube = spawn(process.execPath, [path.join(RAIZ, 'nube', 'servidor.js')],
    { env: { ...process.env, TRUST_PROXY: '', ...env, NUBE_DATOS: datos, PORT: String(port) }, stdio: 'ignore' });
  try {
    let listo = false;
    for (let t = 0; t < 15000 && !listo; t += 200) { try { listo = (await fetch(base + '/api/salud')).ok; } catch (e) { await esperar(200); } }
    assert.ok(listo, 'la nube no arrancó');
    await fn(async xff => (await (await fetch(base + '/api/salud', { headers: xff ? { 'X-Forwarded-For': xff } : {} })).json()).ip);
  } finally {
    nube.kill();
    await esperar(300);
    fs.rmSync(datos, { recursive: true, force: true });
  }
}

test('con TRUST_PROXY=1 la IP es la que agregó el proxy, aunque el cliente mande otra', () => conNube({ TRUST_PROXY: '1' }, async ip => {
  // El cliente manda "1.2.3.4"; el proxy de Render agrega al final la IP real que vio
  assert.equal(await ip('1.2.3.4, 200.45.10.20'), '200.45.10.20');
  assert.equal(await ip('10.0.0.1, 1.2.3.4, 200.45.10.20'), '200.45.10.20');
}));

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { iniciarServidor, esperar } = require('./helpers');
const { firmarS3 } = require('../src/servicios/copia-nube');

// Copia fuera del local (S3 / Backblaze B2) y monitoreo, contra servidores simulados
let s, mock, recibidos = [];
before(async () => {
  mock = http.createServer((req, res) => {
    const partes = [];
    req.on('data', c => partes.push(c));
    req.on('end', () => {
      recibidos.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(partes) });
      res.writeHead(200); res.end('ok');
    });
  });
  await new Promise(r => mock.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${mock.address().port}`;
  s = await iniciarServidor({
    BACKUP_S3_ENDPOINT: base, BACKUP_S3_BUCKET: 'copias', BACKUP_S3_KEY_ID: 'clave-id', BACKUP_S3_SECRET: 'secreto',
    BACKUP_S3_REGION: 'us-west-004', BACKUP_S3_PREFIJO: 'la-buena-mesa',
    MONITOREO_URL: `${base}/ping/abc`, MONITOREO_SEGUNDOS: '1'
  });
});
after(async () => { await s.cerrar(); await new Promise(r => mock.close(r)); });

const esperarQue = async (cond, ms = 8000) => { for (let t = 0; t < ms && !cond(); t += 100) await esperar(100); return cond(); };

test('firma AWS SigV4: coincide con el ejemplo oficial de AWS', () => {
  const r = firmarS3({
    metodo: 'GET', host: 'examplebucket.s3.amazonaws.com', ruta: '/test.txt',
    headers: { range: 'bytes=0-9', 'x-amz-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
    region: 'us-east-1', keyId: 'AKIAIOSFODNN7EXAMPLE', secret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', fecha: new Date('2013-05-24T00:00:00Z')
  });
  assert.match(r.authorization, /Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41$/);
});

test('cada copia de seguridad se sube a la nube en la carpeta del cliente', async () => {
  const [st, copia] = await s.llamar('POST', '/api/backups', undefined, s.tokenAdmin);
  assert.equal(st, 201);
  assert.ok(await esperarQue(() => recibidos.some(r => r.method === 'PUT' && r.url === `/copias/la-buena-mesa/${copia.nombre}`)), 'llegó el PUT');
  const put = recibidos.find(r => r.url === `/copias/la-buena-mesa/${copia.nombre}`);
  assert.equal(put.body.slice(0, 15).toString(), 'SQLite format 3');
  assert.match(put.headers.authorization, /^AWS4-HMAC-SHA256 Credential=clave-id\/\d{8}\/us-west-004\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
});

test('/api/salud: sin sesión, sin datos del negocio y con el estado de las copias', async () => {
  await esperarQue(() => false, 300);
  const [st, salud] = await s.llamar('GET', '/api/salud');
  assert.equal(st, 200);
  assert.equal(salud.ok, true);
  assert.equal(salud.base, 'ok');
  assert.ok(salud.ultima_copia && salud.ultima_copia.horas < 1);
  assert.equal(salud.copia_nube.ok, true);
  assert.equal(JSON.stringify(salud).includes('admin'), false);
});

test('latido periódico al monitoreo; si falta la copia avisa con /fail', async () => {
  assert.ok(await esperarQue(() => recibidos.filter(r => r.url === '/ping/abc').length >= 2), 'latidos cada segundo');
  // Sin copias recientes: el latido pasa a /fail
  const fs = require('fs'), path = require('path');
  const dir = path.join(s.dataDir, 'backups');
  const viejo = new Date(Date.now() - 30 * 36e5);
  for (const f of fs.readdirSync(dir)) fs.utimesSync(path.join(dir, f), viejo, viejo);
  assert.ok(await esperarQue(() => recibidos.some(r => r.url === '/ping/abc/fail')), 'aviso de falla');
  const [st, salud] = await s.llamar('GET', '/api/salud');
  assert.equal(st, 503);
  assert.match(salud.problemas.join(' '), /copia de seguridad/);
});

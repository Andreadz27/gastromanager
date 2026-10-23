// Copias cifradas en la nube y npm run restaurar (local y desde la nube, como en una PC nueva)
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { iniciarServidor, esperar } = require('./helpers');

const RAIZ = path.join(__dirname, '..');
const CLAVE = crypto.randomBytes(32).toString('hex');

// Bucket S3 simulado: guarda lo que se sube, lo devuelve y lista con el XML de ListObjectsV2
const objetos = new Map();
let bucket;
before(async () => {
  bucket = http.createServer((req, res) => {
    const partes = [];
    req.on('data', c => partes.push(c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      if (req.method === 'PUT') { objetos.set(decodeURIComponent(url.pathname), Buffer.concat(partes)); res.writeHead(200); return res.end(); }
      if (url.searchParams.get('list-type') === '2') {
        const prefijo = url.pathname.replace(/\/$/, '') + '/' + (url.searchParams.get('prefix') || '');
        const xml = [...objetos].filter(([k]) => k.startsWith(prefijo)).map(([k, v]) =>
          `<Contents><Key>${k.split('/').slice(2).join('/')}</Key><Size>${v.length}</Size><LastModified>2026-10-23T05:00:00.000Z</LastModified></Contents>`).join('');
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        return res.end(`<ListBucketResult>${xml}</ListBucketResult>`);
      }
      const obj = objetos.get(decodeURIComponent(url.pathname));
      res.writeHead(obj ? 200 : 404);
      res.end(obj || 'NoSuchKey');
    });
  });
  await new Promise(r => bucket.listen(0, '127.0.0.1', r));
});
after(() => new Promise(r => bucket.close(r)));

const nube = () => ({
  BACKUP_S3_ENDPOINT: `http://127.0.0.1:${bucket.address().port}`, BACKUP_S3_BUCKET: 'copias',
  BACKUP_S3_KEY_ID: 'k', BACKUP_S3_SECRET: 's', BACKUP_S3_PREFIJO: 'la-buena-mesa'
});

// Async: el bucket simulado corre en este mismo proceso (spawnSync lo dejaría sin responder)
const correr = (args, opciones) => new Promise(ok => execFile(process.execPath, args, { ...opciones, encoding: 'utf8' },
  (err, stdout, stderr) => ok({ status: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })));

// Una "PC" con su carpeta de datos: corre restaurar.js con ese entorno
function pc(envExtra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-restaurar-'));
  const env = { ...process.env, GM_DATA_DIR: dir, GM_ENV_FILE: path.join(dir, 'sin.env'), PORT: '1', ...envExtra };
  return {
    dir, env,
    restaurar: (...a) => correr([path.join(RAIZ, 'scripts', 'restaurar.js'), ...a], { cwd: RAIZ, env }),
    q: async sql => (await correr(['-e', `
      const db = new (require('sqlite3').Database)(${JSON.stringify(path.join(env.GM_DATA_DIR, 'morfi.db'))});
      db.all(${JSON.stringify(sql)}, (e, r) => { console.log(JSON.stringify(e ? e.message : r)); db.close(); });`], { cwd: RAIZ })).stdout,
    borrar: () => fs.rmSync(dir, { recursive: true, force: true })
  };
}

test('la copia se sube cifrada; una PC nueva la restaura desde la nube con la clave', async () => {
  const s = await iniciarServidor({ ...nube(), BACKUP_CLAVE: CLAVE });
  let nueva, nombre;
  try {
    await s.q("UPDATE configuracion SET nombre_negocio = 'La Buena Mesa' WHERE id = 1");
    const [st, copia] = await s.llamar('POST', '/api/backups', undefined, s.tokenAdmin);
    assert.equal(st, 201);
    nombre = `${copia.nombre}.cifrado`;
    const ruta = `/copias/la-buena-mesa/${nombre}`;
    for (let i = 0; i < 80 && !objetos.has(ruta); i++) await esperar(100);
    const subido = objetos.get(ruta);
    assert.ok(subido, 'se subió con extensión .cifrado');
    assert.equal(subido.slice(0, 4).toString(), 'GMC1');
    assert.equal(subido.includes(Buffer.from('SQLite format 3')), false, 'no se puede leer sin la clave');
    assert.equal(subido.includes(Buffer.from('La Buena Mesa')), false);
  } finally {
    await s.cerrar();
  }

  // Otra PC, sin base: lista y restaura desde la nube
  nueva = pc({ ...nube(), BACKUP_CLAVE: CLAVE });
  try {
    const lista = await nueva.restaurar('--listar');
    assert.equal(lista.status, 0, lista.stderr);
    assert.ok(lista.stdout.includes(nombre), lista.stdout);

    const sinClave = pc(nube());
    const r0 = await sinClave.restaurar('--nube', nombre);
    assert.equal(r0.status, 1);
    assert.match(r0.stderr, /falta BACKUP_CLAVE/);
    assert.equal(fs.existsSync(path.join(sinClave.dir, 'morfi.db')), false, 'no tocó nada');
    sinClave.borrar();

    const r = await nueva.restaurar('--nube', nombre);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(await nueva.q('SELECT nombre_negocio FROM configuracion'), /La Buena Mesa/);
  } finally {
    nueva.borrar();
  }

  // PC de reemplazo: la copia más nueva, sin saber cómo se llama (lo usa instalar.ps1 -RestaurarDeLaNube)
  const reemplazo = pc({ ...nube(), BACKUP_CLAVE: CLAVE });
  try {
    const r = await reemplazo.restaurar('--nube', '--ultima');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp(`Copia más nueva de la nube: ${nombre.replace(/\./g, '\\.')}`));
    assert.match(await reemplazo.q('SELECT nombre_negocio FROM configuracion'), /La Buena Mesa/);
  } finally {
    reemplazo.borrar();
  }
});

test('restaurar una copia local: guarda la base actual antes y rechaza copias dañadas o con el servidor andando', async () => {
  const s = await iniciarServidor();
  const dir = s.dataDir;
  let copia;
  try {
    await s.q("UPDATE configuracion SET nombre_negocio = 'Versión vieja' WHERE id = 1");
    copia = (await s.llamar('POST', '/api/backups', undefined, s.tokenAdmin))[1].nombre;
    await s.q("UPDATE configuracion SET nombre_negocio = 'Versión nueva' WHERE id = 1");
    // Con el servidor corriendo se niega
    const corriendo = await correr([path.join(RAIZ, 'scripts', 'restaurar.js'), copia],
      { cwd: RAIZ, env: { ...process.env, GM_DATA_DIR: dir, GM_ENV_FILE: path.join(dir, 'sin.env'), PORT: new URL(s.base).port } });
    assert.equal(corriendo.status, 1);
    assert.match(corriendo.stderr, /pm2 stop morfi/);
  } finally {
    await s.cerrar({ conservarDatos: true });
  }
  const local = pc({ GM_DATA_DIR: dir });
  try {
    fs.writeFileSync(path.join(dir, 'backups', 'rota.db'), 'esto no es una base');
    const rota = await local.restaurar(path.join(dir, 'backups', 'rota.db'));
    assert.equal(rota.status, 1);
    assert.match(rota.stderr, /no es una base de datos válida/);
    assert.match(await local.q('SELECT nombre_negocio FROM configuracion'), /Versión nueva/, 'una copia rota no toca la base');

    const r = await local.restaurar(copia);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(await local.q('SELECT nombre_negocio FROM configuracion'), /Versión vieja/);
    const resguardo = fs.readdirSync(path.join(dir, 'backups')).find(f => f.startsWith('antes-de-restaurar_'));
    assert.ok(resguardo, 'guardó la base anterior');
    const resguardada = pc();
    fs.copyFileSync(path.join(dir, 'backups', resguardo), path.join(resguardada.dir, 'morfi.db'));
    assert.match(await resguardada.q('SELECT nombre_negocio FROM configuracion'), /Versión nueva/);
    resguardada.borrar();
  } finally {
    local.borrar();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

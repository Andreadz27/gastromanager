const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('child_process');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3');
const { SECRET_KEY, esperar } = require('./helpers');

// Migraciones seguras: copia previa (marcha atrás), transacción única y restauración probada.
const RAIZ = path.join(__dirname, '..');

const nuevaBase = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-migr-'));
  execFileSync(process.execPath, [path.join(RAIZ, 'init-db.js')], { env: { ...process.env, GM_DATA_DIR: dir, SECRET_KEY }, stdio: 'ignore' });
  return dir;
};

const consultar = (archivo, sql, p = []) => new Promise((ok, mal) => {
  const db = new sqlite3.Database(archivo);
  db.all(sql, p, (e, r) => db.close(() => e ? mal(e) : ok(r)));
});
const columnas = async (archivo, tabla) => (await consultar(archivo, `PRAGMA table_info(${tabla})`)).map(c => c.name);
const backups = dir => fs.existsSync(path.join(dir, 'backups')) ? fs.readdirSync(path.join(dir, 'backups')).sort() : [];

// Corre un script con los módulos del servidor apuntando a la carpeta indicada
const ejecutar = (dir, codigo) => execFileSync(process.execPath, ['-e', codigo], {
  cwd: RAIZ, env: { ...process.env, GM_DATA_DIR: dir, SECRET_KEY }, encoding: 'utf8'
});

// Puerto libre que da el sistema (uno al azar puede estar reservado en Windows)
const puertoLibre = () => new Promise((ok, mal) => {
  const srv = net.createServer();
  srv.listen(0, () => { const { port } = srv.address(); srv.close(() => ok(port)); });
  srv.on('error', mal);
});

// Arranca el servidor real sobre una carpeta existente y lo cierra cuando responde
async function arrancarYCerrar(dir) {
  const port = await puertoLibre();
  const proc = spawn(process.execPath, [path.join(RAIZ, 'server.js')], {
    env: { ...process.env, GM_DATA_DIR: dir, SECRET_KEY, PORT: String(port), NODE_ENV: 'test' }, stdio: 'ignore'
  });
  try {
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`http://127.0.0.1:${port}/`)).ok) return; } catch (e) {}
      if (proc.exitCode !== null) throw new Error('El servidor no arrancó');
      await esperar(100);
    }
    throw new Error('El servidor no respondió');
  } finally {
    proc.kill();
    await new Promise(r => proc.exitCode !== null ? r() : proc.once('exit', r));
  }
}

test('una migración que falla no deja la base a medias (transacción única)', async () => {
  const dir = nuevaBase();
  const archivo = path.join(dir, 'gastromanager.db');
  try {
    assert.ok(!(await columnas(archivo, 'productos')).includes('tn_variant_id'), 'la base nueva todavía no tiene la columna');
    // Se migra y se fuerza un error al final: nada de lo migrado tiene que quedar guardado
    const salida = ejecutar(dir, `
      const { transaccion } = require('./src/db');
      const { migrarEsquema } = require('./src/migraciones');
      transaccion(async () => { await migrarEsquema(); throw new Error('falla simulada'); })
        .then(() => console.log('sin error'), e => console.log('error:', e.message))
        .finally(() => setTimeout(() => process.exit(0), 50));`);
    assert.match(salida, /error: falla simulada/);
    assert.ok(!(await columnas(archivo, 'productos')).includes('tn_variant_id'), 'la migración fallida se revirtió');

    // Sin error, la migración se aplica completa
    ejecutar(dir, `require('./src/migraciones').migrarConRespaldo().then(() => setTimeout(() => process.exit(0), 50));`);
    assert.ok((await columnas(archivo, 'productos')).includes('tn_variant_id'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('antes de migrar se hace una copia, y restaurarla funciona (rollback probado)', async () => {
  const dir = nuevaBase();
  const archivo = path.join(dir, 'gastromanager.db');
  try {
    // Una venta cargada antes de la actualización
    await consultar(archivo, "INSERT INTO pedidos (numero_pedido, tipo, estado, subtotal, total) VALUES ('ANTES-1', 'takeaway', 'pagado', 500, 500)");

    // Primer arranque con migraciones nuevas: copia previa sin las tablas que agrega la migración
    await arrancarYCerrar(dir);
    const copias = backups(dir);
    assert.equal(copias.length, 1, 'una copia previa a migrar');
    const copia = path.join(dir, 'backups', copias[0]);
    assert.ok(!(await columnas(copia, 'productos')).includes('tn_variant_id'), 'la copia es del estado anterior a migrar');
    assert.equal((await consultar(copia, "SELECT COUNT(*) AS n FROM pedidos WHERE numero_pedido = 'ANTES-1'"))[0].n, 1);
    assert.ok((await columnas(archivo, 'productos')).includes('tn_variant_id'), 'la base quedó migrada');

    // Segundo arranque con las mismas migraciones: no se repite la copia
    await arrancarYCerrar(dir);
    assert.equal(backups(dir).length, 1, 'sin migraciones nuevas no hay copia extra');

    // Marcha atrás: se reemplaza la base por la copia (como dice el README) y el sistema vuelve a arrancar
    await consultar(archivo, "INSERT INTO pedidos (numero_pedido, tipo, estado, subtotal, total) VALUES ('DESPUES-1', 'takeaway', 'pagado', 1, 1)");
    for (const extra of ['-wal', '-shm']) fs.rmSync(archivo + extra, { force: true });
    fs.copyFileSync(copia, archivo);
    await arrancarYCerrar(dir);
    const nums = (await consultar(archivo, "SELECT numero_pedido FROM pedidos WHERE numero_pedido IN ('ANTES-1', 'DESPUES-1')")).map(r => r.numero_pedido);
    assert.deepEqual(nums, ['ANTES-1'], 'se recuperó el estado de la copia');
    assert.ok((await columnas(archivo, 'productos')).includes('tn_variant_id'), 'y se volvió a migrar sola');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

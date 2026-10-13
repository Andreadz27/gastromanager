const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SECRET_KEY } = require('./helpers');

// npm run actualizar: copia antes de tocar nada, solo avance rápido, nunca pisa cambios locales.
// Se arma un "GitHub" de prueba (repo bare), una instalación y un desarrollador que publica una versión nueva.
const RAIZ = path.join(__dirname, '..');
const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@test.com', ...a], { cwd, encoding: 'utf8' }).trim();

test('actualiza a la versión nueva con copia previa; sin cambios no hace nada; con cambios locales no toca', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-actualizar-'));
  const bare = path.join(tmp, 'origen.git'), inst = path.join(tmp, 'instalacion'), dev = path.join(tmp, 'dev'), datos = path.join(tmp, 'datos');
  try {
    git(tmp, 'init', '--bare', '--quiet', '-b', 'main', bare);
    git(RAIZ, 'push', '--quiet', bare, 'HEAD:refs/heads/main');
    git(tmp, 'clone', '--quiet', bare, inst);
    git(tmp, 'clone', '--quiet', bare, dev);
    fs.symlinkSync(path.join(RAIZ, 'node_modules'), path.join(inst, 'node_modules'), 'junction');
    const env = { ...process.env, GM_DATA_DIR: datos, SECRET_KEY, GM_ENV_FILE: path.join(tmp, 'sin.env') };
    execFileSync(process.execPath, [path.join(inst, 'init-db.js')], { env, stdio: 'ignore' });
    const actualizar = (...a) => spawnSync(process.execPath, [path.join(inst, 'scripts', 'actualizar.js'), '--sin-npm', '--sin-reiniciar', ...a], { cwd: inst, env, encoding: 'utf8' });

    // Sin versión nueva: no hace nada
    let r = actualizar();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Ya está en la última versión/);

    // El desarrollador publica una versión nueva
    fs.writeFileSync(path.join(dev, 'NOVEDAD.txt'), 'versión 2');
    git(dev, 'add', 'NOVEDAD.txt');
    git(dev, 'commit', '--quiet', '-m', 'Versión 2');
    git(dev, 'push', '--quiet', 'origin', 'main');
    const nueva = git(dev, 'rev-parse', 'HEAD');

    r = actualizar('--solo-revisar');
    assert.match(r.stdout, /Versión nueva disponible/);
    assert.notEqual(git(inst, 'rev-parse', 'HEAD'), nueva, '--solo-revisar no cambia nada');

    r = actualizar();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(git(inst, 'rev-parse', 'HEAD'), nueva);
    assert.ok(fs.existsSync(path.join(inst, 'NOVEDAD.txt')));
    assert.match(r.stdout, /Copia de seguridad previa: gastromanager_/);
    assert.ok(fs.readdirSync(path.join(datos, 'backups')).length >= 1);
    assert.match(fs.readFileSync(path.join(inst, 'logs', 'actualizaciones.log'), 'utf8'), /Actualizado a/);

    // Archivo del sistema modificado a mano: no actualiza
    fs.appendFileSync(path.join(inst, 'README.md'), '\ncambio local');
    fs.writeFileSync(path.join(dev, 'NOVEDAD.txt'), 'versión 3');
    git(dev, 'commit', '--quiet', '-am', 'Versión 3');
    git(dev, 'push', '--quiet', 'origin', 'main');
    r = actualizar();
    assert.equal(r.status, 1);
    assert.match(r.stdout, /modificados a mano/);
    assert.equal(git(inst, 'rev-parse', 'HEAD'), nueva);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
